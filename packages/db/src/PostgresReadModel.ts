import type { HealthSnapshot, ReadModel, BalanceQuery, BalancePage, TransferQuery, TransferPage } from "@confidential-indexer/core";
import type { Pool } from "./connection.js";
import { PostgresRepositories } from "./PostgresRepositories.js";

export class PostgresReadModel implements ReadModel {
  private readonly repos: PostgresRepositories;

  constructor(private readonly pool: Pool, sourceName: string) {
    this.repos = new PostgresRepositories(pool, sourceName);
  }

  async getBalances(query: BalanceQuery): Promise<BalancePage> {
    return this.repos.balances.listBalances(query);
  }

  async getTransfers(query: TransferQuery): Promise<TransferPage> {
    return this.repos.transfers.listTransfersForHolder(query);
  }

  async getHealth(): Promise<HealthSnapshot> {
    try {
      await this.pool.query("select 1");
      const cursor = await this.repos.checkpoints.getCursor("hyperindex");
      return { ok: true, database: "up", checkpoints: [{ sourceName: "hyperindex", cursor }] };
    } catch {
      return { ok: false, database: "down", checkpoints: [] };
    }
  }
}
