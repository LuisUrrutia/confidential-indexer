import { describe, expect, it } from "vitest";
import { HyperindexPollingEventSource } from "../src/index.js";

class StaticHyperindexPool {
  async query(_sql: string, _params: unknown[]) {
    return {
      rows: [
        {
          kind: "confidential_transfer",
          chain_id: 31337,
          token_address: "0x0000000000000000000000000000000000000001",
          tx_hash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          log_index: 0,
          block_number: "1",
          block_timestamp: new Date("2026-06-29T00:00:00.000Z"),
          from_address: "0x00000000000000000000000000000000000000aa",
          to_address: "0x00000000000000000000000000000000000000bb",
          encrypted_amount: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        },
      ],
    };
  }
}

describe("HyperindexPollingEventSource", () => {
  it("normalizes Hyperindex rows into IndexedEventBatch", async () => {
    const source = new HyperindexPollingEventSource({
      pool: new StaticHyperindexPool(),
      limit: 10,
    });
    const batch = await source.nextBatch(null);

    expect(batch.events[0]).toMatchObject({
      kind: "confidential_transfer",
      chainId: 31337,
      logIndex: 0,
    });
    expect(batch.nextCursor).toEqual({ blockNumber: 1n, logIndex: 0 });
  });
});
