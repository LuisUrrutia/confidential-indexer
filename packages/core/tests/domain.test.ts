import { describe, expect, it } from "vitest";
import type { IndexedEvent } from "../src/index.js";
import { InMemoryDecryptionProvider, InMemoryIndexedEventSource } from "../src/testing/index.js";

const event: IndexedEvent = {
  kind: "confidential_transfer",
  chainId: 31337,
  tokenAddress: "0x0000000000000000000000000000000000000001",
  txHash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  logIndex: 0,
  blockNumber: 10n,
  blockTimestamp: new Date("2026-06-29T00:00:00.000Z"),
  from: "0x00000000000000000000000000000000000000aa",
  to: "0x00000000000000000000000000000000000000bb",
  encryptedAmount: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
};

describe("core testing adapters", () => {
  it("returns indexed events after a cursor", async () => {
    const source = new InMemoryIndexedEventSource([event]);

    const batch = await source.nextBatch(null);

    expect(batch.events).toEqual([event]);
    expect(batch.nextCursor).toEqual({ blockNumber: 10n, logIndex: 0 });
  });

  it("returns configured fake decrypted amounts", async () => {
    const provider = new InMemoryDecryptionProvider();
    provider.setAmount(event.encryptedAmount, 25n);

    const result = await provider.decryptTransferAmount({
      chainId: event.chainId,
      tokenAddress: event.tokenAddress,
      holder: event.to,
      encryptedAmount: event.encryptedAmount,
    });

    expect(result).toEqual({ status: "decrypted", amount: 25n });
  });
});
