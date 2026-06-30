import {
  DecryptionReason,
  DecryptionStatus,
  DelegationEventKind,
  TokenActivityKind,
} from "@confidential-indexer/core";
import type {
  ActivityPage,
  ActivityQuery,
  ActivityRepository,
  IndexedEvent,
  StoredActivity,
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

function mapActivity(row: Record<string, unknown>): StoredActivity {
  return {
    kind: row.kind as StoredActivity["kind"],
    chainId: Number(row.chain_id),
    tokenAddress: row.token_address as StoredActivity["tokenAddress"],
    txHash: row.tx_hash as StoredActivity["txHash"],
    logIndex: Number(row.log_index),
    blockNumber: toBigInt(row.block_number as string),
    blockTimestamp: row.block_timestamp as Date,
    from: nullableAddress(row.from_address),
    to: nullableAddress(row.to_address),
    receiver: nullableAddress(row.receiver),
    encryptedAmount: row.encrypted_amount === null ? null : (row.encrypted_amount as `0x${string}`),
    amount: nullableBigInt(row.amount),
    unwrapRequestId:
      row.unwrap_request_id === null ? null : (row.unwrap_request_id as `0x${string}`),
    decryptionStatus: row.decryption_status as StoredActivity["decryptionStatus"],
    decryptionReason: row.decryption_reason as StoredActivity["decryptionReason"],
    decryptedBy: nullableAddress(row.decrypted_by),
  };
}

export class PostgresActivityRepository implements ActivityRepository {
  constructor(private readonly pool: PostgresPool) {}

  async upsertIndexedEvent(event: IndexedEvent): Promise<void> {
    if (
      event.kind === DelegationEventKind.DelegationGranted ||
      event.kind === DelegationEventKind.DelegationRevoked
    )
      return;
    if (event.kind === TokenActivityKind.ConfidentialTransfer) {
      await this.insertActivity({
        kind: event.kind,
        chainId: event.chainId,
        tokenAddress: event.tokenAddress,
        txHash: event.txHash,
        logIndex: event.logIndex,
        blockNumber: event.blockNumber,
        blockTimestamp: event.blockTimestamp,
        from: event.from,
        to: event.to,
        receiver: null,
        encryptedAmount: event.encryptedAmount,
        amount: null,
        unwrapRequestId: null,
        decryptionStatus: DecryptionStatus.Pending,
        decryptionReason: DecryptionReason.MissingDelegation,
        decryptedBy: null,
      });
      return;
    }
    if (event.kind === TokenActivityKind.Shield) {
      await this.insertActivity({
        kind: event.kind,
        chainId: event.chainId,
        tokenAddress: event.tokenAddress,
        txHash: event.txHash,
        logIndex: event.logIndex,
        blockNumber: event.blockNumber,
        blockTimestamp: event.blockTimestamp,
        from: null,
        to: event.to,
        receiver: null,
        encryptedAmount: event.encryptedAmount,
        amount: event.amount,
        unwrapRequestId: null,
        decryptionStatus: DecryptionStatus.Decrypted,
        decryptionReason: null,
        decryptedBy: null,
      });
      return;
    }
    if (event.kind === TokenActivityKind.UnshieldRequested) {
      await this.insertActivity({
        kind: event.kind,
        chainId: event.chainId,
        tokenAddress: event.tokenAddress,
        txHash: event.txHash,
        logIndex: event.logIndex,
        blockNumber: event.blockNumber,
        blockTimestamp: event.blockTimestamp,
        from: null,
        to: null,
        receiver: event.receiver,
        encryptedAmount: event.encryptedAmount,
        amount: null,
        unwrapRequestId: event.unwrapRequestId,
        decryptionStatus: DecryptionStatus.Pending,
        decryptionReason: DecryptionReason.MissingDelegation,
        decryptedBy: null,
      });
      return;
    }
    await this.insertActivity({
      kind: event.kind,
      chainId: event.chainId,
      tokenAddress: event.tokenAddress,
      txHash: event.txHash,
      logIndex: event.logIndex,
      blockNumber: event.blockNumber,
      blockTimestamp: event.blockTimestamp,
      from: null,
      to: null,
      receiver: event.receiver,
      encryptedAmount: event.encryptedAmount,
      amount: event.amount,
      unwrapRequestId: event.unwrapRequestId,
      decryptionStatus: DecryptionStatus.Decrypted,
      decryptionReason: null,
      decryptedBy: null,
    });
  }

  async markActivityDecrypted(input: {
    chainId: number;
    txHash: StoredActivity["txHash"];
    logIndex: number;
    amount: bigint;
    decryptedBy: StoredActivity["to"];
  }): Promise<void> {
    await this.pool.query(
      `update activities set amount = $4, decryption_status = $5, decryption_reason = null, decrypted_by = lower($6), updated_at = now()
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

  async markActivityUndecrypted(input: {
    chainId: number;
    txHash: StoredActivity["txHash"];
    logIndex: number;
    status: StoredActivity["decryptionStatus"];
    reason: StoredActivity["decryptionReason"];
  }): Promise<void> {
    await this.pool.query(
      `update activities set decryption_status = $4, decryption_reason = $5, updated_at = now()
       where chain_id = $1 and tx_hash = $2 and log_index = $3`,
      [input.chainId, input.txHash, input.logIndex, input.status, input.reason],
    );
  }

  async listPendingDecryptions(limit: number): Promise<StoredActivity[]> {
    const result = await this.pool.query(
      `select * from activities
       where encrypted_amount is not null
       and kind <> $2
       and decryption_status = any($3)
       order by block_number asc, log_index asc
       limit $1`,
      [
        limit,
        TokenActivityKind.ConfidentialTransfer,
        [DecryptionStatus.Pending, DecryptionStatus.NotDelegated, DecryptionStatus.RetryableError],
      ],
    );
    return result.rows.map(mapActivity);
  }

  async listPendingDecryptionsForHolder(input: {
    chainId: number;
    tokenAddress: StoredActivity["tokenAddress"];
    holder: NonNullable<StoredActivity["to"]>;
    limit: number;
  }): Promise<StoredActivity[]> {
    const result = await this.pool.query(
      `select * from activities
       where chain_id = $1
       and token_address = lower($2)
       and (from_address = lower($3) or to_address = lower($3) or receiver = lower($3))
       and encrypted_amount is not null
       and kind <> $5
       and decryption_status = any($6)
       order by block_number asc, log_index asc
       limit $4`,
      [
        input.chainId,
        input.tokenAddress,
        input.holder,
        input.limit,
        TokenActivityKind.ConfidentialTransfer,
        [DecryptionStatus.Pending, DecryptionStatus.NotDelegated, DecryptionStatus.RetryableError],
      ],
    );
    return result.rows.map(mapActivity);
  }

  async listActivitiesForHolder(query: ActivityQuery): Promise<ActivityPage> {
    const result = await this.pool.query(
      `select * from activities
       where ($1::text is null or from_address = lower($1) or to_address = lower($1) or receiver = lower($1))
       and ($2::integer is null or chain_id = $2)
       and ($3::text is null or token_address = lower($3))
       and ($4::text is null or kind = $4)
       and ($5::text is null or decryption_status = $5)
       order by block_number desc, log_index desc
       limit $6 offset $7`,
      [
        query.holder,
        query.chainId ?? null,
        query.tokenAddress ?? null,
        query.kind ?? null,
        query.decryptionStatus ?? null,
        query.limit,
        query.offset,
      ],
    );
    return { items: result.rows.map(mapActivity), limit: query.limit, offset: query.offset };
  }

  private async insertActivity(activity: StoredActivity): Promise<void> {
    await this.pool.query(
      `insert into activities
       (kind, chain_id, token_address, tx_hash, log_index, block_number, block_timestamp, from_address, to_address, receiver, encrypted_amount, amount, unwrap_request_id, decryption_status, decryption_reason, decrypted_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
       on conflict (chain_id, tx_hash, log_index) do nothing`,
      [
        activity.kind,
        activity.chainId,
        activity.tokenAddress.toLowerCase(),
        activity.txHash,
        activity.logIndex,
        activity.blockNumber.toString(),
        activity.blockTimestamp,
        activity.from?.toLowerCase() ?? null,
        activity.to?.toLowerCase() ?? null,
        activity.receiver?.toLowerCase() ?? null,
        activity.encryptedAmount,
        activity.amount?.toString() ?? null,
        activity.unwrapRequestId,
        activity.decryptionStatus,
        activity.decryptionReason,
        activity.decryptedBy?.toLowerCase() ?? null,
      ],
    );
  }
}
