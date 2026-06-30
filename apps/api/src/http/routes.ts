import type { FastifyInstance } from "fastify";
import type { ActivityQuery, BalanceQuery, TransferQuery } from "@confidential-indexer/core";
import { z } from "zod";
import type { CreateServerDeps } from "./createServer.js";

const addressSchema = z.string().regex(/^0x[a-fA-F0-9]{40}$/);
const decryptionStatusSchema = z.enum([
  "pending",
  "not_delegated",
  "retryable_error",
  "failed",
  "decrypted",
]);
const activityKindSchema = z.enum([
  "confidential_transfer",
  "shield",
  "unshield_requested",
  "unshield_finalized",
]);

function stringifyBigInts(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(stringifyBigInts);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, stringifyBigInts(item)]),
    );
  }
  return value;
}

export function registerRoutes(app: FastifyInstance, deps: CreateServerDeps): void {
  app.get("/v1/balances/:holder", async (request, reply) => {
    const params = z.object({ holder: addressSchema }).parse(request.params);
    const query = z
      .object({ chainId: z.coerce.number().optional(), tokenAddress: addressSchema.optional() })
      .parse(request.query);
    const balanceQuery: BalanceQuery = { holder: params.holder as `0x${string}` };
    if (query.chainId !== undefined) balanceQuery.chainId = query.chainId;
    if (query.tokenAddress !== undefined)
      balanceQuery.tokenAddress = query.tokenAddress as `0x${string}`;
    const result = await deps.readModel.getBalances(balanceQuery);
    return reply.send(stringifyBigInts(result));
  });

  app.get("/v1/transfers/:holder", async (request, reply) => {
    const params = z.object({ holder: addressSchema }).parse(request.params);
    const query = z
      .object({
        chainId: z.coerce.number().optional(),
        tokenAddress: addressSchema.optional(),
        decryptionStatus: decryptionStatusSchema.optional(),
        limit: z.coerce.number().int().min(1).max(100).default(50),
        offset: z.coerce.number().int().min(0).default(0),
      })
      .parse(request.query);
    const transferQuery: TransferQuery = {
      holder: params.holder as `0x${string}`,
      limit: query.limit,
      offset: query.offset,
    };
    if (query.chainId !== undefined) transferQuery.chainId = query.chainId;
    if (query.tokenAddress !== undefined)
      transferQuery.tokenAddress = query.tokenAddress as `0x${string}`;
    if (query.decryptionStatus !== undefined)
      transferQuery.decryptionStatus = query.decryptionStatus;
    const result = await deps.readModel.getTransfers(transferQuery);
    return reply.send(stringifyBigInts(result));
  });

  app.get("/v1/activity/:holder", async (request, reply) => {
    const params = z.object({ holder: addressSchema }).parse(request.params);
    const query = z
      .object({
        chainId: z.coerce.number().optional(),
        tokenAddress: addressSchema.optional(),
        kind: activityKindSchema.optional(),
        decryptionStatus: decryptionStatusSchema.optional(),
        limit: z.coerce.number().int().min(1).max(100).default(50),
        offset: z.coerce.number().int().min(0).default(0),
      })
      .parse(request.query);
    const activityQuery: ActivityQuery = {
      holder: params.holder as `0x${string}`,
      limit: query.limit,
      offset: query.offset,
    };
    if (query.chainId !== undefined) activityQuery.chainId = query.chainId;
    if (query.tokenAddress !== undefined)
      activityQuery.tokenAddress = query.tokenAddress as `0x${string}`;
    if (query.kind !== undefined) activityQuery.kind = query.kind;
    if (query.decryptionStatus !== undefined)
      activityQuery.decryptionStatus = query.decryptionStatus;
    const result = await deps.readModel.getActivities(activityQuery);
    return reply.send(stringifyBigInts(result));
  });

  app.get("/v1/health", async (_request, reply) => {
    const result = await deps.readModel.getHealth();
    return reply.status(result.ok ? 200 : 503).send(stringifyBigInts(result));
  });

  app.post("/admin/backfill", async (request, reply) => {
    if (request.headers["x-admin-api-key"] !== deps.adminApiKey) {
      return reply.status(401).send({ error: "unauthorized" });
    }
    const body = z
      .object({ chainId: z.number().int(), tokenAddress: addressSchema, holder: addressSchema })
      .parse(request.body);
    const result = await deps.indexer.backfillHolder({
      chainId: body.chainId,
      tokenAddress: body.tokenAddress as `0x${string}`,
      holder: body.holder as `0x${string}`,
    });
    return reply.send(stringifyBigInts(result));
  });
}
