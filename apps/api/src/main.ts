import { createConfidentialIndexer } from "@confidential-indexer/core";
import {
  createPostgresPool,
  PostgresReadModel,
  PostgresRepositorySet,
  runSchemaMigrations,
} from "@confidential-indexer/db";
import { HyperindexPollingEventSource } from "@confidential-indexer/hyperindex-adapter";
import {
  createZamaSdkFactory,
  type ZamaNetworkConfig,
  ZamaDecryptionProvider,
} from "@confidential-indexer/zama";
import { loadAppConfig } from "./app-config.js";
import { createPartnerApiServer } from "./http/http-server.js";
import { runIndexerWorkerLoop } from "./workers/indexer-worker-loop.js";

const config = loadAppConfig();
const appPool = createPostgresPool(config.databaseUrl);
const hyperindexPool = createPostgresPool(config.hyperindexDatabaseUrl);
await runSchemaMigrations(appPool);

const repos = new PostgresRepositorySet(appPool, "hyperindex");
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
  activities: repos.activities,
  delegations: repos.delegations,
});

runIndexerWorkerLoop(indexer, config.workerIntervalMs);

const app = createPartnerApiServer({ readModel, indexer, adminApiKey: config.adminApiKey });
await app.listen({ host: config.host, port: config.port });

const close = async () => {
  sdkForChain.terminateAll();
  await app.close();
  await appPool.end();
  await hyperindexPool.end();
};

process.once("SIGINT", () => {
  close()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
});
process.once("SIGTERM", () => {
  close()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
});
