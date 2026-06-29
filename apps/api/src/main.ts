import { FakeDecryptionProvider, FakeIndexedEventSource, createConfidentialIndexer } from "@confidential-indexer/core";
import { createPool, PostgresReadModel, PostgresRepositories, runMigrations } from "@confidential-indexer/db";
import { loadConfig } from "./config.js";
import { createServer } from "./http/createServer.js";

const config = loadConfig();
const pool = createPool(config.databaseUrl);
await runMigrations(pool);

const repos = new PostgresRepositories(pool, "hyperindex");
const readModel = new PostgresReadModel(pool, "hyperindex");

const indexer = createConfidentialIndexer({
  sourceName: "hyperindex",
  eventSource: new FakeIndexedEventSource([]),
  decryption: new FakeDecryptionProvider(),
  transfers: repos.transfers,
  balances: repos.balances,
  checkpoints: repos.checkpoints,
  attempts: repos.attempts,
});

const app = createServer({ readModel, indexer, adminApiKey: config.adminApiKey });
await app.listen({ host: config.host, port: config.port });
