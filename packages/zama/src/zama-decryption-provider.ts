import { ZamaErrorCode, matchZamaError } from "@zama-fhe/sdk";
import type {
  BatchDecryptTransferAmountResult,
  BatchDecryptTransferAmountsInput,
  DecryptAmountResult,
  DecryptionProvider,
  DecryptTransferAmountInput,
  RefreshBalanceInput,
  RefreshBalanceResult,
} from "@confidential-indexer/core";

export interface ZamaTokenLike {
  decryptBalanceAs(input: { delegatorAddress: `0x${string}` }): Promise<bigint>;
}

export interface ZamaSdkLike {
  decryption: {
    delegatedDecryptValues(
      inputs: Array<{ encryptedValue: `0x${string}`; contractAddress: `0x${string}` }>,
      delegatorAddress: `0x${string}`,
    ): Promise<Record<`0x${string}`, bigint | string | number>>;
    delegatedBatchDecryptValues?(input: {
      encryptedInputs: Array<{ encryptedValue: `0x${string}`; contractAddress: `0x${string}` }>;
      delegatorAddress: `0x${string}`;
      maxConcurrency?: number;
    }): Promise<{
      items: Array<{
        encryptedValue: `0x${string}`;
        contractAddress: `0x${string}`;
        value?: bigint | string | number;
        error?: unknown;
      }>;
    }>;
  };
  createToken(address: `0x${string}`): ZamaTokenLike;
  terminate?(): void;
}

export type ZamaSdkFactory = (chainId: number) => ZamaSdkLike;

export function mapZamaError(
  error: unknown,
): Exclude<DecryptAmountResult, { status: "decrypted" }> {
  const typed = matchZamaError<Exclude<DecryptAmountResult, { status: "decrypted" }> | undefined>(
    error,
    {
      [ZamaErrorCode.DelegationNotFound]: () => ({
        status: "not_delegated",
        reason: "missing_delegation",
      }),
      [ZamaErrorCode.DelegationExpired]: () => ({
        status: "not_delegated",
        reason: "missing_delegation",
      }),
      [ZamaErrorCode.NoCiphertext]: () => ({
        status: "not_delegated",
        reason: "missing_delegation",
      }),
      [ZamaErrorCode.DelegationNotPropagated]: () => ({
        status: "retryable_error",
        reason: "delegation_propagating",
      }),
      [ZamaErrorCode.RelayerRequestFailed]: (relayerError) => ({
        status: "retryable_error",
        reason:
          relayerError.statusCode === undefined || relayerError.statusCode >= 500
            ? "relayer_unavailable"
            : "sdk_error",
      }),
      [ZamaErrorCode.DecryptionFailed]: () => ({
        status: "retryable_error",
        reason: "sdk_error",
      }),
      _: () => undefined,
    },
  );
  if (typed) return typed;

  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();
  if (
    normalized.includes("delegationnotfound") ||
    normalized.includes("no active delegation") ||
    normalized.includes("expired")
  ) {
    return { status: "not_delegated", reason: "missing_delegation" };
  }
  if (
    normalized.includes("propagat") ||
    normalized.includes("sync") ||
    normalized.includes("acl state")
  ) {
    return { status: "retryable_error", reason: "delegation_propagating" };
  }
  if (
    normalized.includes("gateway") ||
    (normalized.includes("relayer") && normalized.includes("unavailable"))
  ) {
    return { status: "retryable_error", reason: "relayer_unavailable" };
  }
  return { status: "retryable_error", reason: "sdk_error" };
}

export class ZamaDecryptionProvider implements DecryptionProvider {
  constructor(private readonly sdkForChain: ZamaSdkFactory) {}

  async decryptTransferAmount(input: DecryptTransferAmountInput): Promise<DecryptAmountResult> {
    try {
      const sdk = this.sdkForChain(input.chainId);
      const values = await sdk.decryption.delegatedDecryptValues(
        [{ encryptedValue: input.encryptedAmount, contractAddress: input.tokenAddress }],
        input.holder,
      );
      const clear = values[input.encryptedAmount];
      if (clear === undefined) return { status: "retryable_error", reason: "sdk_error" };
      return { status: "decrypted", amount: BigInt(clear) };
    } catch (error) {
      return mapZamaError(error);
    }
  }
  async batchDecryptTransferAmounts(
    input: BatchDecryptTransferAmountsInput,
  ): Promise<BatchDecryptTransferAmountResult[]> {
    try {
      const sdk = this.sdkForChain(input.chainId);
      if (!sdk.decryption.delegatedBatchDecryptValues) {
        return Promise.all(
          input.encryptedAmounts.map(async (encryptedAmount) => ({
            encryptedAmount,
            result: await this.decryptTransferAmount({ ...input, encryptedAmount }),
          })),
        );
      }

      const batch = await sdk.decryption.delegatedBatchDecryptValues({
        encryptedInputs: input.encryptedAmounts.map((encryptedValue) => ({
          encryptedValue,
          contractAddress: input.tokenAddress,
        })),
        delegatorAddress: input.holder,
      });
      const byEncryptedValue = new Map(batch.items.map((item) => [item.encryptedValue, item]));

      return input.encryptedAmounts.map((encryptedAmount) => {
        const item = byEncryptedValue.get(encryptedAmount);
        if (!item) {
          return { encryptedAmount, result: { status: "retryable_error", reason: "sdk_error" } };
        }
        if (item.error) {
          return { encryptedAmount, result: mapZamaError(item.error) };
        }
        if (item.value === undefined) {
          return { encryptedAmount, result: { status: "retryable_error", reason: "sdk_error" } };
        }
        return { encryptedAmount, result: { status: "decrypted", amount: BigInt(item.value) } };
      });
    } catch (error) {
      const result = mapZamaError(error);
      return input.encryptedAmounts.map((encryptedAmount) => ({ encryptedAmount, result }));
    }
  }
  async refreshCurrentBalance(input: RefreshBalanceInput): Promise<RefreshBalanceResult> {
    try {
      const sdk = this.sdkForChain(input.chainId);
      const token = sdk.createToken(input.tokenAddress);
      const balance = await token.decryptBalanceAs({ delegatorAddress: input.holder });
      return { status: "known", balance, source: "direct_decrypt" };
    } catch (error) {
      const mapped = mapZamaError(error);
      return { status: "unknown", reason: mapped.reason };
    }
  }
}
