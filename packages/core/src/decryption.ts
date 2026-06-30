import type { Address, Hex } from "./addresses.js";

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

export interface DecryptionReport {
  attempted: number;
  decrypted: number;
  pending: number;
  failed: number;
}

export interface DecryptionProvider {
  decryptTransferAmount(input: DecryptTransferAmountInput): Promise<DecryptAmountResult>;
  batchDecryptTransferAmounts(
    input: BatchDecryptTransferAmountsInput,
  ): Promise<BatchDecryptTransferAmountResult[]>;
  refreshCurrentBalance(input: RefreshBalanceInput): Promise<RefreshBalanceResult>;
}
