import type { Address } from "./addresses.js";
import type { StoredTransfer } from "./transfers.js";

export type BalanceStatus = "known" | "unknown";
export type BalanceSource = "events" | "direct_decrypt" | "none";
export type HistoryCompleteness = "complete" | "partial" | "unknown";

export interface BalanceRecord {
  chainId: number;
  tokenAddress: Address;
  holder: Address;
  balance: bigint | null;
  balanceStatus: BalanceStatus;
  balanceSource: BalanceSource;
  historyCompleteness: HistoryCompleteness;
  updatedAt: Date;
}

export interface BalanceQuery {
  holder: Address;
  chainId?: number;
  tokenAddress?: Address;
}

export interface BalancePage {
  items: BalanceRecord[];
}

export interface BalanceRepository {
  applyDecryptedTransfer(transfer: StoredTransfer, amount: bigint): Promise<void>;
  saveDirectBalance(record: BalanceRecord): Promise<void>;
  listBalances(query: BalanceQuery): Promise<BalancePage>;
}
