# Confidential ERC-7984 Indexer

A TypeScript Node submission for indexing ERC-7984 confidential token activity with Hyperindex, delegated Zama decryption, Postgres read models, and partner-friendly HTTP APIs.

## Local setup

```bash
pnpm install
cp .env.example .env
pnpm dev:db
pnpm test
pnpm typecheck
pnpm lint
```

## Services

- `apps/hyperindex`: chain indexing configuration and event capture.
- `apps/api`: decryption workers and HTTP API.
- `packages/core`: domain interfaces and orchestration.
- `packages/db`: Postgres schema and read-model adapters.
- `packages/zama`: Zama SDK adapter.
- `packages/hyperindex-adapter`: adapter from Hyperindex output to normalized events.

## API preview

- `GET /v1/balances/:holder`
- `GET /v1/transfers/:holder`
- `GET /v1/health`
- `POST /admin/backfill`
