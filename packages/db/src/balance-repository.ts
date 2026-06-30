import type {
  BalancePage,
  BalanceQuery,
  BalanceRecord,
  BalanceRepository,
  StoredTransfer,
} from "@confidential-indexer/core";
import type { PostgresPool } from "./postgres-pool.js";

function toBigInt(value: string | number | bigint): bigint {
  return typeof value === "bigint" ? value : BigInt(value);
}

export class PostgresBalanceRepository implements BalanceRepository {
  constructor(private readonly pool: PostgresPool) {}

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
