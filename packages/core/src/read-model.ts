import type { Address } from "./addresses.js";
import type { ActivityPage, ActivityQuery } from "./activities.js";
import type { BalancePage, BalanceQuery } from "./balances.js";
import type { EventCursor } from "./events.js";
import type { TransferPage, TransferQuery } from "./transfers.js";

export interface HealthSourceSnapshot {
  sourceName: string;
  chainId: number | null;
  tokenAddress: Address | null;
  cursor: EventCursor | null;
  pendingDecryptions: number;
  retryableDecryptions: number;
  failedDecryptions: number;
  lastIndexedAt: Date | null;
  lastIndexedBlock: bigint | null;
  headBlock: bigint | null;
  blocksBehind: bigint | null;
}

export interface HealthSnapshot {
  ok: boolean;
  database: "up" | "down";
  checkpoints: Array<{ sourceName: string; cursor: EventCursor | null }>;
  sources: HealthSourceSnapshot[];
}

export interface ReadModel {
  getBalances(query: BalanceQuery): Promise<BalancePage>;
  getTransfers(query: TransferQuery): Promise<TransferPage>;
  getActivities(query: ActivityQuery): Promise<ActivityPage>;
  getHealth(): Promise<HealthSnapshot>;
}
