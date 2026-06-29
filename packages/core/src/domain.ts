export type Hex = `0x${string}`;
export type Address = `0x${string}`;

export type DecryptionStatus =
  | "pending"
  | "not_delegated"
  | "retryable_error"
  | "failed"
  | "decrypted";

export type DecryptionReason =
  | "missing_delegation"
  | "delegation_propagating"
  | "relayer_unavailable"
  | "sdk_error"
  | "malformed_event"
  | null;

export type BalanceStatus = "known" | "unknown";
export type BalanceSource = "events" | "direct_decrypt" | "none";
export type HistoryCompleteness = "complete" | "partial" | "unknown";

export interface EventCursor {
  blockNumber: bigint;
  logIndex: number;
}

export interface ConfidentialTransferEvent {
  kind: "confidential_transfer";
  chainId: number;
  tokenAddress: Address;
  txHash: Hex;
  logIndex: number;
  blockNumber: bigint;
  blockTimestamp: Date;
  from: Address;
  to: Address;
  encryptedAmount: Hex;
}

export interface DelegationGrantedEvent {
  kind: "delegation_granted";
  chainId: number;
  tokenAddress: Address;
  txHash: Hex;
  logIndex: number;
  blockNumber: bigint;
  blockTimestamp: Date;
  delegator: Address;
  delegate: Address;
  expiresAt: Date | null;
}

export interface DelegationRevokedEvent {
  kind: "delegation_revoked";
  chainId: number;
  tokenAddress: Address;
  txHash: Hex;
  logIndex: number;
  blockNumber: bigint;
  blockTimestamp: Date;
  delegator: Address;
  delegate: Address;
}

export type IndexedEvent = ConfidentialTransferEvent | DelegationGrantedEvent | DelegationRevokedEvent;

export interface IndexedEventBatch {
  events: IndexedEvent[];
  nextCursor: EventCursor | null;
}

export interface StoredTransfer {
  chainId: number;
  tokenAddress: Address;
  txHash: Hex;
  logIndex: number;
  blockNumber: bigint;
  blockTimestamp: Date;
  from: Address;
  to: Address;
  encryptedAmount: Hex;
  amount: bigint | null;
  decryptionStatus: DecryptionStatus;
  decryptionReason: DecryptionReason;
}

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

export interface DecryptTransferAmountInput {
  chainId: number;
  tokenAddress: Address;
  holder: Address;
  encryptedAmount: Hex;
}

export type DecryptAmountResult =
  | { status: "decrypted"; amount: bigint }
  | { status: Exclude<DecryptionStatus, "decrypted">; reason: Exclude<DecryptionReason, null> };

export interface RefreshBalanceInput {
  chainId: number;
  tokenAddress: Address;
  holder: Address;
}

export type RefreshBalanceResult =
  | { status: "known"; balance: bigint; source: "direct_decrypt" }
  | { status: "unknown"; reason: Exclude<DecryptionReason, null> };

export interface IngestionReport {
  ingested: number;
  nextCursor: EventCursor | null;
}

export interface DecryptionReport {
  attempted: number;
  decrypted: number;
  pending: number;
  failed: number;
}

export interface BackfillHolderInput {
  chainId: number;
  tokenAddress: Address;
  holder: Address;
}

export interface BackfillReport {
  holder: Address;
  transferReport: DecryptionReport;
  balanceRefreshed: boolean;
}
