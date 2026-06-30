import { describe, expect, it } from "vitest";
import { mapZamaError, ZamaDecryptionProvider } from "../src/index.js";

describe("mapZamaError", () => {
  it("maps delegation errors to not_delegated", () => {
    expect(mapZamaError(new Error("DelegationNotFoundError: no active delegation"))).toEqual({
      status: "not_delegated",
      reason: "missing_delegation",
    });
  });

  it("maps propagation-like errors to retryable_error", () => {
    expect(mapZamaError(new Error("gateway has not synced ACL state yet"))).toEqual({
      status: "retryable_error",
      reason: "delegation_propagating",
    });
  });

  it("maps unknown SDK errors to retryable_error", () => {
    expect(mapZamaError(new Error("relayer request failed"))).toEqual({
      status: "retryable_error",
      reason: "sdk_error",
    });
  });
});

describe("ZamaDecryptionProvider", () => {
  it("batch decrypts alpha encrypted values and keeps per-item errors", async () => {
    const tokenAddress = "0x0000000000000000000000000000000000000001";
    const holder = "0x00000000000000000000000000000000000000aa";
    const encryptedValues = [
      "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    ];
    const provider = new ZamaDecryptionProvider(() => ({
      decryption: {
        delegatedBatchDecryptValues: async ({
          encryptedInputs,
          delegatorAddress,
        }: {
          encryptedInputs: Array<{ encryptedValue: string; contractAddress: string }>;
          delegatorAddress: string;
        }) => {
          expect(delegatorAddress).toBe(holder);
          expect(encryptedInputs).toEqual(
            encryptedValues.map((encryptedValue) => ({
              encryptedValue,
              contractAddress: tokenAddress,
            })),
          );
          return {
            items: [
              { encryptedValue: encryptedValues[0], contractAddress: tokenAddress, value: 12n },
              {
                encryptedValue: encryptedValues[1],
                contractAddress: tokenAddress,
                error: new Error("DelegationNotFoundError: no active delegation"),
              },
            ],
          };
        },
      },
    }));

    await expect(
      provider.batchDecryptTransferAmounts({
        chainId: 31337,
        tokenAddress,
        holder,
        encryptedAmounts: encryptedValues,
      }),
    ).resolves.toEqual([
      {
        encryptedAmount: encryptedValues[0],
        result: { status: "decrypted", amount: 12n },
      },
      {
        encryptedAmount: encryptedValues[1],
        result: { status: "not_delegated", reason: "missing_delegation" },
      },
    ]);
  });
});
