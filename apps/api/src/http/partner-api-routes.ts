import type { FastifyInstance } from "fastify";
import type { PartnerApiServerDeps } from "./http-server.js";
import {
  parseActivityRequest,
  parseBackfillRequest,
  parseBalanceRequest,
  parseTransferRequest,
} from "./partner-api-request.js";
import { serializePartnerApiResponse } from "./partner-api-response.js";

export function registerPartnerApiRoutes(app: FastifyInstance, deps: PartnerApiServerDeps): void {
  app.get("/v1/balances/:holder", async (request, reply) => {
    const result = await deps.readModel.getBalances(
      parseBalanceRequest(request.params, request.query),
    );
    return reply.send(serializePartnerApiResponse(result));
  });

  app.get("/v1/transfers/:holder", async (request, reply) => {
    const result = await deps.readModel.getTransfers(
      parseTransferRequest(request.params, request.query),
    );
    return reply.send(serializePartnerApiResponse(result));
  });

  app.get("/v1/activity/:holder", async (request, reply) => {
    const result = await deps.readModel.getActivities(
      parseActivityRequest(request.params, request.query),
    );
    return reply.send(serializePartnerApiResponse(result));
  });

  app.get("/v1/health", async (_request, reply) => {
    const result = await deps.readModel.getHealth();
    return reply.status(result.ok ? 200 : 503).send(serializePartnerApiResponse(result));
  });

  app.post("/admin/backfill", async (request, reply) => {
    if (request.headers["x-admin-api-key"] !== deps.adminApiKey) {
      return reply.status(401).send({ error: "unauthorized" });
    }

    const result = await deps.indexer.backfillHolder(parseBackfillRequest(request.body));
    return reply.send(serializePartnerApiResponse(result));
  });
}
