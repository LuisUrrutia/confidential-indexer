import type { Address, Hex, IndexedEvent } from "@confidential-indexer/core";
import pg from "pg";
import { normalizeTokenEvent, type TokenEventMetadata } from "./erc7984-events.js";
import { toExpirationDate } from "./epoch-expiration.js";

export type EnvioValue = bigint | number | string;

export interface EnvioBlock {
  number: EnvioValue;
  timestamp: Date | EnvioValue;
}

export interface EnvioTransaction {
  hash: Hex;
}

interface EnvioEventBase<Params extends Record<string, unknown>, Name extends string> {
  eventName: Name;
  chainId: number;
  srcAddress: Address;
  logIndex: number;
  block: EnvioBlock;
  transaction: EnvioTransaction;
  params: Params;
}

export type EnvioTokenEvent = EnvioEventBase<
  {
    from?: Address;
    to?: Address;
    amount?: Hex;
    receiver?: Address;
    roundedAmount?: EnvioValue;
    encryptedAmount?: Hex;
    encryptedWrappedAmount?: Hex;
    cleartextAmount?: EnvioValue;
    unwrapRequestId?: Hex | null;
  },
  "ConfidentialTransfer" | "Wrap" | "UnwrapRequested" | "UnwrapFinalized"
>;

export type EnvioAclEvent = EnvioEventBase<
  {
    delegator: Address;
    delegate: Address;
    contractAddress: Address;
    newExpirationDate?: EnvioValue;
  },
  "DelegatedForUserDecryption" | "RevokedDelegationForUserDecryption"
>;

export interface HyperindexEventWriter {
  upsertEvent(event: IndexedEvent): Promise<boolean>;
  recordSourceHead(input: {
    chainId: number;
    tokenAddress: Address;
    headBlock: bigint;
  }): Promise<void>;
}

export interface QueryablePool {
  query(sql: string, params?: unknown[]): Promise<{ rowCount: number | null }>;
}

export class PgHyperindexEventWriter implements HyperindexEventWriter {
  private initialized = false;

  constructor(private readonly pool: QueryablePool) {}

  async upsertEvent(event: IndexedEvent): Promise<boolean> {
    await this.ensureSchema();
    const result = await this.pool.query(
      `insert into hyperindex_events
       (kind, chain_id, token_address, tx_hash, log_index, block_number, block_timestamp, from_address, to_address, receiver, encrypted_amount, cleartext_amount, unwrap_request_id, delegator, delegate, expires_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
       on conflict do nothing`,
      eventToRow(event),
    );
    return result.rowCount === 1;
  }

  async recordSourceHead(input: {
    chainId: number;
    tokenAddress: Address;
    headBlock: bigint;
  }): Promise<void> {
    await this.ensureSchema();
    await this.pool.query(
      `insert into source_heads (source_name, chain_id, token_address, head_block, updated_at)
       values ('hyperindex', $1, lower($2), $3, now())
       on conflict (source_name, chain_id, token_address) do update set
       head_block = greatest(source_heads.head_block, excluded.head_block), updated_at = now()`,
      [input.chainId, input.tokenAddress, input.headBlock.toString()],
    );
  }

  private async ensureSchema(): Promise<void> {
    if (this.initialized) return;
    await this.pool.query(
      [
        "create table if not exists hyperindex_events (",
        "kind text not null,",
        "chain_id integer not null,",
        "token_address text not null,",
        "tx_hash text not null,",
        "log_index integer not null,",
        "block_number numeric not null,",
        "block_timestamp timestamptz not null,",
        "from_address text,",
        "to_address text,",
        "receiver text,",
        "encrypted_amount text,",
        "cleartext_amount numeric,",
        "unwrap_request_id text,",
        "delegator text,",
        "delegate text,",
        "expires_at timestamptz,",
        "primary key (chain_id, tx_hash, log_index)",
        ")",
      ].join(" "),
    );
    await this.pool.query(
      [
        "create table if not exists source_heads (",
        "source_name text not null,",
        "chain_id integer not null,",
        "token_address text not null,",
        "head_block numeric not null,",
        "updated_at timestamptz not null default now(),",
        "primary key (source_name, chain_id, token_address)",
        ")",
      ].join(" "),
    );
    await this.pool.query("alter table hyperindex_events add column if not exists receiver text");
    await this.pool.query(
      "alter table hyperindex_events add column if not exists cleartext_amount numeric",
    );
    await this.pool.query(
      "alter table hyperindex_events add column if not exists unwrap_request_id text",
    );
    await this.pool.query("alter table hyperindex_events add column if not exists delegator text");
    await this.pool.query("alter table hyperindex_events add column if not exists delegate text");
    await this.pool.query(
      "alter table hyperindex_events add column if not exists expires_at timestamptz",
    );
    await this.pool.query(
      "create index if not exists hyperindex_events_order on hyperindex_events (block_number asc, log_index asc)",
    );
    this.initialized = true;
  }
}

