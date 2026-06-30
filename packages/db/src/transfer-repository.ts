import { DecryptionStatus, TokenActivityKind } from "@confidential-indexer/core";
import type {
  IndexedEvent,
  StoredActivity,
  StoredTransfer,
  TransferPage,
  TransferQuery,
  TransferRepository,
} from "@confidential-indexer/core";
import type { PostgresPool } from "./postgres-pool.js";

function toBigInt(value: string | number | bigint): bigint {
  return typeof value === "bigint" ? value : BigInt(value);
}

function nullableBigInt(value: unknown): bigint | null {
  return value === null ? null : toBigInt(value as string);
}

function nullableAddress(value: unknown): StoredActivity["from"] {
  return value === null ? null : (value as `0x${string}`);
}

function mapTransfer(row: Record<string, unknown>): StoredTransfer {
  return {
    chainId: Number(row.chain_id),
    tokenAddress: row.token_address as StoredTransfer["tokenAddress"],
    txHash: row.tx_hash as StoredTransfer["txHash"],
    logIndex: Number(row.log_index),
    blockNumber: toBigInt(row.block_number as string),
    blockTimestamp: row.block_timestamp as Date,
    from: row.from_address as StoredTransfer["from"],
    to: row.to_address as StoredTransfer["to"],
    encryptedAmount: row.encrypted_amount as StoredTransfer["encryptedAmount"],
    amount: nullableBigInt(row.amount),
    decryptionStatus: row.decryption_status as StoredTransfer["decryptionStatus"],
    decryptionReason: row.decryption_reason as StoredTransfer["decryptionReason"],
    decryptedBy: nullableAddress(row.decrypted_by),
  };
}

export class PostgresTransferRepository implements TransferRepository {
  constructor(private readonly pool: PostgresPool) {}

  async upsertIndexedEvent(event: IndexedEvent): Promise<void> {
    if (event.kind !== TokenActivityKind.ConfidentialTransfer) return;
    await this.pool.query(
      `insert into transfers (chain_id, token_address, tx_hash, log_index, block_number, block_timestamp, from_address, to_address, encrypted_amount)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       on conflict (chain_id, tx_hash, log_index) do nothing`,
      [
        event.chainId,
        event.tokenAddress.toLowerCase(),
        event.txHash,
        event.logIndex,
        event.blockNumber.toString(),
        event.blockTimestamp,
        event.from.toLowerCase(),
        event.to.toLowerCase(),
        event.encryptedAmount,
      ],
    );
  }

  async listPendingDecryptions(limit: number): Promise<StoredTransfer[]> {
    const result = await this.pool.query(
      `select * from transfers where decryption_status = any($2) order by block_number asc, log_index asc limit $1`,
      [
        limit,
        [DecryptionStatus.Pending, DecryptionStatus.NotDelegated, DecryptionStatus.RetryableError],
      ],
    );
    return result.rows.map(mapTransfer);
  }

  async listPendingDecryptionsForHolder(input: {
    chainId: number;
    tokenAddress: StoredTransfer["tokenAddress"];
    holder: StoredTransfer["to"];
    limit: number;
  }): Promise<StoredTransfer[]> {
    const result = await this.pool.query(
      `select * from transfers
       where chain_id = $1
       and token_address = lower($2)
       and (from_address = lower($3) or to_address = lower($3))
       and decryption_status = any($5)
       order by block_number asc, log_index asc
       limit $4`,
      [
        input.chainId,
        input.tokenAddress,
        input.holder,
        input.limit,
        [DecryptionStatus.Pending, DecryptionStatus.NotDelegated, DecryptionStatus.RetryableError],
      ],
    );
    return result.rows.map(mapTransfer);
  }

  async markTransferDecrypted(input: {
    chainId: number;
    txHash: StoredTransfer["txHash"];
    logIndex: number;
    amount: bigint;
    decryptedBy: StoredTransfer["to"];
  }): Promise<void> {
    await this.pool.query(
      `update transfers set amount = $4, decryption_status = $5, decryption_reason = null, decrypted_by = lower($6), updated_at = now()
       where chain_id = $1 and tx_hash = $2 and log_index = $3`,
      [
        input.chainId,
        input.txHash,
        input.logIndex,
        input.amount.toString(),
        DecryptionStatus.Decrypted,
        input.decryptedBy,
      ],
    );
  }

  async markTransferUndecrypted(input: {
    chainId: number;
    txHash: StoredTransfer["txHash"];
    logIndex: number;
    status: StoredTransfer["decryptionStatus"];
    reason: StoredTransfer["decryptionReason"];
  }): Promise<void> {
    await this.pool.query(
      `update transfers set decryption_status = $4, decryption_reason = $5, updated_at = now()
       where chain_id = $1 and tx_hash = $2 and log_index = $3`,
      [input.chainId, input.txHash, input.logIndex, input.status, input.reason],
    );
  }

  async listTransfersForHolder(query: TransferQuery): Promise<TransferPage> {
    const result = await this.pool.query(
      `select * from transfers
       where ($1::text is null or from_address = lower($1) or to_address = lower($1))
       and ($2::integer is null or chain_id = $2)
       and ($3::text is null or token_address = lower($3))
       and ($4::text is null or decryption_status = $4)
       order by block_number desc, log_index desc
       limit $5 offset $6`,
      [
        query.holder,
        query.chainId ?? null,
        query.tokenAddress ?? null,
        query.decryptionStatus ?? null,
        query.limit,
        query.offset,
      ],
    );
    return { items: result.rows.map(mapTransfer), limit: query.limit, offset: query.offset };
  }
}
