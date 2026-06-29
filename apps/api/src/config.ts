import { z } from "zod";

export const appConfigSchema = z.object({
  databaseUrl: z.string().url(),
  hyperindexDatabaseUrl: z.string().url(),
  adminApiKey: z.string().min(1),
  host: z.string().default("127.0.0.1"),
  port: z.coerce.number().int().default(3000),
  eventSourcePollLimit: z.coerce.number().int().min(1).max(1000).default(100),
  workerIntervalMs: z.coerce.number().int().min(250).default(2000),
});

export type AppConfig = z.infer<typeof appConfigSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return appConfigSchema.parse({
    databaseUrl: env.DATABASE_URL,
    hyperindexDatabaseUrl: env.HYPERINDEX_DATABASE_URL ?? env.DATABASE_URL,
    adminApiKey: env.ADMIN_API_KEY,
    host: env.API_HOST,
    port: env.API_PORT,
    eventSourcePollLimit: env.EVENT_SOURCE_POLL_LIMIT,
    workerIntervalMs: env.WORKER_INTERVAL_MS,
  });
}
