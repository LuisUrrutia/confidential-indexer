import type {
  ActivityPage,
  ActivityQuery,
  ActivityRepository,
  BalancePage,
  BalanceQuery,
  BalanceRecord,
  CheckpointRepository,
  DecryptionAttemptRepository,
  DelegationRepository,
  EventCursor,
  IndexedEvent,
  StoredActivity,
  StoredTransfer,
  TransferPage,
  TransferQuery,
  TransferRepository,
  BalanceRepository,
} from "@confidential-indexer/core";
import type { Pool } from "./connection.js";

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

export class PostgresRepositories {
  readonly checkpoints: CheckpointRepository;
  readonly transfers: TransferRepository;
  readonly activities: ActivityRepository;
  readonly delegations: DelegationRepository;
  readonly balances: BalanceRepository;
  readonly attempts: DecryptionAttemptRepository;

  constructor(pool: Pool, sourceName: string) {
    this.checkpoints = new PgCheckpointRepository(pool, sourceName);
    this.transfers = new PgTransferRepository(pool);
    this.activities = new PgActivityRepository(pool);
    this.delegations = new PgDelegationRepository(pool);
    this.balances = new PgBalanceRepository(pool);
    this.attempts = new PgDecryptionAttemptRepository(pool);
  }
}

class PgCheckpointRepository implements CheckpointRepository {
  constructor(
    private readonly pool: Pool,
    private readonly sourceName: string,
  ) {}

  async getCursor(): Promise<EventCursor | null> {
    const result = await this.pool.query(
      "select block_number, log_index from event_checkpoints where source_name = $1",
      [this.sourceName],
    );
    const row = result.rows[0];
    if (!row || row.block_number === null || row.log_index === null) return null;
    return { blockNumber: toBigInt(row.block_number), logIndex: Number(row.log_index) };
  }

  async saveCursor(_sourceName: string, cursor: EventCursor | null): Promise<void> {
    await this.pool.query(
      `insert into event_checkpoints (source_name, block_number, log_index)
       values ($1, $2, $3)
       on conflict (source_name) do update set block_number = excluded.block_number, log_index = excluded.log_index, updated_at = now()`,
      [this.sourceName, cursor?.blockNumber.toString() ?? null, cursor?.logIndex ?? null],
    );
  }
}

class PgTransferRepository implements TransferRepository {
  constructor(private readonly pool: Pool) {}

