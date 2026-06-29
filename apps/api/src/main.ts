import { createConfidentialIndexer } from "@confidential-indexer/core";
import {
  createPool,
  PostgresReadModel,
  PostgresRepositories,
  runMigrations,
} from "@confidential-indexer/db";
import { HyperindexPollingEventSource } from "@confidential-indexer/hyperindex-adapter";
import {
  createZamaSdkFactory,
  type ZamaNetworkConfig,
  ZamaDecryptionProvider,
} from "@confidential-indexer/zama";
import { loadConfig } from "./config.js";
import { createServer } from "./http/createServer.js";
import { runLoop } from "./workers/runLoop.js";

const config = loadConfig();
const appPool = createPool(config.databaseUrl);
const hyperindexPool = createPool(config.hyperindexDatabaseUrl);
await runMigrations(appPool);

const repos = new PostgresRepositories(appPool, "hyperindex");
const readModel = new PostgresReadModel(appPool, "hyperindex");
const eventSource = new HyperindexPollingEventSource({
  pool: hyperindexPool,
  limit: config.eventSourcePollLimit,
});

const zamaNetworks = config.networks.map((network): ZamaNetworkConfig => {
  const zamaNetwork: ZamaNetworkConfig = {
    chainId: network.chainId,
    rpcUrl: network.rpcUrl,
    indexerSignerPrivateKey:
      network.indexerSignerPrivateKey as ZamaNetworkConfig["indexerSignerPrivateKey"],
  };
  if (network.name) zamaNetwork.name = network.name;
  if (network.relayerUrl) zamaNetwork.relayerUrl = network.relayerUrl;
  if (network.relayerApiKey) zamaNetwork.relayerApiKey = network.relayerApiKey;
  return zamaNetwork;
});

const sdkForChain = createZamaSdkFactory({
  networks: zamaNetworks,
});
const decryption = new ZamaDecryptionProvider(sdkForChain);

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
