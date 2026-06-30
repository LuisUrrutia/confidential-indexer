import type {
  ActivityPage,
  ActivityQuery,
  HealthSnapshot,
  ReadModel,
  BalanceQuery,
  BalancePage,
  TransferQuery,
  TransferPage,
} from "@confidential-indexer/core";
import type { Pool } from "./connection.js";
import { PostgresRepositories } from "./PostgresRepositories.js";

function nullableBigInt(value: unknown): bigint | null {
  if (value === null || value === undefined) return null;
  return typeof value === "bigint" ? value : BigInt(value as string | number);
}
export class PostgresReadModel implements ReadModel {
  private readonly repos: PostgresRepositories;

  constructor(
    private readonly pool: Pool,
    private readonly sourceName: string,
  ) {
    this.repos = new PostgresRepositories(pool, sourceName);
  }

  async getBalances(query: BalanceQuery): Promise<BalancePage> {
    return this.repos.balances.listBalances(query);
  }

  async getTransfers(query: TransferQuery): Promise<TransferPage> {
    return this.repos.transfers.listTransfersForHolder(query);
  }

  async getActivities(query: ActivityQuery): Promise<ActivityPage> {
    return this.repos.activities.listActivitiesForHolder(query);
  }

  async getHealth(): Promise<HealthSnapshot> {
    try {
      await this.pool.query("select 1");
      const cursor = await this.repos.checkpoints.getCursor(this.sourceName);
      const pressure = await this.pool.query(
        `with decryptable_events as (
          select chain_id, token_address, decryption_status, block_number, block_timestamp from transfers
          union all
          select chain_id, token_address, decryption_status, block_number, block_timestamp from activities
          where encrypted_amount is not null
            and kind <> 'confidential_transfer'
        ),
        pressure as (
          select
            chain_id,
            token_address,
            count(*) filter (where decryption_status in ('pending','not_delegated')) as pending,
            count(*) filter (where decryption_status = 'retryable_error') as retryable,
            count(*) filter (where decryption_status = 'failed') as failed,
            max(block_timestamp) as last_indexed_at,
            max(block_number) as last_indexed_block
          from decryptable_events
          group by chain_id, token_address
        ),
        heads as (
          select chain_id, token_address, max(head_block) as head_block
          from source_heads
          where source_name = $1
          group by chain_id, token_address
        )
        select
          coalesce(pressure.chain_id, heads.chain_id) as chain_id,
          coalesce(pressure.token_address, heads.token_address) as token_address,
          coalesce(pressure.pending, 0) as pending,
          coalesce(pressure.retryable, 0) as retryable,
          coalesce(pressure.failed, 0) as failed,
          pressure.last_indexed_at,
          pressure.last_indexed_block,
          heads.head_block
        from pressure
        full outer join heads using (chain_id, token_address)
        order by chain_id, token_address`,
        [this.sourceName],
      );
      const rows = pressure.rows as Array<Record<string, unknown>>;
      const sources =
        rows.length === 0
          ? [
              {
                sourceName: this.sourceName,
                chainId: null,
                tokenAddress: null,
                cursor,
                pendingDecryptions: 0,
                retryableDecryptions: 0,
                failedDecryptions: 0,
                lastIndexedAt: null,
                lastIndexedBlock: null,
                headBlock: null,
                blocksBehind: null,
              },
            ]
          : rows.map((row) => {
              const lastIndexedBlock = nullableBigInt(row.last_indexed_block);
              const headBlock = nullableBigInt(row.head_block);
              const blocksBehind =
                lastIndexedBlock === null || headBlock === null
                  ? null
                  : headBlock > lastIndexedBlock
                    ? headBlock - lastIndexedBlock
                    : 0n;
              return {
                sourceName: this.sourceName,
                chainId: Number(row.chain_id),
                tokenAddress: row.token_address as `0x${string}`,
                cursor,
                pendingDecryptions: Number(row.pending ?? 0),
                retryableDecryptions: Number(row.retryable ?? 0),
                failedDecryptions: Number(row.failed ?? 0),
                lastIndexedAt: (row.last_indexed_at as Date | null | undefined) ?? null,
                lastIndexedBlock,
                headBlock,
                blocksBehind,
              };
            });
      return {
        ok: true,
        database: "up",
        checkpoints: [{ sourceName: this.sourceName, cursor }],
        sources,
      };
    } catch {
      return { ok: false, database: "down", checkpoints: [], sources: [] };
    }
  }
}