  async upsertIndexedEvent(event: IndexedEvent): Promise<void> {
    if (event.kind !== "confidential_transfer") return;
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
      `select * from transfers where decryption_status in ('pending','not_delegated','retryable_error') order by block_number asc, log_index asc limit $1`,
      [limit],
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
       and decryption_status in ('pending','not_delegated','retryable_error')
       order by block_number asc, log_index asc
       limit $4`,
      [input.chainId, input.tokenAddress, input.holder, input.limit],
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
      `update transfers set amount = $4, decryption_status = 'decrypted', decryption_reason = null, decrypted_by = lower($5), updated_at = now()
       where chain_id = $1 and tx_hash = $2 and log_index = $3`,
      [input.chainId, input.txHash, input.logIndex, input.amount.toString(), input.decryptedBy],
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

class PgActivityRepository implements ActivityRepository {
  constructor(private readonly pool: Pool) {}

  async upsertIndexedEvent(event: IndexedEvent): Promise<void> {
    if (event.kind === "delegation_granted" || event.kind === "delegation_revoked") return;
    if (event.kind === "confidential_transfer") {
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
        decryptionStatus: "pending",
        decryptionReason: "missing_delegation",
        decryptedBy: null,
      });
      return;
    }
    if (event.kind === "shield") {
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
        decryptionStatus: "decrypted",
        decryptionReason: null,
        decryptedBy: null,
      });
      return;
    }
    if (event.kind === "unshield_requested") {
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
        decryptionStatus: "pending",
        decryptionReason: "missing_delegation",
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
      decryptionStatus: "decrypted",
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
      `update activities set amount = $4, decryption_status = 'decrypted', decryption_reason = null, decrypted_by = lower($5), updated_at = now()
       where chain_id = $1 and tx_hash = $2 and log_index = $3`,
      [input.chainId, input.txHash, input.logIndex, input.amount.toString(), input.decryptedBy],
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
       and kind <> 'confidential_transfer'
       and decryption_status in ('pending','not_delegated','retryable_error')
       order by block_number asc, log_index asc
       limit $1`,
      [limit],
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
       and kind <> 'confidential_transfer'
       and decryption_status in ('pending','not_delegated','retryable_error')
       order by block_number asc, log_index asc
       limit $4`,
      [input.chainId, input.tokenAddress, input.holder, input.limit],
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

class PgDelegationRepository implements DelegationRepository {
  constructor(private readonly pool: Pool) {}

  async upsertGrant(event: Extract<IndexedEvent, { kind: "delegation_granted" }>): Promise<void> {
    await this.pool.query(
      `insert into delegations (chain_id, token_address, delegator, delegate, active, expires_at, updated_at)
       values ($1,$2,$3,$4,true,$5,now())
       on conflict (chain_id, token_address, delegator, delegate) do update set
       active = true, expires_at = excluded.expires_at, updated_at = now()`,
      [
        event.chainId,
        event.tokenAddress.toLowerCase(),
        event.delegator.toLowerCase(),
        event.delegate.toLowerCase(),
        event.expiresAt,
      ],
    );
  }

  async markRevoked(event: Extract<IndexedEvent, { kind: "delegation_revoked" }>): Promise<void> {
    await this.pool.query(
      `insert into delegations (chain_id, token_address, delegator, delegate, active, updated_at)
       values ($1,$2,$3,$4,false,now())
       on conflict (chain_id, token_address, delegator, delegate) do update set active = false, updated_at = now()`,
      [
        event.chainId,
        event.tokenAddress.toLowerCase(),
        event.delegator.toLowerCase(),
        event.delegate.toLowerCase(),
      ],
    );
  }

  async listActiveDelegators(input: {
    chainId: number;
    tokenAddress: StoredTransfer["tokenAddress"];
  }): Promise<StoredTransfer["to"][]> {
    const result = await this.pool.query(
      `select delegator from delegations
       where chain_id = $1
       and token_address = lower($2)
       and active = true
       and (expires_at is null or expires_at > now())
       order by updated_at desc`,
      [input.chainId, input.tokenAddress],
    );
    return result.rows.map((row) => row.delegator as StoredTransfer["to"]);
  }

  async isActive(input: {
    chainId: number;
    tokenAddress: StoredTransfer["tokenAddress"];
    delegator: StoredTransfer["to"];
    delegate?: StoredTransfer["to"];
  }): Promise<boolean> {
    const result = await this.pool.query(
      `select 1 from delegations
       where chain_id = $1
       and token_address = lower($2)
       and delegator = lower($3)
       and ($4::text is null or delegate = lower($4))
       and active = true
       and (expires_at is null or expires_at > now())
       limit 1`,
      [input.chainId, input.tokenAddress, input.delegator, input.delegate ?? null],
    );
    return result.rowCount === 1;
  }
}

class PgBalanceRepository implements BalanceRepository {
  constructor(private readonly pool: Pool) {}

  async applyDecryptedTransfer(transfer: StoredTransfer, amount: bigint): Promise<void> {
    await this.upsertDelta(transfer.chainId, transfer.tokenAddress, transfer.from, -amount);
    await this.upsertDelta(transfer.chainId, transfer.tokenAddress, transfer.to, amount);
  }

  async saveDirectBalance(record: BalanceRecord): Promise<void> {
    await this.pool.query(
      `insert into balances (chain_id, token_address, holder, balance, balance_status, balance_source, history_completeness, updated_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8)
       on conflict (chain_id, token_address, holder) do update set
       balance = excluded.balance, balance_status = excluded.balance_status, balance_source = excluded.balance_source,
       history_completeness = excluded.history_completeness, updated_at = excluded.updated_at`,
      [
        record.chainId,
        record.tokenAddress.toLowerCase(),
        record.holder.toLowerCase(),
        record.balance?.toString() ?? null,
        record.balanceStatus,
        record.balanceSource,
        record.historyCompleteness,
        record.updatedAt,
      ],
    );
  }

  async listBalances(query: BalanceQuery): Promise<BalancePage> {
    const result = await this.pool.query(
      `select * from balances where holder = lower($1)
       and ($2::integer is null or chain_id = $2)
       and ($3::text is null or token_address = lower($3))
       order by chain_id asc, token_address asc`,
      [query.holder, query.chainId ?? null, query.tokenAddress ?? null],
    );
    return {
      items: result.rows.map((row) => ({
        chainId: Number(row.chain_id),
        tokenAddress: row.token_address,
        holder: row.holder,
        balance: row.balance === null ? null : toBigInt(row.balance),
        balanceStatus: row.balance_status,
        balanceSource: row.balance_source,
        historyCompleteness: row.history_completeness,
        updatedAt: row.updated_at,
      })),
    };
  }

  private async upsertDelta(
    chainId: number,
    tokenAddress: string,
    holder: string,
    delta: bigint,
  ): Promise<void> {
    await this.pool.query(
      `insert into balances (chain_id, token_address, holder, balance, balance_status, balance_source, history_completeness)
       values ($1,$2,$3,$4,'known','events','partial')
       on conflict (chain_id, token_address, holder) do update set
       balance = coalesce(balances.balance, 0) + excluded.balance,
       balance_status = 'known', balance_source = 'events', history_completeness = 'partial', updated_at = now()`,
      [chainId, tokenAddress.toLowerCase(), holder.toLowerCase(), delta.toString()],
    );
  }
}

class PgDecryptionAttemptRepository implements DecryptionAttemptRepository {
  constructor(private readonly pool: Pool) {}

  async recordAttempt(input: {
    chainId: number;
    tokenAddress: StoredTransfer["tokenAddress"];
    txHash: StoredTransfer["txHash"];
    logIndex: number;
    status: StoredTransfer["decryptionStatus"];
    reason: StoredTransfer["decryptionReason"];
    message: string | null;
  }): Promise<void> {
    await this.pool.query(
      `insert into decryption_attempts (chain_id, token_address, tx_hash, log_index, status, reason, message)
       values ($1,$2,$3,$4,$5,$6,$7)`,
      [
        input.chainId,
        input.tokenAddress.toLowerCase(),
        input.txHash,
        input.logIndex,
        input.status,
        input.reason,
        input.message,
      ],
    );
  }
}
