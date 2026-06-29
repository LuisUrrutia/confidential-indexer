import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createPool, PostgresReadModel, PostgresRepositories, runMigrations } from "../src/index.js";
import type { IndexedEvent } from "@confidential-indexer/core";

const databaseUrl = process.env.DATABASE_URL ?? "postgres://indexer:indexer@localhost:5432/confidential_indexer";

const event: IndexedEvent = {
  kind: "confidential_transfer",
  chainId: 31337,
  tokenAddress: "0x0000000000000000000000000000000000000001",
  txHash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  logIndex: 7,
  blockNumber: 10n,
  blockTimestamp: new Date("2026-06-29T00:00:00.000Z"),
  from: "0x00000000000000000000000000000000000000aa",
  to: "0x00000000000000000000000000000000000000bb",
  encryptedAmount: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
};

describe("Postgres repositories", () => {
  it("stores pending transfers and exposes decrypted balances", async () => {
    const pool = createPool(databaseUrl);
    await runMigrations(pool);
    const schema = `test_${randomUUID().replaceAll("-", "")}`;
    await pool.query(`create schema ${schema}`);
    await pool.query(`set search_path to ${schema}, public`);
    await runMigrations(pool);

    const repos = new PostgresRepositories(pool, "hyperindex");
    const readModel = new PostgresReadModel(pool, "hyperindex");

    await repos.transfers.upsertIndexedEvent(event);
    const pending = await repos.transfers.listPendingDecryptions(10);
    expect(pending).toHaveLength(1);

    await repos.transfers.markTransferDecrypted({ chainId: event.chainId, txHash: event.txHash, logIndex: event.logIndex, amount: 25n });
    await repos.balances.applyDecryptedTransfer(pending[0]!, 25n);

    const transfers = await readModel.getTransfers({ holder: event.to, limit: 20, offset: 0 });
    const balances = await readModel.getBalances({ holder: event.to });

    expect(transfers.items[0]?.amount).toBe(25n);
    expect(balances.items[0]?.balance).toBe(25n);

    await pool.end();
  });
});
