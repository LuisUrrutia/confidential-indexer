import { DelegationEventKind, TokenActivityKind } from "@confidential-indexer/core";
import type {
  EventCursor,
  IndexedEvent,
  IndexedEventBatch,
  IndexedEventSource,
} from "@confidential-indexer/core";

export interface QueryablePool {
  query(sql: string, params: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }>;
}

export interface HyperindexPollingEventSourceConfig {
  pool: QueryablePool;
  limit: number;
}

export class HyperindexPollingEventSource implements IndexedEventSource {
  constructor(private readonly config: HyperindexPollingEventSourceConfig) {}

  async nextBatch(cursor: EventCursor | null): Promise<IndexedEventBatch> {
    const result = await this.config.pool.query(
      `select * from hyperindex_events
       where ($1::numeric is null or block_number > $1 or (block_number = $1 and log_index > $2))
       order by block_number asc, log_index asc
       limit $3`,
      [cursor?.blockNumber.toString() ?? null, cursor?.logIndex ?? null, this.config.limit],
    );
    const events = result.rows.map((row) => this.mapRow(row));
    const last = events.at(-1);
    return {
      events,
      nextCursor: last ? { blockNumber: last.blockNumber, logIndex: last.logIndex } : cursor,
    };
  }

  private mapRow(row: Record<string, unknown>): IndexedEvent {
    const base = {
      chainId: Number(row.chain_id),
      tokenAddress: row.token_address as `0x${string}`,
      txHash: row.tx_hash as `0x${string}`,
      logIndex: Number(row.log_index),
      blockNumber: BigInt(row.block_number as string),
      blockTimestamp: row.block_timestamp as Date,
    };

    if (row.kind === DelegationEventKind.DelegationGranted) {
      return {
        kind: DelegationEventKind.DelegationGranted,
        ...base,
        delegator: row.delegator as `0x${string}`,
        delegate: row.delegate as `0x${string}`,
        expiresAt: (row.expires_at as Date | null) ?? null,
      };
    }
    if (row.kind === DelegationEventKind.DelegationRevoked) {
      return {
        kind: DelegationEventKind.DelegationRevoked,
        ...base,
        delegator: row.delegator as `0x${string}`,
        delegate: row.delegate as `0x${string}`,
      };
    }
    if (row.kind === TokenActivityKind.Shield) {
      return {
        kind: TokenActivityKind.Shield,
        ...base,
        to: row.to_address as `0x${string}`,
        encryptedAmount: row.encrypted_amount as `0x${string}`,
        amount: BigInt(row.cleartext_amount as string),
      };
    }
    if (row.kind === TokenActivityKind.UnshieldRequested) {
      return {
        kind: TokenActivityKind.UnshieldRequested,
        ...base,
        receiver: row.receiver as `0x${string}`,
        encryptedAmount: row.encrypted_amount as `0x${string}`,
        unwrapRequestId: (row.unwrap_request_id as `0x${string}` | null) ?? null,
      };
    }
    if (row.kind === TokenActivityKind.UnshieldFinalized) {
      return {
        kind: TokenActivityKind.UnshieldFinalized,
        ...base,
        receiver: row.receiver as `0x${string}`,
        encryptedAmount: row.encrypted_amount as `0x${string}`,
        amount: BigInt(row.cleartext_amount as string),
        unwrapRequestId: (row.unwrap_request_id as `0x${string}` | null) ?? null,
      };
    }
    return {
      kind: TokenActivityKind.ConfidentialTransfer,
      ...base,
      from: row.from_address as `0x${string}`,
      to: row.to_address as `0x${string}`,
      encryptedAmount: row.encrypted_amount as `0x${string}`,
    };
  }
}
