import { indexer } from "envio";
import type { Address } from "@confidential-indexer/core";
import {
  createPgHyperindexEventWriter,
  recordEnvioAclEvent,
  recordEnvioTokenEvent,
  type EnvioAclEvent,
  type EnvioTokenEvent,
  type HyperindexEventWriter,
} from "../envio-handlers.js";

type TokenEventName = EnvioTokenEvent["eventName"];
type AclEventName = EnvioAclEvent["eventName"];

type HandlerContext = {
  isPreload?: boolean;
};

type HandlerInput = {
  event: Record<string, unknown>;
  context: HandlerContext;
};

type RuntimeChain = {
  ConfidentialToken?: {
    addresses?: readonly Address[];
  };
};

type RuntimeIndexer = {
  chains?: Record<string, RuntimeChain>;
  onEvent(
    options: { contract: string; event: string },
    handler: (input: HandlerInput) => Promise<void>,
  ): void;
};

type WriterHandle = {
  writer: HyperindexEventWriter;
  close: () => Promise<void>;
};

const runtime = indexer as unknown as RuntimeIndexer;
const tokenEventNames: readonly TokenEventName[] = [
  "ConfidentialTransfer",
  "Wrap",
  "UnwrapRequested",
  "UnwrapFinalized",
];
const aclEventNames: readonly AclEventName[] = [
  "DelegatedForUserDecryption",
  "RevokedDelegationForUserDecryption",
];

let writerHandle: WriterHandle | null = null;

for (const eventName of tokenEventNames) {
  runtime.onEvent(
    { contract: "ConfidentialToken", event: eventName },
    async ({ event, context }) => {
      if (context.isPreload) return;
      await recordEnvioTokenEvent(
        { ...(event as Omit<EnvioTokenEvent, "eventName">), eventName },
        getWriter(),
      );
    },
  );
}

for (const eventName of aclEventNames) {
  runtime.onEvent({ contract: "ConfidentialAcl", event: eventName }, async ({ event, context }) => {
    if (context.isPreload) return;
    const aclEvent = { ...(event as Omit<EnvioAclEvent, "eventName">), eventName };
    await recordEnvioAclEvent(aclEvent, getWriter(), indexedTokensForChain(aclEvent.chainId));
  });
}

export async function closeEnvioWriter(): Promise<void> {
  const handle = writerHandle;
  writerHandle = null;
  await handle?.close();
}

function getWriter(): HyperindexEventWriter {
  writerHandle ??= createPgHyperindexEventWriter(databaseUrl());
  return writerHandle.writer;
}

function indexedTokensForChain(chainId: number): ReadonlySet<Address> {
  const fromConfig = runtime.chains?.[String(chainId)]?.ConfidentialToken?.addresses;
  if (fromConfig?.length) return new Set(fromConfig);

  const tokenAddress = process.env.TOKEN_ADDRESS;
  if (!tokenAddress) return new Set<Address>();
  return new Set([tokenAddress as Address]);
}

function databaseUrl(): string {
  const url = process.env.HYPERINDEX_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error("Missing HYPERINDEX_DATABASE_URL or DATABASE_URL");
  return url;
}
