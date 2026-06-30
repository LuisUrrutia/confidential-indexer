import type {
  ActivityQuery,
  Address,
  BackfillHolderInput,
  BalanceQuery,
  DecryptionStatus,
  TokenActivityKind,
  TransferQuery,
} from "@confidential-indexer/core";
import { z } from "zod";

const addressSchema = z
  .string()
  .regex(/^0x[a-fA-F0-9]{40}$/)
  .transform((value) => value as Address);
const decryptionStatusSchema: z.ZodType<DecryptionStatus> = z.enum([
  "pending",
  "not_delegated",
  "retryable_error",
  "failed",
  "decrypted",
]);
const activityKindSchema: z.ZodType<TokenActivityKind> = z.enum([
  "confidential_transfer",
  "shield",
  "unshield_requested",
  "unshield_finalized",
]);

const holderParamsSchema = z.object({ holder: addressSchema });
const filteredQuerySchema = z.object({
  chainId: z.coerce.number().optional(),
  tokenAddress: addressSchema.optional(),
});
const pagedQuerySchema = filteredQuerySchema.extend({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export function parseBalanceRequest(params: unknown, query: unknown): BalanceQuery {
  const parsedParams = holderParamsSchema.parse(params);
  const parsedQuery = filteredQuerySchema.parse(query);
  const balanceQuery: BalanceQuery = { holder: parsedParams.holder };
  if (parsedQuery.chainId !== undefined) balanceQuery.chainId = parsedQuery.chainId;
  if (parsedQuery.tokenAddress !== undefined) balanceQuery.tokenAddress = parsedQuery.tokenAddress;
  return balanceQuery;
}

export function parseTransferRequest(params: unknown, query: unknown): TransferQuery {
  const parsedParams = holderParamsSchema.parse(params);
  const parsedQuery = pagedQuerySchema
    .extend({ decryptionStatus: decryptionStatusSchema.optional() })
    .parse(query);
  const transferQuery: TransferQuery = {
    holder: parsedParams.holder,
    limit: parsedQuery.limit,
    offset: parsedQuery.offset,
  };
  if (parsedQuery.chainId !== undefined) transferQuery.chainId = parsedQuery.chainId;
  if (parsedQuery.tokenAddress !== undefined) transferQuery.tokenAddress = parsedQuery.tokenAddress;
  if (parsedQuery.decryptionStatus !== undefined)
    transferQuery.decryptionStatus = parsedQuery.decryptionStatus;
  return transferQuery;
}

export function parseActivityRequest(params: unknown, query: unknown): ActivityQuery {
  const parsedParams = holderParamsSchema.parse(params);
  const parsedQuery = pagedQuerySchema
    .extend({
      kind: activityKindSchema.optional(),
      decryptionStatus: decryptionStatusSchema.optional(),
    })
    .parse(query);
  const activityQuery: ActivityQuery = {
    holder: parsedParams.holder,
    limit: parsedQuery.limit,
    offset: parsedQuery.offset,
  };
  if (parsedQuery.chainId !== undefined) activityQuery.chainId = parsedQuery.chainId;
  if (parsedQuery.tokenAddress !== undefined) activityQuery.tokenAddress = parsedQuery.tokenAddress;
  if (parsedQuery.kind !== undefined) activityQuery.kind = parsedQuery.kind;
  if (parsedQuery.decryptionStatus !== undefined)
    activityQuery.decryptionStatus = parsedQuery.decryptionStatus;
  return activityQuery;
}

export function parseBackfillRequest(body: unknown): BackfillHolderInput {
  return z
    .object({ chainId: z.number().int(), tokenAddress: addressSchema, holder: addressSchema })
    .parse(body);
}
