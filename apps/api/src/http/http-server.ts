import Fastify from "fastify";
import type { ConfidentialIndexer, ReadModel } from "@confidential-indexer/core";
import { registerPartnerApiRoutes } from "./partner-api-routes.js";

export interface PartnerApiServerDeps {
  readModel: ReadModel;
  indexer: ConfidentialIndexer;
  adminApiKey: string;
}

export function createPartnerApiServer(deps: PartnerApiServerDeps) {
  const app = Fastify({ logger: false });
  registerPartnerApiRoutes(app, deps);
  return app;
}