export function createPgHyperindexEventWriter(databaseUrl: string): {
  writer: PgHyperindexEventWriter;
  close: () => Promise<void>;
} {
  const pool = new pg.Pool({ connectionString: databaseUrl });
  return {
    writer: new PgHyperindexEventWriter(pool),
    close: () => pool.end(),
  };
}

export async function recordEnvioTokenEvent(
  event: EnvioTokenEvent,
  writer: HyperindexEventWriter,
): Promise<boolean> {
  const indexedEvent = normalizeTokenEvent(toAlphaTokenEvent(event), metadataFrom(event));
  const inserted = await writer.upsertEvent(indexedEvent);
  await writer.recordSourceHead({
    chainId: event.chainId,
    tokenAddress: event.srcAddress,
    headBlock: blockNumber(event.block.number),
  });
  return inserted;
}

export async function recordEnvioAclEvent(
  event: EnvioAclEvent,
  writer: HyperindexEventWriter,
  indexedTokenAddresses: ReadonlySet<Address>,
): Promise<boolean> {
  const tokenAddress = findConfiguredToken(event.params.contractAddress, indexedTokenAddresses);
  if (!tokenAddress) return false;
  const indexedEvent: IndexedEvent =
    event.eventName === "DelegatedForUserDecryption"
      ? {
          kind: "delegation_granted",
          ...metadataFrom(event, tokenAddress),
          delegator: event.params.delegator,
          delegate: event.params.delegate,
          expiresAt: toExpirationDate(
            requiredBigint(event.params.newExpirationDate, "newExpirationDate"),
          ),
        }
      : {
          kind: "delegation_revoked",
          ...metadataFrom(event, tokenAddress),
          delegator: event.params.delegator,
          delegate: event.params.delegate,
        };
  const inserted = await writer.upsertEvent(indexedEvent);
  await writer.recordSourceHead({
    chainId: event.chainId,
    tokenAddress,
    headBlock: blockNumber(event.block.number),
  });
  return inserted;
}

function metadataFrom(
  event: EnvioTokenEvent | EnvioAclEvent,
  tokenAddress = event.srcAddress,
): TokenEventMetadata {
  return {
    chainId: event.chainId,
    tokenAddress,
    txHash: event.transaction.hash,
    logIndex: event.logIndex,
    blockNumber: blockNumber(event.block.number),
    blockTimestamp: blockTimestamp(event.block.timestamp),
  };
}

function toAlphaTokenEvent(event: EnvioTokenEvent): Parameters<typeof normalizeTokenEvent>[0] {
  switch (event.eventName) {
    case "ConfidentialTransfer":
      return {
        eventName: "ConfidentialTransfer",
        from: requiredAddress(event.params.from, "from"),
        to: requiredAddress(event.params.to, "to"),
        encryptedAmount: requiredHex(event.params.amount, "amount"),
      };
    case "Wrap":
      return {
        eventName: "Wrap",
        to: requiredAddress(event.params.to, "to"),
        roundedAmount: requiredBigint(event.params.roundedAmount, "roundedAmount"),
        encryptedWrappedAmount: requiredHex(
          event.params.encryptedWrappedAmount,
          "encryptedWrappedAmount",
        ),
      };
    case "UnwrapRequested":
      return {
        eventName: "UnwrapRequested",
        receiver: requiredAddress(event.params.receiver, "receiver"),
        encryptedAmount: requiredHex(event.params.encryptedAmount, "encryptedAmount"),
        unwrapRequestId: event.params.unwrapRequestId ?? null,
      };
    case "UnwrapFinalized":
      return {
        eventName: "UnwrapFinalized",
        receiver: requiredAddress(event.params.receiver, "receiver"),
        encryptedAmount: requiredHex(event.params.encryptedAmount, "encryptedAmount"),
        cleartextAmount: requiredBigint(event.params.cleartextAmount, "cleartextAmount"),
        unwrapRequestId: event.params.unwrapRequestId ?? null,
      };
  }
}

