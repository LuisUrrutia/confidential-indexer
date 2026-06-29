# syntax=docker/dockerfile:1.7

FROM node:22-alpine AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json vitest.config.ts ./
COPY apps/api/package.json apps/api/package.json
COPY apps/hyperindex/package.json apps/hyperindex/package.json
COPY packages/core/package.json packages/core/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/hyperindex-adapter/package.json packages/hyperindex-adapter/package.json
COPY packages/zama/package.json packages/zama/package.json
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
RUN pnpm build
RUN pnpm deploy --filter @confidential-indexer/api --prod /prod/api

FROM node:22-alpine AS api
ENV NODE_ENV=production
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /app
COPY --from=build /prod/api ./
EXPOSE 3000
CMD ["node", "dist/main.js"]
