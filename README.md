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

## Tests

The automated tests use deterministic fakes for Hyperindex output and Zama decryption. This keeps CI fast while proving the required path:

```text
indexed event -> delegated decryption result -> Postgres read model -> HTTP API
```

Run:

```bash
pnpm dev:db
pnpm test
```

The live local fhEVM/Anvil path is documented separately because delegation propagation and relayer behavior are integration concerns, not unit-test prerequisites.
