import type {
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
  };
  createToken(address: `0x${string}`): ZamaTokenLike;
}

export type ZamaSdkFactory = (chainId: number) => ZamaSdkLike;

export function mapZamaError(
  error: unknown,
): Exclude<DecryptAmountResult, { status: "decrypted" }> {
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
