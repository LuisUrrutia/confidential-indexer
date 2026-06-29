import type {
  BalancePage,
  BalanceQuery,
  BalanceRecord,
  CheckpointRepository,
  DecryptionAttemptRepository,
  EventCursor,
  IndexedEvent,
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
    amount: row.amount === null ? null : toBigInt(row.amount as string),
    decryptionStatus: row.decryption_status as StoredTransfer["decryptionStatus"],
    decryptionReason: row.decryption_reason as StoredTransfer["decryptionReason"],
  };
}

export class PostgresRepositories {
  readonly checkpoints: CheckpointRepository;
  readonly transfers: TransferRepository;
  readonly balances: BalanceRepository;
  readonly attempts: DecryptionAttemptRepository;

  constructor(pool: Pool, sourceName: string) {
    this.checkpoints = new PgCheckpointRepository(pool, sourceName);
    this.transfers = new PgTransferRepository(pool);
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

  async markTransferDecrypted(input: {
    chainId: number;
    txHash: StoredTransfer["txHash"];
    logIndex: number;
    amount: bigint;
  }): Promise<void> {
    await this.pool.query(
      `update transfers set amount = $4, decryption_status = 'decrypted', decryption_reason = null, updated_at = now()
       where chain_id = $1 and tx_hash = $2 and log_index = $3`,
      [input.chainId, input.txHash, input.logIndex, input.amount.toString()],
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
