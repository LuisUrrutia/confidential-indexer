import { z } from "zod";

const addressSchema = z.string().regex(/^0x[a-fA-F0-9]{40}$/);
const privateKeySchema = z.string().regex(/^0x[a-fA-F0-9]{64}$/);

const networkTokenSchema = z.object({
  address: addressSchema,
  startBlock: z.coerce.bigint().default(0n),
});

const networkSchema = z.object({
  chainId: z.coerce.number().int(),
  name: z.string().min(1).optional(),
  rpcUrl: z.string().url(),
  relayerUrl: z.string().url().optional(),
  relayerApiKeyEnv: z.string().min(1).optional(),
  indexerSignerPrivateKeyEnv: z.string().min(1),
  tokens: z.array(networkTokenSchema).default([]),
});

const resolvedNetworkSchema = networkSchema.extend({
  relayerApiKey: z.string().min(1).optional(),
  indexerSignerPrivateKey: privateKeySchema,
});

export const appConfigSchema = z.object({
  databaseUrl: z.string().url(),
  hyperindexDatabaseUrl: z.string().url(),
  adminApiKey: z.string().min(1),
  host: z.string().default("127.0.0.1"),
  port: z.coerce.number().int().default(3000),
  eventSourcePollLimit: z.coerce.number().int().min(1).max(1000).default(100),
  workerIntervalMs: z.coerce.number().int().min(250).default(2000),
  networks: z.array(resolvedNetworkSchema),
});

export type AppConfig = z.infer<typeof appConfigSchema>;
export type NetworkConfig = AppConfig["networks"][number];

function parseNetworks(env: NodeJS.ProcessEnv): AppConfig["networks"] {
  const parsed = z.array(networkSchema).parse(JSON.parse(env.NETWORKS_JSON ?? "[]"));
  return parsed.map((network) => {
    const privateKey = env[network.indexerSignerPrivateKeyEnv];
    if (!privateKey) {
      throw new Error(
        `Missing ${network.indexerSignerPrivateKeyEnv} for chain ${network.chainId}.`,
      );
    }

    const maybeRelayerApiKey = network.relayerApiKeyEnv
      ? env[network.relayerApiKeyEnv]
      : env.RELAYER_API_KEY;
    const relayerApiKey = maybeRelayerApiKey || undefined;

    return resolvedNetworkSchema.parse({
      ...network,
      relayerApiKey,
      indexerSignerPrivateKey: privateKey,
    });
  });
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return appConfigSchema.parse({
    databaseUrl: env.DATABASE_URL,
    hyperindexDatabaseUrl: env.HYPERINDEX_DATABASE_URL ?? env.DATABASE_URL,
    adminApiKey: env.ADMIN_API_KEY,
    host: env.API_HOST,
    port: env.API_PORT,
    eventSourcePollLimit: env.EVENT_SOURCE_POLL_LIMIT,
    workerIntervalMs: env.WORKER_INTERVAL_MS,
    networks: parseNetworks(env),
  });
}
