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
export type TokenActivityKind =
  | "confidential_transfer"
  | "shield"
  | "unshield_requested"
  | "unshield_finalized";

export interface EventCursor {
  blockNumber: bigint;
  logIndex: number;
}

export interface IndexedEventBase {
  chainId: number;
  tokenAddress: Address;
  txHash: Hex;
  logIndex: number;
  blockNumber: bigint;
  blockTimestamp: Date;
}

export interface ConfidentialTransferEvent extends IndexedEventBase {
  kind: "confidential_transfer";
  from: Address;
  to: Address;
  encryptedAmount: Hex;
}

export interface ShieldEvent extends IndexedEventBase {
  kind: "shield";
  to: Address;
  encryptedAmount: Hex;
  amount: bigint;
}

export interface UnshieldRequestedEvent extends IndexedEventBase {
  kind: "unshield_requested";
  receiver: Address;
  encryptedAmount: Hex;
  unwrapRequestId: Hex | null;
}

export interface UnshieldFinalizedEvent extends IndexedEventBase {
  kind: "unshield_finalized";
  receiver: Address;
  encryptedAmount: Hex;
  amount: bigint;
  unwrapRequestId: Hex | null;
}

export interface DelegationGrantedEvent extends IndexedEventBase {
  kind: "delegation_granted";
  delegator: Address;
  delegate: Address;
  expiresAt: Date | null;
}

export interface DelegationRevokedEvent extends IndexedEventBase {
  kind: "delegation_revoked";
  delegator: Address;
  delegate: Address;
}

export type TokenIndexedEvent =
  | ConfidentialTransferEvent
  | ShieldEvent
  | UnshieldRequestedEvent
  | UnshieldFinalizedEvent;

export type IndexedEvent = TokenIndexedEvent | DelegationGrantedEvent | DelegationRevokedEvent;

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
  decryptedBy: Address | null;
}

export interface StoredActivity {
  kind: TokenActivityKind;
  chainId: number;
  tokenAddress: Address;
  txHash: Hex;
  logIndex: number;
  blockNumber: bigint;
  blockTimestamp: Date;
  from: Address | null;
  to: Address | null;
  receiver: Address | null;
  encryptedAmount: Hex | null;
  amount: bigint | null;
  unwrapRequestId: Hex | null;
  decryptionStatus: DecryptionStatus;
  decryptionReason: DecryptionReason;
  decryptedBy: Address | null;
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

export interface BatchDecryptTransferAmountsInput {
  chainId: number;
  tokenAddress: Address;
  holder: Address;
  encryptedAmounts: Hex[];
}

export interface BatchDecryptTransferAmountResult {
  encryptedAmount: Hex;
  result: DecryptAmountResult;
}

export interface UndecryptedAmountResult {
  status: Exclude<DecryptionStatus, "decrypted">;
  reason: Exclude<DecryptionReason, null>;
}

export type DecryptAmountResult = { status: "decrypted"; amount: bigint } | UndecryptedAmountResult;

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
