import Fastify from "fastify";
import type { ConfidentialIndexer, ReadModel } from "@confidential-indexer/core";
import { registerRoutes } from "./routes.js";

export interface CreateServerDeps {
  readModel: ReadModel;
  indexer: ConfidentialIndexer;
  adminApiKey: string;
}

export function createServer(deps: CreateServerDeps) {
  const app = Fastify({ logger: false });
  registerRoutes(app, deps);
  return app;
}
