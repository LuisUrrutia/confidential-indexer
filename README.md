# Confidential ERC-7984 Indexer

A TypeScript Node submission for indexing ERC-7984 confidential token activity with Hyperindex, delegated Zama decryption, Postgres read models, and partner-friendly HTTP APIs.

## Prerequisites

- Node.js 22+
- pnpm 9+
- Docker Desktop or another Docker runtime

## Local setup

```bash
pnpm install
cp .env.example .env
pnpm dev:db
pnpm test
pnpm typecheck
pnpm lint
```

## Run with Docker Compose

Development mode with bind mounts and `tsx`:

```bash
cp .env.example .env
docker compose -f compose.dev.yaml up --build
```

Prod-like local/demo mode with an optimized API image:

```bash
cp .env.example .env
docker compose up --build
```

Then call:

```bash
curl http://127.0.0.1:3000/v1/health
```

## Run API without Docker

```bash
pnpm dev:db
pnpm --filter @confidential-indexer/api dev
```

## API

### `GET /v1/balances/:holder`

Returns cleartext balances where known. Balance values are strings because token amounts can exceed JavaScript's safe integer range.

### `GET /v1/transfers/:holder`

Returns paginated transfer history. If an amount is not decrypted yet, `amount` is `null` and `decryptionStatus` plus `decryptionReason` explain why.

### `POST /admin/backfill`

Requires `x-admin-api-key`. Triggers transfer retry and direct current-balance refresh for a holder/token/network tuple.

## Pull request validation

GitHub Actions runs on pull requests and pushes to `main`. CI validates linting, formatting, typechecking, Postgres-backed tests, and Docker image buildability. Third-party actions are pinned to full commit SHAs for immutable workflow execution.

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

## Live Sepolia harness

The live path uses the real Zama SDK, a Foundry-deployed `ConfidentialTestToken`, a generated owner/transfer account, and a generated Indexer Signer delegated for user decryption. Do not commit `.env.live`; it contains private keys.

```bash
pnpm live:accounts
```

Edit `.env.live`:

- set `RPC_URL` to a funded Sepolia RPC endpoint;
- set `RELAYER_API_KEY` for the Zama relayer;
- fund `OWNER_ADDRESS` for deployment/transfer gas;
- fund `INDEXER_SIGNER_ADDRESS` if your relayer/account policy requires gas for the delegate signer.

Then run:

```bash
pnpm live:deploy
pnpm live:transfer
pnpm live:scan
pnpm dev:db
set -a; source .env.live; set +a
pnpm --filter @confidential-indexer/api dev
```

In another terminal with the same environment loaded:

```bash
set -a; source .env.live; set +a
curl -H "x-admin-api-key: $ADMIN_API_KEY" \
  -H "content-type: application/json" \
  --data "{\"chainId\":$CHAIN_ID,\"tokenAddress\":\"$TOKEN_ADDRESS\",\"holder\":\"$OWNER_ADDRESS\"}" \
  http://127.0.0.1:3000/admin/backfill
curl "http://127.0.0.1:3000/v1/transfers/$OWNER_ADDRESS?chainId=$CHAIN_ID&tokenAddress=$TOKEN_ADDRESS"
```

Delegation can take 1-2 minutes to propagate through the gateway. During that window transfer amounts remain `null` with a retryable `decryptionReason`; rerun `pnpm live:scan` and `POST /admin/backfill` after propagation.

## Project layout

- `apps/hyperindex`: chain indexing configuration and event capture.
- `apps/api`: decryption workers and HTTP API.
- `packages/core`: domain interfaces and orchestration.
- `packages/db`: Postgres schema and read-model adapters.
- `packages/zama`: Zama SDK adapter.
- `packages/hyperindex-adapter`: adapter from Hyperindex output to normalized events.
