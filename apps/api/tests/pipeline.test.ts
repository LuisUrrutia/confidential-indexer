import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  createConfidentialIndexer,
  FakeDecryptionProvider,
  FakeIndexedEventSource,
  type IndexedEvent,
} from "@confidential-indexer/core";
import {
  createPool,
  PostgresReadModel,
  PostgresRepositories,
  runMigrations,
} from "@confidential-indexer/db";
import { createServer } from "../src/http/createServer.js";

const databaseUrl =
  process.env.DATABASE_URL ?? "postgres://indexer:indexer@localhost:5432/confidential_indexer";

function transfer(encryptedAmount: `0x${string}`): IndexedEvent {
  return {
    kind: "confidential_transfer",
    chainId: 31337,
    tokenAddress: "0x0000000000000000000000000000000000000001",
    txHash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    logIndex: 0,
    blockNumber: 1n,
    blockTimestamp: new Date("2026-06-29T00:00:00.000Z"),
    from: "0x00000000000000000000000000000000000000aa",
    to: "0x00000000000000000000000000000000000000bb",
    encryptedAmount,
  };
}

async function createHarness(
  events: IndexedEvent[],
  configureDecryption: (provider: FakeDecryptionProvider) => void,
) {
  const pool = createPool(databaseUrl);
  const schema = `pipeline_${randomUUID().replaceAll("-", "")}`;
  await pool.query(`create schema ${schema}`);
  await pool.query(`set search_path to ${schema}, public`);
  await runMigrations(pool);

  const repos = new PostgresRepositories(pool, "hyperindex");
  const readModel = new PostgresReadModel(pool, "hyperindex");
  const provider = new FakeDecryptionProvider();
  configureDecryption(provider);
  const indexer = createConfidentialIndexer({
    sourceName: "hyperindex",
    eventSource: new FakeIndexedEventSource(events),
    decryption: provider,
    transfers: repos.transfers,
    balances: repos.balances,
    checkpoints: repos.checkpoints,
    attempts: repos.attempts,
  });
  const app = createServer({ readModel, indexer, adminApiKey: "secret" });
  return { pool, app, indexer };
}

describe("fake end-to-end pipeline", () => {
  it("happy path: event in produces cleartext transfer and balance out", async () => {
    const encryptedAmount = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    const { pool, app, indexer } = await createHarness([transfer(encryptedAmount)], (provider) =>
      provider.setAmount(encryptedAmount, 25n),
    );

    await indexer.ingestNextBatch();
    await indexer.processPendingDecryptions(10);

    const transfers = await app.inject({
      method: "GET",
      url: "/v1/transfers/0x00000000000000000000000000000000000000bb",
    });
    const balances = await app.inject({
      method: "GET",
      url: "/v1/balances/0x00000000000000000000000000000000000000bb",
    });

    expect(transfers.json().items[0]).toMatchObject({
      amount: "25",
      decryptionStatus: "decrypted",
    });
    expect(balances.json().items[0]).toMatchObject({ balance: "25", balanceSource: "events" });

    await pool.end();
  });

  it("negative path: undecryptable event stays visible with null amount", async () => {
    const encryptedAmount = "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";
    const { pool, app, indexer } = await createHarness([transfer(encryptedAmount)], (provider) =>
      provider.failWith({ status: "not_delegated", reason: "missing_delegation" }),
    );

    await indexer.ingestNextBatch();
    await indexer.processPendingDecryptions(10);

    const transfers = await app.inject({
      method: "GET",
      url: "/v1/transfers/0x00000000000000000000000000000000000000bb",
    });

    expect(transfers.json().items[0]).toMatchObject({
      amount: null,
      decryptionStatus: "not_delegated",
      decryptionReason: "missing_delegation",
    });

    await pool.end();
  });
});
