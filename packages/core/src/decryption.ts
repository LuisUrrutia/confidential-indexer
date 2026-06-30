import type { Address, Hex } from "./addresses.js";
import { BalanceSource, BalanceStatus } from "./balances.js";

export const DecryptionStatus = {
  Pending: "pending",
  NotDelegated: "not_delegated",
  RetryableError: "retryable_error",
  Failed: "failed",
  Decrypted: "decrypted",
} as const;

export type DecryptionStatus = (typeof DecryptionStatus)[keyof typeof DecryptionStatus];

export const DECRYPTION_STATUS_VALUES = [
  DecryptionStatus.Pending,
  DecryptionStatus.NotDelegated,
  DecryptionStatus.RetryableError,
  DecryptionStatus.Failed,
  DecryptionStatus.Decrypted,
] as const satisfies readonly DecryptionStatus[];

export const DecryptionReason = {
  MissingDelegation: "missing_delegation",
  DelegationPropagating: "delegation_propagating",
  RelayerUnavailable: "relayer_unavailable",
  SdkError: "sdk_error",
  MalformedEvent: "malformed_event",
  None: null,
} as const;

export type DecryptionReason = (typeof DecryptionReason)[keyof typeof DecryptionReason];

export const DECRYPTION_REASON_VALUES = [
  DecryptionReason.MissingDelegation,
  DecryptionReason.DelegationPropagating,
  DecryptionReason.RelayerUnavailable,
  DecryptionReason.SdkError,
  DecryptionReason.MalformedEvent,
  DecryptionReason.None,
] as const satisfies readonly DecryptionReason[];

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
  status: Exclude<DecryptionStatus, typeof DecryptionStatus.Decrypted>;
  reason: Exclude<DecryptionReason, null>;
}

export type DecryptAmountResult =
  | { status: typeof DecryptionStatus.Decrypted; amount: bigint }
  | UndecryptedAmountResult;

export interface RefreshBalanceInput {
  chainId: number;
  tokenAddress: Address;
  holder: Address;
}

export type RefreshBalanceResult =
  | {
      status: typeof BalanceStatus.Known;
      balance: bigint;
      source: typeof BalanceSource.DirectDecrypt;
    }
  | {
      status: typeof BalanceStatus.Unknown;
      reason: Exclude<DecryptionReason, null>;
    };

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
