import { describe, expect, it } from "vitest";
import { normalizeTokenEvent } from "../src/erc7984-events.js";

const metadata = {
  chainId: 31337,
  tokenAddress: "0x0000000000000000000000000000000000000001",
  txHash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  logIndex: 0,
  blockNumber: 10n,
  blockTimestamp: new Date("2026-06-29T00:00:00.000Z"),
} as const;

describe("normalizeTokenEvent", () => {
  it("normalizes all ERC-7984 alpha token activity shapes", () => {
    expect(
      normalizeTokenEvent(
        {
          eventName: "ConfidentialTransfer",
          from: "0x00000000000000000000000000000000000000aa",
          to: "0x00000000000000000000000000000000000000bb",
          encryptedAmount: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        },
        metadata,
      ),
    ).toMatchObject({ kind: "confidential_transfer" });

    expect(
      normalizeTokenEvent(
        {
          eventName: "Wrap",
          to: "0x00000000000000000000000000000000000000bb",
          roundedAmount: 10n,
          encryptedWrappedAmount:
            "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
        },
        { ...metadata, logIndex: 1 },
      ),
    ).toMatchObject({
      kind: "shield",
      to: "0x00000000000000000000000000000000000000bb",
      encryptedAmount: "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
      amount: 10n,
    });

    expect(
      normalizeTokenEvent(
        {
          eventName: "UnwrapRequested",
          receiver: "0x00000000000000000000000000000000000000cc",
          encryptedAmount: "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
          unwrapRequestId: "0x1111111111111111111111111111111111111111111111111111111111111111",
        },
        { ...metadata, logIndex: 2 },
      ),
    ).toMatchObject({
      kind: "unshield_requested",
      receiver: "0x00000000000000000000000000000000000000cc",
      encryptedAmount: "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
    });

    expect(
      normalizeTokenEvent(
        {
          eventName: "UnwrapFinalized",
          receiver: "0x00000000000000000000000000000000000000cc",
          encryptedAmount: "0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
          cleartextAmount: 7n,
          unwrapRequestId: "0x1111111111111111111111111111111111111111111111111111111111111111",
        },
        { ...metadata, logIndex: 3 },
      ),
    ).toMatchObject({
      kind: "unshield_finalized",
      receiver: "0x00000000000000000000000000000000000000cc",
      encryptedAmount: "0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
      amount: 7n,
    });
  });
});
