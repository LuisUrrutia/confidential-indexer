import { describe, expect, it } from "vitest";
import { createServer } from "../src/http/createServer.js";
import type { ConfidentialIndexer, ReadModel } from "@confidential-indexer/core";

const readModel: ReadModel = {
  async getBalances(query) {
    return {
      items: [
        {
          chainId: 31337,
          tokenAddress: "0x0000000000000000000000000000000000000001",
          holder: query.holder,
          balance: 150n,
          balanceStatus: "known",
          balanceSource: "direct_decrypt",
          historyCompleteness: "partial",
          updatedAt: new Date("2026-06-29T00:00:00.000Z"),
        },
      ],
    };
  },
  async getTransfers(query) {
    return {
      limit: query.limit,
      offset: query.offset,
      items: [
        {
          chainId: 31337,
          tokenAddress: "0x0000000000000000000000000000000000000001",
          txHash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          logIndex: 0,
          blockNumber: 1n,
          blockTimestamp: new Date("2026-06-29T00:00:00.000Z"),
          from: "0x00000000000000000000000000000000000000aa",
          to: query.holder,
          encryptedAmount: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          amount: null,
          decryptionStatus: "pending",
          decryptionReason: "missing_delegation",
        },
      ],
    };
  },
  async getHealth() {
    return {
      ok: true,
      database: "up",
      checkpoints: [{ sourceName: "hyperindex", cursor: { blockNumber: 1n, logIndex: 0 } }],
    };
  },
};

const indexer: ConfidentialIndexer = {
  async ingestNextBatch() {
    return { ingested: 0, nextCursor: null };
  },
  async processPendingDecryptions() {
    return { attempted: 0, decrypted: 0, pending: 0, failed: 0 };
  },
  async backfillHolder(input) {
    return {
      holder: input.holder,
      transferReport: { attempted: 1, decrypted: 1, pending: 0, failed: 0 },
      balanceRefreshed: true,
    };
  },
};

describe("HTTP API", () => {
  it("returns balances with bigint values serialized as strings", async () => {
    const app = createServer({ readModel, indexer, adminApiKey: "secret" });
    const response = await app.inject({
      method: "GET",
      url: "/v1/balances/0x00000000000000000000000000000000000000bb",
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().items[0].balance).toBe("150");
  });

  it("returns pending transfer amounts as null with decryption metadata", async () => {
    const app = createServer({ readModel, indexer, adminApiKey: "secret" });
    const response = await app.inject({
      method: "GET",
      url: "/v1/transfers/0x00000000000000000000000000000000000000bb",
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().items[0]).toMatchObject({
      amount: null,
      decryptionStatus: "pending",
      decryptionReason: "missing_delegation",
    });
  });

  it("protects admin backfill with API key", async () => {
    const app = createServer({ readModel, indexer, adminApiKey: "secret" });
    const missingKey = await app.inject({
      method: "POST",
      url: "/admin/backfill",
      payload: {
        chainId: 31337,
        tokenAddress: "0x0000000000000000000000000000000000000001",
        holder: "0x00000000000000000000000000000000000000bb",
      },
    });
    expect(missingKey.statusCode).toBe(401);

    const ok = await app.inject({
      method: "POST",
      url: "/admin/backfill",
      headers: { "x-admin-api-key": "secret" },
      payload: {
        chainId: 31337,
        tokenAddress: "0x0000000000000000000000000000000000000001",
        holder: "0x00000000000000000000000000000000000000bb",
      },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().balanceRefreshed).toBe(true);
  });
});