function eventToRow(event: IndexedEvent): unknown[] {
  const row = {
    kind: event.kind,
    chainId: event.chainId,
    tokenAddress: event.tokenAddress.toLowerCase(),
    txHash: event.txHash,
    logIndex: event.logIndex,
    blockNumber: event.blockNumber.toString(),
    blockTimestamp: event.blockTimestamp,
    from: null as Address | null,
    to: null as Address | null,
    receiver: null as Address | null,
    encryptedAmount: null as Hex | null,
    cleartextAmount: null as string | null,
    unwrapRequestId: null as Hex | null,
    delegator: null as Address | null,
    delegate: null as Address | null,
    expiresAt: null as Date | null,
  };

  if (event.kind === "confidential_transfer") {
    row.from = event.from.toLowerCase() as Address;
    row.to = event.to.toLowerCase() as Address;
    row.encryptedAmount = event.encryptedAmount;
  } else if (event.kind === "shield") {
    row.to = event.to.toLowerCase() as Address;
    row.encryptedAmount = event.encryptedAmount;
    row.cleartextAmount = event.amount.toString();
  } else if (event.kind === "unshield_requested") {
    row.receiver = event.receiver.toLowerCase() as Address;
    row.encryptedAmount = event.encryptedAmount;
    row.unwrapRequestId = event.unwrapRequestId;
  } else if (event.kind === "unshield_finalized") {
    row.receiver = event.receiver.toLowerCase() as Address;
    row.encryptedAmount = event.encryptedAmount;
    row.cleartextAmount = event.amount.toString();
    row.unwrapRequestId = event.unwrapRequestId;
  } else if (event.kind === "delegation_granted") {
    row.delegator = event.delegator.toLowerCase() as Address;
    row.delegate = event.delegate.toLowerCase() as Address;
    row.expiresAt = event.expiresAt;
  } else {
    row.delegator = event.delegator.toLowerCase() as Address;
    row.delegate = event.delegate.toLowerCase() as Address;
  }

  return [
    row.kind,
    row.chainId,
    row.tokenAddress,
    row.txHash,
    row.logIndex,
    row.blockNumber,
    row.blockTimestamp,
    row.from,
    row.to,
    row.receiver,
    row.encryptedAmount,
    row.cleartextAmount,
    row.unwrapRequestId,
    row.delegator,
    row.delegate,
    row.expiresAt,
  ];
}

function findConfiguredToken(address: Address, configured: ReadonlySet<Address>): Address | null {
  for (const tokenAddress of configured) {
    if (tokenAddress.toLowerCase() === address.toLowerCase()) return tokenAddress;
  }
  return null;
}

function blockNumber(value: EnvioValue): bigint {
  return typeof value === "bigint" ? value : BigInt(value);
}

function blockTimestamp(value: Date | EnvioValue): Date {
  if (value instanceof Date) return value;
  const numeric = typeof value === "bigint" ? Number(value) : Number(value);
  return new Date(numeric < 10_000_000_000 ? numeric * 1000 : numeric);
}

function requiredAddress(value: Address | undefined, name: string): Address {
  if (value) return value;
  throw new Error(`Envio event is missing ${name}`);
}

function requiredHex(value: Hex | undefined, name: string): Hex {
  if (value) return value;
  throw new Error(`Envio event is missing ${name}`);
}

function requiredBigint(value: EnvioValue | undefined, name: string): bigint {
  if (value === undefined) throw new Error(`Envio event is missing ${name}`);
  return typeof value === "bigint" ? value : BigInt(value);
}
