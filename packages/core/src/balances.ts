import type { Address } from "./addresses.js";
import type { StoredTransfer } from "./transfers.js";

export const BalanceStatus = {
  Known: "known",
  Unknown: "unknown",
} as const;

export type BalanceStatus = (typeof BalanceStatus)[keyof typeof BalanceStatus];

export const BALANCE_STATUS_VALUES = [
  BalanceStatus.Known,
  BalanceStatus.Unknown,
] as const satisfies readonly BalanceStatus[];

export const BalanceSource = {
  Events: "events",
  DirectDecrypt: "direct_decrypt",
  None: "none",
} as const;

export type BalanceSource = (typeof BalanceSource)[keyof typeof BalanceSource];

export const BALANCE_SOURCE_VALUES = [
  BalanceSource.Events,
  BalanceSource.DirectDecrypt,
  BalanceSource.None,
] as const satisfies readonly BalanceSource[];

export const HistoryCompleteness = {
  Complete: "complete",
  Partial: "partial",
  Unknown: "unknown",
} as const;

export type HistoryCompleteness = (typeof HistoryCompleteness)[keyof typeof HistoryCompleteness];

export const HISTORY_COMPLETENESS_VALUES = [
  HistoryCompleteness.Complete,
  HistoryCompleteness.Partial,
  HistoryCompleteness.Unknown,
] as const satisfies readonly HistoryCompleteness[];

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
