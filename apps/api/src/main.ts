import { createConfidentialIndexer } from "@confidential-indexer/core";
import { createPool, PostgresReadModel, PostgresRepositories, runMigrations } from "@confidential-indexer/db";
import { HyperindexPollingEventSource } from "@confidential-indexer/hyperindex-adapter";
import { ZamaDecryptionProvider, type ZamaSdkLike } from "@confidential-indexer/zama";
import { loadConfig } from "./config.js";
import { createServer } from "./http/createServer.js";
import { runLoop } from "./workers/runLoop.js";

const config = loadConfig();
const appPool = createPool(config.databaseUrl);
const hyperindexPool = createPool(config.hyperindexDatabaseUrl);
await runMigrations(appPool);

const repos = new PostgresRepositories(appPool, "hyperindex");
const readModel = new PostgresReadModel(appPool, "hyperindex");
const eventSource = new HyperindexPollingEventSource({ pool: hyperindexPool, limit: config.eventSourcePollLimit });

const decryption = new ZamaDecryptionProvider((_chainId: number): ZamaSdkLike => {
  throw new Error("Zama SDK factory is not configured for this local stub. Configure it before live delegated decryption.");
});

const indexer = createConfidentialIndexer({
  sourceName: "hyperindex",
  eventSource,
  decryption,
  transfers: repos.transfers,
  balances: repos.balances,
  checkpoints: repos.checkpoints,
  attempts: repos.attempts,
});

runLoop(indexer, config.workerIntervalMs);

const app = createServer({ readModel, indexer, adminApiKey: config.adminApiKey });
await app.listen({ host: config.host, port: config.port });
