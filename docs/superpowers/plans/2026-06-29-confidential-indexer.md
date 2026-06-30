# Confidential Indexer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a TypeScript monorepo confidential ERC-7984 indexer that consumes Hyperindex output, performs delegated Zama decryption, stores cleartext read models in Postgres, and exposes partner HTTP APIs.

**Architecture:** Hyperindex is isolated as the chain indexing module. The Decryption/API app consumes indexed events through `IndexedEventSource`, coordinates ingestion/decryption/backfill in `ConfidentialIndexer`, stores read models through Postgres repositories, and serves reads through `ReadModel`. Zama SDK usage is hidden behind `DecryptionProvider` so tests can use deterministic fakes.

**Tech Stack:** TypeScript, Node.js ESM, pnpm workspaces, turbo, oxlint, oxfmt, Vitest, Fastify, Zod, pg, Docker multi-stage images, Docker Compose dev/prod-like stacks, Postgres, Hyperindex, `@zama-fhe/sdk@alpha`, viem.

## Global Constraints

- Use Hyperindex as the chain indexing layer instead of building an EVM indexer from scratch.
- Keep decrypted/read-model data outside Hyperindex in a separate Postgres database.
- Support delegated decryption as the primary access model.
- Preserve events that cannot yet be decrypted, so later delegation can backfill cleartext.
- Expose clear API responses that distinguish known cleartext data from pending or incomplete FHE state.
- Provide fast, deterministic tests with fake event and decryption providers.
- TypeScript monorepo using `pnpm`, `turbo`, `oxlint`, and `oxfmt`.
- Configuration is static at startup.
- Public API is versioned under `/v1`.
- Admin backfill endpoint is protected by an API key.
- Never commit real secrets; provide `.env.example` only.
- Everything must be runnable through Docker Compose for both dev and prod-like local/demo flows.
- Prod-like Docker means optimized local/demo images and Compose services, not reverse proxy, TLS, or external secret management.
- GitHub Actions must validate pull requests with install, lint, format check, typecheck, tests against Postgres, and Docker image build.
- GitHub Actions must use least-privilege permissions and pin third-party actions to full-length commit SHAs with version comments.

---

## File Structure

Create this structure:

```text
apps/
  api/
    package.json
    src/config.ts
    src/http/createServer.ts
    src/http/routes.ts
    src/main.ts
    src/workers/runOnce.ts
    tests/api.test.ts
  hyperindex/
    package.json
    README.md
    src/erc7984-events.ts
packages/
  core/
    package.json
    src/domain.ts
    src/interfaces.ts
    src/fakes.ts
    src/ConfidentialIndexer.ts
    src/index.ts
    tests/confidential-indexer.test.ts
  db/
    package.json
    migrations/001_initial.sql
    src/connection.ts
    src/migrate.ts
    src/PostgresRepositories.ts
    src/PostgresReadModel.ts
    src/index.ts
    tests/repositories.test.ts
  zama/
    package.json
    src/ZamaDecryptionProvider.ts
    src/index.ts
    tests/zama-error-mapping.test.ts
  hyperindex-adapter/
    package.json
    src/HyperindexPollingEventSource.ts
    src/index.ts
    tests/hyperindex-polling-event-source.test.ts
package.json
pnpm-workspace.yaml
turbo.json
tsconfig.base.json
vitest.config.ts
.github/
  workflows/
    ci.yml
Dockerfile
.dockerignore
compose.yaml
compose.dev.yaml
.env.example
README.md
DECISIONS.md
```

---

### Task 1: Monorepo Tooling and Runnable Skeleton

**Files:**
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `turbo.json`
- Create: `tsconfig.base.json`
- Create: `vitest.config.ts`
- Create: `compose.yaml`
- Create: `.env.example`
- Create: `apps/api/package.json`
- Create: `packages/core/package.json`
- Create: `packages/db/package.json`
- Create: `packages/zama/package.json`
- Create: `packages/hyperindex-adapter/package.json`
- Create: `apps/hyperindex/package.json`
- Create: `README.md`

**Interfaces:**
- Consumes: none.
- Produces: workspace scripts `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm dev:db`, and package import aliases `@confidential-indexer/*`.

- [ ] **Step 1: Create workspace files**

Write `package.json`:

```json
{
  "name": "confidential-indexer",
  "private": true,
  "type": "module",
  "packageManager": "pnpm@9.15.4",
  "scripts": {
    "build": "turbo build",
    "dev:db": "docker compose up -d postgres",
    "format:check": "oxfmt --check .",
    "lint": "oxlint .",
    "test": "vitest run",
    "typecheck": "turbo typecheck"
  },
  "devDependencies": {
    "@types/node": "^22.10.2",
    "oxlint": "^0.15.12",
    "prettier": "^3.4.2",
    "tsx": "^4.19.2",
    "turbo": "^2.3.3",
    "typescript": "^5.7.2",
    "vitest": "^2.1.8"
  }
}
```

Write `pnpm-workspace.yaml`:

```yaml
packages:
  - apps/*
  - packages/*
```

Write `turbo.json`:

```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**"]
    },
    "typecheck": {
      "dependsOn": ["^build"],
      "outputs": []
    }
  }
}
```

Write `tsconfig.base.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "outDir": "dist",
    "rootDir": "src",
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true
  }
}
```

Write `vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["apps/**/*.test.ts", "packages/**/*.test.ts"],
    testTimeout: 20_000,
  },
});
```

Write `compose.yaml`:

```yaml
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: indexer
      POSTGRES_PASSWORD: indexer
      POSTGRES_DB: confidential_indexer
    ports:
      - "5432:5432"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U indexer -d confidential_indexer"]
      interval: 2s
      timeout: 2s
      retries: 20
```

Write `.env.example`:

```bash
DATABASE_URL=postgres://indexer:indexer@localhost:5432/confidential_indexer
ADMIN_API_KEY=replace-with-local-dev-key
API_HOST=127.0.0.1
API_PORT=3000
EVENT_SOURCE_POLL_LIMIT=100
INDEXER_SIGNER_PRIVATE_KEY_31337=0x0000000000000000000000000000000000000000000000000000000000000000
NETWORKS_JSON=[{"chainId":31337,"name":"anvil","rpcUrl":"http://127.0.0.1:8545","relayerUrl":"http://127.0.0.1:8546","indexerSignerPrivateKeyEnv":"INDEXER_SIGNER_PRIVATE_KEY_31337","tokens":[{"address":"0x0000000000000000000000000000000000000001","startBlock":0}]}]
HYPERINDEX_DATABASE_URL=postgres://indexer:indexer@localhost:5432/confidential_indexer
```

- [ ] **Step 2: Create package manifests**

Write `packages/core/package.json`:

```json
{
  "name": "@confidential-indexer/core",
  "version": "0.0.0",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  },
  "devDependencies": {
    "typescript": "^5.7.2"
  }
}
```

Write `packages/db/package.json`:

```json
{
  "name": "@confidential-indexer/db",
  "version": "0.0.0",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  },
  "dependencies": {
    "@confidential-indexer/core": "workspace:*",
    "pg": "^8.13.1"
  },
  "devDependencies": {
    "@types/pg": "^8.11.10",
    "typescript": "^5.7.2"
  }
}
```

Write `packages/zama/package.json`:

```json
{
  "name": "@confidential-indexer/zama",
  "version": "0.0.0",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  },
  "dependencies": {
    "@confidential-indexer/core": "workspace:*",
    "@zama-fhe/sdk": "alpha",
    "ethers": "^6.13.4",
    "viem": "^2.21.55"
  },
  "devDependencies": {
    "typescript": "^5.7.2"
  }
}
```

Write `packages/hyperindex-adapter/package.json`:

```json
{
  "name": "@confidential-indexer/hyperindex-adapter",
  "version": "0.0.0",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  },
  "dependencies": {
    "@confidential-indexer/core": "workspace:*",
    "pg": "^8.13.1"
  },
  "devDependencies": {
    "@types/pg": "^8.11.10",
    "typescript": "^5.7.2"
  }
}
```

Write `apps/api/package.json`:

```json
{
  "name": "@confidential-indexer/api",
  "version": "0.0.0",
  "type": "module",
  "private": true,
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "start": "node dist/main.js",
    "dev": "tsx src/main.ts",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  },
  "dependencies": {
    "@confidential-indexer/core": "workspace:*",
    "@confidential-indexer/db": "workspace:*",
    "@confidential-indexer/hyperindex-adapter": "workspace:*",
    "@confidential-indexer/zama": "workspace:*",
    "fastify": "^5.1.0",
    "zod": "^3.24.1"
  },
  "devDependencies": {
    "typescript": "^5.7.2"
  }
}
```

Write `apps/hyperindex/package.json`:

```json
{
  "name": "@confidential-indexer/hyperindex",
  "version": "0.0.0",
  "type": "module",
  "private": true,
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  },
  "dependencies": {
    "@zama-fhe/sdk": "alpha",
    "viem": "^2.21.55"
  },
  "devDependencies": {
    "typescript": "^5.7.2"
  }
}
```

- [ ] **Step 3: Create package tsconfigs**

For each of `apps/api`, `apps/hyperindex`, `packages/core`, `packages/db`, `packages/zama`, and `packages/hyperindex-adapter`, write `tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist"
  },
  "include": ["src/**/*.ts"],
  "exclude": ["dist", "tests"]
}
```

- [ ] **Step 4: Add initial README**

Write `README.md`:

```md
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
```

- [ ] **Step 5: Install dependencies**

Run:

```bash
pnpm install
```

Expected: lockfile is created and install exits with code 0.

- [ ] **Step 6: Run baseline checks**

Run:

```bash
pnpm test
pnpm typecheck
pnpm lint
```

Expected: `pnpm test` reports no tests found or passes empty suite, `pnpm typecheck` succeeds for packages with no source, and `pnpm lint` exits 0.

- [ ] **Step 7: Commit**

```bash
git add package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json vitest.config.ts compose.yaml .env.example README.md apps packages
git commit -m "chore: scaffold TypeScript monorepo"
```

---

### Task 2: Core Domain Types, Interfaces, and Fakes

**Files:**
- Create: `packages/core/src/domain.ts`
- Create: `packages/core/src/interfaces.ts`
- Create: `packages/core/src/fakes.ts`
- Create: `packages/core/src/index.ts`
- Create: `packages/core/tests/domain.test.ts`

**Interfaces:**
- Consumes: workspace from Task 1.
- Produces: `IndexedEventSource`, `DecryptionProvider`, repository interfaces, `ReadModel`, domain status enums, and deterministic fakes used by later tasks.

- [ ] **Step 1: Write failing domain tests**

Write `packages/core/tests/domain.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  FakeDecryptionProvider,
  FakeIndexedEventSource,
  type IndexedEvent,
} from "../src/index.js";

const event: IndexedEvent = {
  kind: "confidential_transfer",
  chainId: 31337,
  tokenAddress: "0x0000000000000000000000000000000000000001",
  txHash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  logIndex: 0,
  blockNumber: 10n,
  blockTimestamp: new Date("2026-06-29T00:00:00.000Z"),
  from: "0x00000000000000000000000000000000000000aa",
  to: "0x00000000000000000000000000000000000000bb",
  encryptedAmount: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
};

describe("core fakes", () => {
  it("returns indexed events after a cursor", async () => {
    const source = new FakeIndexedEventSource([event]);

    const batch = await source.nextBatch(null);

    expect(batch.events).toEqual([event]);
    expect(batch.nextCursor).toEqual({ blockNumber: 10n, logIndex: 0 });
  });

  it("returns configured fake decrypted amounts", async () => {
    const provider = new FakeDecryptionProvider();
    provider.setAmount(event.encryptedAmount, 25n);

    const result = await provider.decryptTransferAmount({
      chainId: event.chainId,
      tokenAddress: event.tokenAddress,
      holder: event.to,
      encryptedAmount: event.encryptedAmount,
    });

    expect(result).toEqual({ status: "decrypted", amount: 25n });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm vitest run packages/core/tests/domain.test.ts
```

Expected: FAIL because `../src/index.js` does not exist.

- [ ] **Step 3: Implement core domain types**

Write `packages/core/src/domain.ts`:

```ts
export type Hex = `0x${string}`;
export type Address = `0x${string}`;

export type DecryptionStatus =
  | "pending"
  | "not_delegated"
  | "retryable_error"
  | "failed"
  | "decrypted";

export type DecryptionReason =
  | "missing_delegation"
  | "delegation_propagating"
  | "relayer_unavailable"
  | "sdk_error"
  | "malformed_event"
  | null;

export type BalanceStatus = "known" | "unknown";
export type BalanceSource = "events" | "direct_decrypt" | "none";
export type HistoryCompleteness = "complete" | "partial" | "unknown";

export interface EventCursor {
  blockNumber: bigint;
  logIndex: number;
}

export interface ConfidentialTransferEvent {
  kind: "confidential_transfer";
  chainId: number;
  tokenAddress: Address;
  txHash: Hex;
  logIndex: number;
  blockNumber: bigint;
  blockTimestamp: Date;
  from: Address;
  to: Address;
  encryptedAmount: Hex;
}

export interface DelegationGrantedEvent {
  kind: "delegation_granted";
  chainId: number;
  tokenAddress: Address;
  txHash: Hex;
  logIndex: number;
  blockNumber: bigint;
  blockTimestamp: Date;
  delegator: Address;
  delegate: Address;
  expiresAt: Date | null;
}

export interface DelegationRevokedEvent {
  kind: "delegation_revoked";
  chainId: number;
  tokenAddress: Address;
  txHash: Hex;
  logIndex: number;
  blockNumber: bigint;
  blockTimestamp: Date;
  delegator: Address;
  delegate: Address;
}

export type IndexedEvent = ConfidentialTransferEvent | DelegationGrantedEvent | DelegationRevokedEvent;

export interface IndexedEventBatch {
  events: IndexedEvent[];
  nextCursor: EventCursor | null;
}

export interface StoredTransfer {
  chainId: number;
  tokenAddress: Address;
  txHash: Hex;
  logIndex: number;
  blockNumber: bigint;
  blockTimestamp: Date;
  from: Address;
  to: Address;
  encryptedAmount: Hex;
  amount: bigint | null;
  decryptionStatus: DecryptionStatus;
  decryptionReason: DecryptionReason;
}

export interface BalanceRecord {
  chainId: number;
  tokenAddress: Address;
  holder: Address;
  balance: bigint | null;
  balanceStatus: BalanceStatus;
  balanceSource: BalanceSource;
  historyCompleteness: HistoryCompleteness;
  updatedAt: Date;
}

export interface DecryptTransferAmountInput {
  chainId: number;
  tokenAddress: Address;
  holder: Address;
  encryptedAmount: Hex;
}

export type DecryptAmountResult =
  | { status: "decrypted"; amount: bigint }
  | { status: Exclude<DecryptionStatus, "decrypted">; reason: Exclude<DecryptionReason, null> };

export interface RefreshBalanceInput {
  chainId: number;
  tokenAddress: Address;
  holder: Address;
}

export type RefreshBalanceResult =
  | { status: "known"; balance: bigint; source: "direct_decrypt" }
  | { status: "unknown"; reason: Exclude<DecryptionReason, null> };

export interface IngestionReport {
  ingested: number;
  nextCursor: EventCursor | null;
}

export interface DecryptionReport {
  attempted: number;
  decrypted: number;
  pending: number;
  failed: number;
}

export interface BackfillHolderInput {
  chainId: number;
  tokenAddress: Address;
  holder: Address;
}

export interface BackfillReport {
  holder: Address;
  transferReport: DecryptionReport;
  balanceRefreshed: boolean;
}
```

- [ ] **Step 4: Implement interfaces**

Write `packages/core/src/interfaces.ts`:

```ts
import type {
  Address,
  BackfillHolderInput,
  BackfillReport,
  BalanceRecord,
  DecryptAmountResult,
  DecryptTransferAmountInput,
  DecryptionReport,
  EventCursor,
  Hex,
  IndexedEvent,
  IndexedEventBatch,
  IngestionReport,
  RefreshBalanceInput,
  RefreshBalanceResult,
  StoredTransfer,
} from "./domain.js";

export interface IndexedEventSource {
  nextBatch(cursor: EventCursor | null): Promise<IndexedEventBatch>;
}

export interface DecryptionProvider {
  decryptTransferAmount(input: DecryptTransferAmountInput): Promise<DecryptAmountResult>;
  refreshCurrentBalance(input: RefreshBalanceInput): Promise<RefreshBalanceResult>;
}

export interface CheckpointRepository {
  getCursor(sourceName: string): Promise<EventCursor | null>;
  saveCursor(sourceName: string, cursor: EventCursor | null): Promise<void>;
}

export interface TransferRepository {
  upsertIndexedEvent(event: IndexedEvent): Promise<void>;
  listPendingDecryptions(limit: number): Promise<StoredTransfer[]>;
  markTransferDecrypted(input: {
    chainId: number;
    txHash: Hex;
    logIndex: number;
    amount: bigint;
  }): Promise<void>;
  markTransferUndecrypted(input: {
    chainId: number;
    txHash: Hex;
    logIndex: number;
    status: StoredTransfer["decryptionStatus"];
    reason: StoredTransfer["decryptionReason"];
  }): Promise<void>;
  listTransfersForHolder(query: TransferQuery): Promise<TransferPage>;
}

export interface BalanceRepository {
  applyDecryptedTransfer(transfer: StoredTransfer, amount: bigint): Promise<void>;
  saveDirectBalance(record: BalanceRecord): Promise<void>;
  listBalances(query: BalanceQuery): Promise<BalancePage>;
}

export interface DecryptionAttemptRepository {
  recordAttempt(input: {
    chainId: number;
    tokenAddress: Address;
    txHash: Hex;
    logIndex: number;
    status: StoredTransfer["decryptionStatus"];
    reason: StoredTransfer["decryptionReason"];
    message: string | null;
  }): Promise<void>;
}

export interface BalanceQuery {
  holder: Address;
  chainId?: number;
  tokenAddress?: Address;
}

export interface BalancePage {
  items: BalanceRecord[];
}

export interface TransferQuery {
  holder: Address;
  chainId?: number;
  tokenAddress?: Address;
  decryptionStatus?: StoredTransfer["decryptionStatus"];
  limit: number;
  offset: number;
}

export interface TransferPage {
  items: StoredTransfer[];
  limit: number;
  offset: number;
}

export interface HealthSnapshot {
  ok: boolean;
  database: "up" | "down";
  checkpoints: Array<{ sourceName: string; cursor: EventCursor | null }>;
}

export interface ReadModel {
  getBalances(query: BalanceQuery): Promise<BalancePage>;
  getTransfers(query: TransferQuery): Promise<TransferPage>;
  getHealth(): Promise<HealthSnapshot>;
}

export interface ConfidentialIndexer {
  ingestNextBatch(): Promise<IngestionReport>;
  processPendingDecryptions(limit?: number): Promise<DecryptionReport>;
  backfillHolder(input: BackfillHolderInput): Promise<BackfillReport>;
}
```

- [ ] **Step 5: Implement fakes and exports**

Write `packages/core/src/fakes.ts`:

```ts
import type {
  Address,
  DecryptAmountResult,
  DecryptTransferAmountInput,
  EventCursor,
  Hex,
  IndexedEvent,
  IndexedEventBatch,
  RefreshBalanceInput,
  RefreshBalanceResult,
} from "./domain.js";
import type { DecryptionProvider, IndexedEventSource } from "./interfaces.js";

export class FakeIndexedEventSource implements IndexedEventSource {
  readonly #events: IndexedEvent[];

  constructor(events: IndexedEvent[]) {
    this.#events = events;
  }

  async nextBatch(cursor: EventCursor | null): Promise<IndexedEventBatch> {
    const events = cursor
      ? this.#events.filter(
          (event) => event.blockNumber > cursor.blockNumber || (event.blockNumber === cursor.blockNumber && event.logIndex > cursor.logIndex),
        )
      : this.#events;
    const last = events.at(-1);
    return {
      events,
      nextCursor: last ? { blockNumber: last.blockNumber, logIndex: last.logIndex } : cursor,
    };
  }
}

export class FakeDecryptionProvider implements DecryptionProvider {
  readonly #amounts = new Map<Hex, bigint>();
  readonly #balances = new Map<string, bigint>();
  #failure: DecryptAmountResult | null = null;

  setAmount(encryptedAmount: Hex, amount: bigint): void {
    this.#amounts.set(encryptedAmount, amount);
  }

  setBalance(input: { chainId: number; tokenAddress: Address; holder: Address; balance: bigint }): void {
    this.#balances.set(this.#balanceKey(input.chainId, input.tokenAddress, input.holder), input.balance);
  }

  failWith(result: Exclude<DecryptAmountResult, { status: "decrypted" }>): void {
    this.#failure = result;
  }

  async decryptTransferAmount(input: DecryptTransferAmountInput): Promise<DecryptAmountResult> {
    if (this.#failure) return this.#failure;
    const amount = this.#amounts.get(input.encryptedAmount);
    if (amount === undefined) return { status: "not_delegated", reason: "missing_delegation" };
    return { status: "decrypted", amount };
  }

  async refreshCurrentBalance(input: RefreshBalanceInput): Promise<RefreshBalanceResult> {
    const balance = this.#balances.get(this.#balanceKey(input.chainId, input.tokenAddress, input.holder));
    if (balance === undefined) return { status: "unknown", reason: "missing_delegation" };
    return { status: "known", balance, source: "direct_decrypt" };
  }

  #balanceKey(chainId: number, tokenAddress: Address, holder: Address): string {
    return `${chainId}:${tokenAddress.toLowerCase()}:${holder.toLowerCase()}`;
  }
}
```

Write `packages/core/src/index.ts`:

```ts
export * from "./domain.js";
export * from "./interfaces.js";
export * from "./fakes.js";
```

- [ ] **Step 6: Run test to verify it passes**

Run:

```bash
pnpm vitest run packages/core/tests/domain.test.ts
```

Expected: PASS.

- [ ] **Step 7: Run package typecheck**

Run:

```bash
pnpm --filter @confidential-indexer/core typecheck
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/core
git commit -m "feat(core): define confidential indexer domain interfaces"
```

---

### Task 3: Postgres Schema and Repository Adapters

**Files:**
- Create: `packages/db/migrations/001_initial.sql`
- Create: `packages/db/src/connection.ts`
- Create: `packages/db/src/migrate.ts`
- Create: `packages/db/src/PostgresRepositories.ts`
- Create: `packages/db/src/PostgresReadModel.ts`
- Create: `packages/db/src/index.ts`
- Create: `packages/db/tests/repositories.test.ts`

**Interfaces:**
- Consumes: `TransferRepository`, `BalanceRepository`, `CheckpointRepository`, `DecryptionAttemptRepository`, `ReadModel` from `@confidential-indexer/core`.
- Produces: `PostgresRepositories`, `PostgresReadModel`, `createPool(databaseUrl: string)`, `runMigrations(pool: Pool)`.

- [ ] **Step 1: Write failing repository test**

Write `packages/db/tests/repositories.test.ts`:

```ts
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createPool, PostgresReadModel, PostgresRepositories, runMigrations } from "../src/index.js";
import type { IndexedEvent } from "@confidential-indexer/core";

const databaseUrl = process.env.DATABASE_URL ?? "postgres://indexer:indexer@localhost:5432/confidential_indexer";

const event: IndexedEvent = {
  kind: "confidential_transfer",
  chainId: 31337,
  tokenAddress: "0x0000000000000000000000000000000000000001",
  txHash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  logIndex: 7,
  blockNumber: 10n,
  blockTimestamp: new Date("2026-06-29T00:00:00.000Z"),
  from: "0x00000000000000000000000000000000000000aa",
  to: "0x00000000000000000000000000000000000000bb",
  encryptedAmount: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
};

describe("Postgres repositories", () => {
  it("stores pending transfers and exposes decrypted balances", async () => {
    const pool = createPool(databaseUrl);
    await runMigrations(pool);
    const schema = `test_${randomUUID().replaceAll("-", "")}`;
    await pool.query(`create schema ${schema}`);
    await pool.query(`set search_path to ${schema}, public`);
    await runMigrations(pool);

    const repos = new PostgresRepositories(pool, "hyperindex");
    const readModel = new PostgresReadModel(pool, "hyperindex");

    await repos.transfers.upsertIndexedEvent(event);
    const pending = await repos.transfers.listPendingDecryptions(10);
    expect(pending).toHaveLength(1);

    await repos.transfers.markTransferDecrypted({ chainId: event.chainId, txHash: event.txHash, logIndex: event.logIndex, amount: 25n });
    await repos.balances.applyDecryptedTransfer(pending[0]!, 25n);

    const transfers = await readModel.getTransfers({ holder: event.to, limit: 20, offset: 0 });
    const balances = await readModel.getBalances({ holder: event.to });

    expect(transfers.items[0]?.amount).toBe(25n);
    expect(balances.items[0]?.balance).toBe(25n);

    await pool.end();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm dev:db
pnpm vitest run packages/db/tests/repositories.test.ts
```

Expected: FAIL because DB source files do not exist.

- [ ] **Step 3: Create migration SQL**

Write `packages/db/migrations/001_initial.sql`:

```sql
create table if not exists event_checkpoints (
  source_name text primary key,
  block_number numeric,
  log_index integer,
  updated_at timestamptz not null default now()
);

create table if not exists transfers (
  chain_id integer not null,
  token_address text not null,
  tx_hash text not null,
  log_index integer not null,
  block_number numeric not null,
  block_timestamp timestamptz not null,
  from_address text not null,
  to_address text not null,
  encrypted_amount text not null,
  amount numeric,
  decryption_status text not null default 'pending',
  decryption_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (chain_id, tx_hash, log_index)
);

create index if not exists transfers_holder_idx on transfers (chain_id, token_address, from_address, to_address, block_number desc, log_index desc);
create index if not exists transfers_status_idx on transfers (decryption_status, block_number asc, log_index asc);

create table if not exists balances (
  chain_id integer not null,
  token_address text not null,
  holder text not null,
  balance numeric,
  balance_status text not null,
  balance_source text not null,
  history_completeness text not null,
  updated_at timestamptz not null default now(),
  primary key (chain_id, token_address, holder)
);

create table if not exists delegations (
  chain_id integer not null,
  token_address text not null,
  delegator text not null,
  delegate text not null,
  active boolean not null,
  expires_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (chain_id, token_address, delegator, delegate)
);

create table if not exists decryption_attempts (
  id bigserial primary key,
  chain_id integer not null,
  token_address text not null,
  tx_hash text not null,
  log_index integer not null,
  status text not null,
  reason text,
  message text,
  created_at timestamptz not null default now()
);
```

- [ ] **Step 4: Implement connection and migration helpers**

Write `packages/db/src/connection.ts`:

```ts
import pg from "pg";

export type Pool = pg.Pool;
export type PoolClient = pg.PoolClient;

export function createPool(databaseUrl: string): Pool {
  return new pg.Pool({ connectionString: databaseUrl });
}
```

Write `packages/db/src/migrate.ts`:

```ts
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Pool } from "./connection.js";

export async function runMigrations(pool: Pool): Promise<void> {
  const here = dirname(fileURLToPath(import.meta.url));
  const migrationPath = join(here, "..", "migrations", "001_initial.sql");
  const sql = await readFile(migrationPath, "utf8");
  await pool.query(sql);
}
```

- [ ] **Step 5: Implement repositories**

Write `packages/db/src/PostgresRepositories.ts` with this complete implementation:

```ts
import type {
  BalanceRecord,
  CheckpointRepository,
  DecryptionAttemptRepository,
  EventCursor,
  IndexedEvent,
  StoredTransfer,
  TransferRepository,
  BalanceRepository,
} from "@confidential-indexer/core";
import type { Pool } from "./connection.js";

function toBigInt(value: string | number | bigint): bigint {
  return typeof value === "bigint" ? value : BigInt(value);
}

function mapTransfer(row: Record<string, unknown>): StoredTransfer {
  return {
    chainId: Number(row.chain_id),
    tokenAddress: row.token_address as StoredTransfer["tokenAddress"],
    txHash: row.tx_hash as StoredTransfer["txHash"],
    logIndex: Number(row.log_index),
    blockNumber: toBigInt(row.block_number as string),
    blockTimestamp: row.block_timestamp as Date,
    from: row.from_address as StoredTransfer["from"],
    to: row.to_address as StoredTransfer["to"],
    encryptedAmount: row.encrypted_amount as StoredTransfer["encryptedAmount"],
    amount: row.amount === null ? null : toBigInt(row.amount as string),
    decryptionStatus: row.decryption_status as StoredTransfer["decryptionStatus"],
    decryptionReason: row.decryption_reason as StoredTransfer["decryptionReason"],
  };
}

export class PostgresRepositories {
  readonly checkpoints: CheckpointRepository;
  readonly transfers: TransferRepository;
  readonly balances: BalanceRepository;
  readonly attempts: DecryptionAttemptRepository;

  constructor(pool: Pool, sourceName: string) {
    this.checkpoints = new PgCheckpointRepository(pool, sourceName);
    this.transfers = new PgTransferRepository(pool);
    this.balances = new PgBalanceRepository(pool);
    this.attempts = new PgDecryptionAttemptRepository(pool);
  }
}

class PgCheckpointRepository implements CheckpointRepository {
  constructor(private readonly pool: Pool, private readonly sourceName: string) {}

  async getCursor(): Promise<EventCursor | null> {
    const result = await this.pool.query("select block_number, log_index from event_checkpoints where source_name = $1", [this.sourceName]);
    const row = result.rows[0];
    if (!row || row.block_number === null || row.log_index === null) return null;
    return { blockNumber: toBigInt(row.block_number), logIndex: Number(row.log_index) };
  }

  async saveCursor(_sourceName: string, cursor: EventCursor | null): Promise<void> {
    await this.pool.query(
      `insert into event_checkpoints (source_name, block_number, log_index)
       values ($1, $2, $3)
       on conflict (source_name) do update set block_number = excluded.block_number, log_index = excluded.log_index, updated_at = now()`,
      [this.sourceName, cursor?.blockNumber.toString() ?? null, cursor?.logIndex ?? null],
    );
  }
}

class PgTransferRepository implements TransferRepository {
  constructor(private readonly pool: Pool) {}

  async upsertIndexedEvent(event: IndexedEvent): Promise<void> {
    if (event.kind !== "confidential_transfer") return;
    await this.pool.query(
      `insert into transfers (chain_id, token_address, tx_hash, log_index, block_number, block_timestamp, from_address, to_address, encrypted_amount)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       on conflict (chain_id, tx_hash, log_index) do nothing`,
      [event.chainId, event.tokenAddress.toLowerCase(), event.txHash, event.logIndex, event.blockNumber.toString(), event.blockTimestamp, event.from.toLowerCase(), event.to.toLowerCase(), event.encryptedAmount],
    );
  }

  async listPendingDecryptions(limit: number): Promise<StoredTransfer[]> {
    const result = await this.pool.query(
      `select * from transfers where decryption_status in ('pending','not_delegated','retryable_error') order by block_number asc, log_index asc limit $1`,
      [limit],
    );
    return result.rows.map(mapTransfer);
  }

  async markTransferDecrypted(input: { chainId: number; txHash: StoredTransfer["txHash"]; logIndex: number; amount: bigint }): Promise<void> {
    await this.pool.query(
      `update transfers set amount = $4, decryption_status = 'decrypted', decryption_reason = null, updated_at = now()
       where chain_id = $1 and tx_hash = $2 and log_index = $3`,
      [input.chainId, input.txHash, input.logIndex, input.amount.toString()],
    );
  }

  async markTransferUndecrypted(input: {
    chainId: number;
    txHash: StoredTransfer["txHash"];
    logIndex: number;
    status: StoredTransfer["decryptionStatus"];
    reason: StoredTransfer["decryptionReason"];
  }): Promise<void> {
    await this.pool.query(
      `update transfers set decryption_status = $4, decryption_reason = $5, updated_at = now()
       where chain_id = $1 and tx_hash = $2 and log_index = $3`,
      [input.chainId, input.txHash, input.logIndex, input.status, input.reason],
    );
  }

  async listTransfersForHolder(query: import("@confidential-indexer/core").TransferQuery): Promise<import("@confidential-indexer/core").TransferPage> {
    const result = await this.pool.query(
      `select * from transfers
       where ($1::text is null or from_address = lower($1) or to_address = lower($1))
       and ($2::integer is null or chain_id = $2)
       and ($3::text is null or token_address = lower($3))
       and ($4::text is null or decryption_status = $4)
       order by block_number desc, log_index desc
       limit $5 offset $6`,
      [query.holder, query.chainId ?? null, query.tokenAddress ?? null, query.decryptionStatus ?? null, query.limit, query.offset],
    );
    return { items: result.rows.map(mapTransfer), limit: query.limit, offset: query.offset };
  }
}

class PgBalanceRepository implements BalanceRepository {
  constructor(private readonly pool: Pool) {}

  async applyDecryptedTransfer(transfer: StoredTransfer, amount: bigint): Promise<void> {
    await this.upsertDelta(transfer.chainId, transfer.tokenAddress, transfer.from, -amount);
    await this.upsertDelta(transfer.chainId, transfer.tokenAddress, transfer.to, amount);
  }

  async saveDirectBalance(record: BalanceRecord): Promise<void> {
    await this.pool.query(
      `insert into balances (chain_id, token_address, holder, balance, balance_status, balance_source, history_completeness, updated_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8)
       on conflict (chain_id, token_address, holder) do update set
       balance = excluded.balance, balance_status = excluded.balance_status, balance_source = excluded.balance_source,
       history_completeness = excluded.history_completeness, updated_at = excluded.updated_at`,
      [record.chainId, record.tokenAddress.toLowerCase(), record.holder.toLowerCase(), record.balance?.toString() ?? null, record.balanceStatus, record.balanceSource, record.historyCompleteness, record.updatedAt],
    );
  }

  async listBalances(query: import("@confidential-indexer/core").BalanceQuery): Promise<import("@confidential-indexer/core").BalancePage> {
    const result = await this.pool.query(
      `select * from balances where holder = lower($1)
       and ($2::integer is null or chain_id = $2)
       and ($3::text is null or token_address = lower($3))
       order by chain_id asc, token_address asc`,
      [query.holder, query.chainId ?? null, query.tokenAddress ?? null],
    );
    return {
      items: result.rows.map((row) => ({
        chainId: Number(row.chain_id),
        tokenAddress: row.token_address,
        holder: row.holder,
        balance: row.balance === null ? null : toBigInt(row.balance),
        balanceStatus: row.balance_status,
        balanceSource: row.balance_source,
        historyCompleteness: row.history_completeness,
        updatedAt: row.updated_at,
      })),
    };
  }

  private async upsertDelta(chainId: number, tokenAddress: string, holder: string, delta: bigint): Promise<void> {
    await this.pool.query(
      `insert into balances (chain_id, token_address, holder, balance, balance_status, balance_source, history_completeness)
       values ($1,$2,$3,$4,'known','events','partial')
       on conflict (chain_id, token_address, holder) do update set
       balance = coalesce(balances.balance, 0) + excluded.balance,
       balance_status = 'known', balance_source = 'events', history_completeness = 'partial', updated_at = now()`,
      [chainId, tokenAddress.toLowerCase(), holder.toLowerCase(), delta.toString()],
    );
  }
}

class PgDecryptionAttemptRepository implements DecryptionAttemptRepository {
  constructor(private readonly pool: Pool) {}

  async recordAttempt(input: {
    chainId: number;
    tokenAddress: StoredTransfer["tokenAddress"];
    txHash: StoredTransfer["txHash"];
    logIndex: number;
    status: StoredTransfer["decryptionStatus"];
    reason: StoredTransfer["decryptionReason"];
    message: string | null;
  }): Promise<void> {
    await this.pool.query(
      `insert into decryption_attempts (chain_id, token_address, tx_hash, log_index, status, reason, message)
       values ($1,$2,$3,$4,$5,$6,$7)`,
      [input.chainId, input.tokenAddress.toLowerCase(), input.txHash, input.logIndex, input.status, input.reason, input.message],
    );
  }
}
```

- [ ] **Step 6: Implement read model and exports**

Write `packages/db/src/PostgresReadModel.ts`:

```ts
import type { HealthSnapshot, ReadModel, BalanceQuery, BalancePage, TransferQuery, TransferPage } from "@confidential-indexer/core";
import type { Pool } from "./connection.js";
import { PostgresRepositories } from "./PostgresRepositories.js";

export class PostgresReadModel implements ReadModel {
  private readonly repos: PostgresRepositories;

  constructor(private readonly pool: Pool, sourceName: string) {
    this.repos = new PostgresRepositories(pool, sourceName);
  }

  async getBalances(query: BalanceQuery): Promise<BalancePage> {
    return this.repos.balances.listBalances(query);
  }

  async getTransfers(query: TransferQuery): Promise<TransferPage> {
    return this.repos.transfers.listTransfersForHolder(query);
  }

  async getHealth(): Promise<HealthSnapshot> {
    try {
      await this.pool.query("select 1");
      const cursor = await this.repos.checkpoints.getCursor("hyperindex");
      return { ok: true, database: "up", checkpoints: [{ sourceName: "hyperindex", cursor }] };
    } catch {
      return { ok: false, database: "down", checkpoints: [] };
    }
  }
}
```

Write `packages/db/src/index.ts`:

```ts
export * from "./connection.js";
export * from "./migrate.js";
export * from "./PostgresRepositories.js";
export * from "./PostgresReadModel.js";
```

- [ ] **Step 7: Run repository test**

Run:

```bash
pnpm dev:db
pnpm vitest run packages/db/tests/repositories.test.ts
```

Expected: PASS.

- [ ] **Step 8: Typecheck DB package**

Run:

```bash
pnpm --filter @confidential-indexer/db typecheck
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add packages/db
git commit -m "feat(db): add Postgres read model repositories"
```

---

### Task 4: ConfidentialIndexer Workflow

**Files:**
- Create: `packages/core/src/ConfidentialIndexer.ts`
- Modify: `packages/core/src/index.ts`
- Create: `packages/core/tests/confidential-indexer.test.ts`

**Interfaces:**
- Consumes: `IndexedEventSource`, `DecryptionProvider`, repository interfaces.
- Produces: `createConfidentialIndexer(deps): ConfidentialIndexer`.

- [ ] **Step 1: Write failing workflow tests**

Write `packages/core/tests/confidential-indexer.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  createConfidentialIndexer,
  FakeDecryptionProvider,
  FakeIndexedEventSource,
  type IndexedEvent,
  type StoredTransfer,
  type TransferRepository,
  type BalanceRepository,
  type CheckpointRepository,
  type DecryptionAttemptRepository,
} from "../src/index.js";

const transfer: IndexedEvent = {
  kind: "confidential_transfer",
  chainId: 31337,
  tokenAddress: "0x0000000000000000000000000000000000000001",
  txHash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  logIndex: 0,
  blockNumber: 1n,
  blockTimestamp: new Date("2026-06-29T00:00:00.000Z"),
  from: "0x00000000000000000000000000000000000000aa",
  to: "0x00000000000000000000000000000000000000bb",
  encryptedAmount: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
};

function createMemoryRepos() {
  const transfers: StoredTransfer[] = [];
  const checkpoints = new Map<string, { blockNumber: bigint; logIndex: number } | null>();
  const attempts: Array<{ status: string; reason: string | null }> = [];
  const balances = new Map<string, bigint>();

  const transferRepo: TransferRepository = {
    async upsertIndexedEvent(event) {
      if (event.kind !== "confidential_transfer") return;
      transfers.push({ ...event, amount: null, decryptionStatus: "pending", decryptionReason: "missing_delegation" });
    },
    async listPendingDecryptions(limit) {
      return transfers.filter((item) => item.decryptionStatus !== "decrypted").slice(0, limit);
    },
    async markTransferDecrypted(input) {
      const item = transfers.find((candidate) => candidate.txHash === input.txHash && candidate.logIndex === input.logIndex);
      if (item) {
        item.amount = input.amount;
        item.decryptionStatus = "decrypted";
        item.decryptionReason = null;
      }
    },
    async markTransferUndecrypted(input) {
      const item = transfers.find((candidate) => candidate.txHash === input.txHash && candidate.logIndex === input.logIndex);
      if (item) {
        item.decryptionStatus = input.status;
        item.decryptionReason = input.reason;
      }
    },
    async listTransfersForHolder(query) {
      return { items: transfers.filter((item) => item.from === query.holder || item.to === query.holder), limit: query.limit, offset: query.offset };
    },
  };

  const balanceRepo: BalanceRepository = {
    async applyDecryptedTransfer(item, amount) {
      balances.set(item.from, (balances.get(item.from) ?? 0n) - amount);
      balances.set(item.to, (balances.get(item.to) ?? 0n) + amount);
    },
    async saveDirectBalance(record) {
      balances.set(record.holder, record.balance ?? 0n);
    },
    async listBalances(query) {
      return {
        items: [{ chainId: 31337, tokenAddress: transfer.tokenAddress, holder: query.holder, balance: balances.get(query.holder) ?? null, balanceStatus: balances.has(query.holder) ? "known" : "unknown", balanceSource: balances.has(query.holder) ? "events" : "none", historyCompleteness: "partial", updatedAt: new Date("2026-06-29T00:00:00.000Z") }],
      };
    },
  };

  const checkpointRepo: CheckpointRepository = {
    async getCursor(sourceName) {
      return checkpoints.get(sourceName) ?? null;
    },
    async saveCursor(sourceName, cursor) {
      checkpoints.set(sourceName, cursor);
    },
  };

  const attemptRepo: DecryptionAttemptRepository = {
    async recordAttempt(input) {
      attempts.push({ status: input.status, reason: input.reason });
    },
  };

  return { transferRepo, balanceRepo, checkpointRepo, attemptRepo, transfers, balances, attempts };
}

describe("ConfidentialIndexer", () => {
  it("ingests, decrypts, records attempts, and updates balances", async () => {
    const repos = createMemoryRepos();
    const decryption = new FakeDecryptionProvider();
    decryption.setAmount(transfer.encryptedAmount, 25n);
    const indexer = createConfidentialIndexer({ sourceName: "hyperindex", eventSource: new FakeIndexedEventSource([transfer]), decryption, transfers: repos.transferRepo, balances: repos.balanceRepo, checkpoints: repos.checkpointRepo, attempts: repos.attemptRepo });

    await expect(indexer.ingestNextBatch()).resolves.toEqual({ ingested: 1, nextCursor: { blockNumber: 1n, logIndex: 0 } });
    await expect(indexer.processPendingDecryptions(10)).resolves.toEqual({ attempted: 1, decrypted: 1, pending: 0, failed: 0 });

    expect(repos.transfers[0]?.amount).toBe(25n);
    expect(repos.balances.get(transfer.to)).toBe(25n);
    expect(repos.attempts).toEqual([{ status: "decrypted", reason: null }]);
  });

  it("keeps undecryptable events queryable", async () => {
    const repos = createMemoryRepos();
    const decryption = new FakeDecryptionProvider();
    decryption.failWith({ status: "not_delegated", reason: "missing_delegation" });
    const indexer = createConfidentialIndexer({ sourceName: "hyperindex", eventSource: new FakeIndexedEventSource([transfer]), decryption, transfers: repos.transferRepo, balances: repos.balanceRepo, checkpoints: repos.checkpointRepo, attempts: repos.attemptRepo });

    await indexer.ingestNextBatch();
    await expect(indexer.processPendingDecryptions(10)).resolves.toEqual({ attempted: 1, decrypted: 0, pending: 1, failed: 0 });

    expect(repos.transfers[0]?.amount).toBeNull();
    expect(repos.transfers[0]?.decryptionStatus).toBe("not_delegated");
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
pnpm vitest run packages/core/tests/confidential-indexer.test.ts
```

Expected: FAIL because `createConfidentialIndexer` is not exported.

- [ ] **Step 3: Implement workflow module**

Write `packages/core/src/ConfidentialIndexer.ts`:

```ts
import type {
  BackfillHolderInput,
  BackfillReport,
  ConfidentialIndexer,
  DecryptionAttemptRepository,
  DecryptionProvider,
  DecryptionReport,
  BalanceRepository,
  CheckpointRepository,
  IndexedEventSource,
  IngestionReport,
  TransferRepository,
} from "./interfaces.js";

export interface ConfidentialIndexerDeps {
  sourceName: string;
  eventSource: IndexedEventSource;
  decryption: DecryptionProvider;
  transfers: TransferRepository;
  balances: BalanceRepository;
  checkpoints: CheckpointRepository;
  attempts: DecryptionAttemptRepository;
}

export function createConfidentialIndexer(deps: ConfidentialIndexerDeps): ConfidentialIndexer {
  return {
    async ingestNextBatch(): Promise<IngestionReport> {
      const cursor = await deps.checkpoints.getCursor(deps.sourceName);
      const batch = await deps.eventSource.nextBatch(cursor);
      for (const event of batch.events) {
        await deps.transfers.upsertIndexedEvent(event);
      }
      await deps.checkpoints.saveCursor(deps.sourceName, batch.nextCursor);
      return { ingested: batch.events.length, nextCursor: batch.nextCursor };
    },

    async processPendingDecryptions(limit = 100): Promise<DecryptionReport> {
      const pending = await deps.transfers.listPendingDecryptions(limit);
      const report: DecryptionReport = { attempted: 0, decrypted: 0, pending: 0, failed: 0 };

      for (const transfer of pending) {
        report.attempted += 1;
        const result = await deps.decryption.decryptTransferAmount({
          chainId: transfer.chainId,
          tokenAddress: transfer.tokenAddress,
          holder: transfer.to,
          encryptedAmount: transfer.encryptedAmount,
        });

        if (result.status === "decrypted") {
          await deps.transfers.markTransferDecrypted({ chainId: transfer.chainId, txHash: transfer.txHash, logIndex: transfer.logIndex, amount: result.amount });
          await deps.balances.applyDecryptedTransfer(transfer, result.amount);
          await deps.attempts.recordAttempt({ chainId: transfer.chainId, tokenAddress: transfer.tokenAddress, txHash: transfer.txHash, logIndex: transfer.logIndex, status: "decrypted", reason: null, message: null });
          report.decrypted += 1;
          continue;
        }

        await deps.transfers.markTransferUndecrypted({ chainId: transfer.chainId, txHash: transfer.txHash, logIndex: transfer.logIndex, status: result.status, reason: result.reason });
        await deps.attempts.recordAttempt({ chainId: transfer.chainId, tokenAddress: transfer.tokenAddress, txHash: transfer.txHash, logIndex: transfer.logIndex, status: result.status, reason: result.reason, message: result.reason });
        if (result.status === "failed") report.failed += 1;
        else report.pending += 1;
      }

      return report;
    },

    async backfillHolder(input: BackfillHolderInput): Promise<BackfillReport> {
      const transferReport = await this.processPendingDecryptions(100);
      const balance = await deps.decryption.refreshCurrentBalance(input);
      if (balance.status === "known") {
        await deps.balances.saveDirectBalance({
          chainId: input.chainId,
          tokenAddress: input.tokenAddress,
          holder: input.holder,
          balance: balance.balance,
          balanceStatus: "known",
          balanceSource: balance.source,
          historyCompleteness: "partial",
          updatedAt: new Date(),
        });
        return { holder: input.holder, transferReport, balanceRefreshed: true };
      }
      return { holder: input.holder, transferReport, balanceRefreshed: false };
    },
  };
}
```

- [ ] **Step 4: Export workflow module**

Modify `packages/core/src/index.ts` to exactly:

```ts
export * from "./domain.js";
export * from "./interfaces.js";
export * from "./fakes.js";
export * from "./ConfidentialIndexer.js";
```

- [ ] **Step 5: Run workflow tests**

Run:

```bash
pnpm vitest run packages/core/tests/confidential-indexer.test.ts
```

Expected: PASS.

- [ ] **Step 6: Run all core tests and typecheck**

Run:

```bash
pnpm vitest run packages/core/tests
pnpm --filter @confidential-indexer/core typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/core
git commit -m "feat(core): orchestrate ingestion and decryption workflow"
```

---

### Task 5: HTTP API and Admin Backfill

**Files:**
- Create: `apps/api/src/config.ts`
- Create: `apps/api/src/http/createServer.ts`
- Create: `apps/api/src/http/routes.ts`
- Create: `apps/api/src/main.ts`
- Create: `apps/api/src/workers/runOnce.ts`
- Create: `apps/api/tests/api.test.ts`

**Interfaces:**
- Consumes: `ReadModel`, `ConfidentialIndexer`, `PostgresReadModel`, `PostgresRepositories`, `IndexedEventSource`, `DecryptionProvider`.
- Produces: `createServer({ readModel, indexer, adminApiKey })` and runnable API app.

- [ ] **Step 1: Write failing API tests**

Write `apps/api/tests/api.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createServer } from "../src/http/createServer.js";
import type { ConfidentialIndexer, ReadModel } from "@confidential-indexer/core";

const readModel: ReadModel = {
  async getBalances(query) {
    return {
      items: [{ chainId: 31337, tokenAddress: "0x0000000000000000000000000000000000000001", holder: query.holder, balance: 150n, balanceStatus: "known", balanceSource: "direct_decrypt", historyCompleteness: "partial", updatedAt: new Date("2026-06-29T00:00:00.000Z") }],
    };
  },
  async getTransfers(query) {
    return {
      limit: query.limit,
      offset: query.offset,
      items: [{ chainId: 31337, tokenAddress: "0x0000000000000000000000000000000000000001", txHash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", logIndex: 0, blockNumber: 1n, blockTimestamp: new Date("2026-06-29T00:00:00.000Z"), from: "0x00000000000000000000000000000000000000aa", to: query.holder, encryptedAmount: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", amount: null, decryptionStatus: "pending", decryptionReason: "missing_delegation" }],
    };
  },
  async getHealth() {
    return { ok: true, database: "up", checkpoints: [{ sourceName: "hyperindex", cursor: { blockNumber: 1n, logIndex: 0 } }] };
  },
};

const indexer: ConfidentialIndexer = {
  async ingestNextBatch() {
    return { ingested: 0, nextCursor: null };
  },
  async processPendingDecryptions() {
    return { attempted: 0, decrypted: 0, pending: 0, failed: 0 };
  },
  async backfillHolder(input) {
    return { holder: input.holder, transferReport: { attempted: 1, decrypted: 1, pending: 0, failed: 0 }, balanceRefreshed: true };
  },
};

describe("HTTP API", () => {
  it("returns balances with bigint values serialized as strings", async () => {
    const app = createServer({ readModel, indexer, adminApiKey: "secret" });
    const response = await app.inject({ method: "GET", url: "/v1/balances/0x00000000000000000000000000000000000000bb" });
    expect(response.statusCode).toBe(200);
    expect(response.json().items[0].balance).toBe("150");
  });

  it("returns pending transfer amounts as null with decryption metadata", async () => {
    const app = createServer({ readModel, indexer, adminApiKey: "secret" });
    const response = await app.inject({ method: "GET", url: "/v1/transfers/0x00000000000000000000000000000000000000bb" });
    expect(response.statusCode).toBe(200);
    expect(response.json().items[0]).toMatchObject({ amount: null, decryptionStatus: "pending", decryptionReason: "missing_delegation" });
  });

  it("protects admin backfill with API key", async () => {
    const app = createServer({ readModel, indexer, adminApiKey: "secret" });
    const missingKey = await app.inject({ method: "POST", url: "/admin/backfill", payload: { chainId: 31337, tokenAddress: "0x0000000000000000000000000000000000000001", holder: "0x00000000000000000000000000000000000000bb" } });
    expect(missingKey.statusCode).toBe(401);

    const ok = await app.inject({ method: "POST", url: "/admin/backfill", headers: { "x-admin-api-key": "secret" }, payload: { chainId: 31337, tokenAddress: "0x0000000000000000000000000000000000000001", holder: "0x00000000000000000000000000000000000000bb" } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().balanceRefreshed).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run:

```bash
pnpm vitest run apps/api/tests/api.test.ts
```

Expected: FAIL because `createServer` does not exist.

- [ ] **Step 3: Implement HTTP serialization and routes**

Write `apps/api/src/http/createServer.ts`:

```ts
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
```

Write `apps/api/src/http/routes.ts`:

```ts
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { CreateServerDeps } from "./createServer.js";

const addressSchema = z.string().regex(/^0x[a-fA-F0-9]{40}$/);
const hex32Schema = z.string().regex(/^0x[a-fA-F0-9]{64}$/);

function stringifyBigInts(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(stringifyBigInts);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, stringifyBigInts(item)]));
  }
  return value;
}

export function registerRoutes(app: FastifyInstance, deps: CreateServerDeps): void {
  app.get("/v1/balances/:holder", async (request, reply) => {
    const params = z.object({ holder: addressSchema }).parse(request.params);
    const query = z.object({ chainId: z.coerce.number().optional(), tokenAddress: addressSchema.optional() }).parse(request.query);
    const result = await deps.readModel.getBalances({ holder: params.holder as `0x${string}`, chainId: query.chainId, tokenAddress: query.tokenAddress as `0x${string}` | undefined });
    return reply.send(stringifyBigInts(result));
  });

  app.get("/v1/transfers/:holder", async (request, reply) => {
    const params = z.object({ holder: addressSchema }).parse(request.params);
    const query = z.object({ chainId: z.coerce.number().optional(), tokenAddress: addressSchema.optional(), decryptionStatus: z.enum(["pending", "not_delegated", "retryable_error", "failed", "decrypted"]).optional(), limit: z.coerce.number().int().min(1).max(100).default(50), offset: z.coerce.number().int().min(0).default(0) }).parse(request.query);
    const result = await deps.readModel.getTransfers({ holder: params.holder as `0x${string}`, chainId: query.chainId, tokenAddress: query.tokenAddress as `0x${string}` | undefined, decryptionStatus: query.decryptionStatus, limit: query.limit, offset: query.offset });
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
    const body = z.object({ chainId: z.number().int(), tokenAddress: addressSchema, holder: addressSchema }).parse(request.body);
    const result = await deps.indexer.backfillHolder({ chainId: body.chainId, tokenAddress: body.tokenAddress as `0x${string}`, holder: body.holder as `0x${string}` });
    return reply.send(stringifyBigInts(result));
  });
}
```

- [ ] **Step 4: Implement config, worker helper, and main composition root**

Write `apps/api/src/config.ts`:

```ts
import { z } from "zod";

export const appConfigSchema = z.object({
  databaseUrl: z.string().url(),
  adminApiKey: z.string().min(1),
  host: z.string().default("127.0.0.1"),
  port: z.coerce.number().int().default(3000),
});

export type AppConfig = z.infer<typeof appConfigSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return appConfigSchema.parse({
    databaseUrl: env.DATABASE_URL,
    adminApiKey: env.ADMIN_API_KEY,
    host: env.API_HOST,
    port: env.API_PORT,
  });
}
```

Write `apps/api/src/workers/runOnce.ts`:

```ts
import type { ConfidentialIndexer } from "@confidential-indexer/core";

export async function runOnce(indexer: ConfidentialIndexer): Promise<void> {
  await indexer.ingestNextBatch();
  await indexer.processPendingDecryptions(100);
}
```

Write `apps/api/src/main.ts`:

```ts
import { FakeDecryptionProvider, FakeIndexedEventSource, createConfidentialIndexer } from "@confidential-indexer/core";
import { createPool, PostgresReadModel, PostgresRepositories, runMigrations } from "@confidential-indexer/db";
import { loadConfig } from "./config.js";
import { createServer } from "./http/createServer.js";

const config = loadConfig();
const pool = createPool(config.databaseUrl);
await runMigrations(pool);

const repos = new PostgresRepositories(pool, "hyperindex");
const readModel = new PostgresReadModel(pool, "hyperindex");

const indexer = createConfidentialIndexer({
  sourceName: "hyperindex",
  eventSource: new FakeIndexedEventSource([]),
  decryption: new FakeDecryptionProvider(),
  transfers: repos.transfers,
  balances: repos.balances,
  checkpoints: repos.checkpoints,
  attempts: repos.attempts,
});

const app = createServer({ readModel, indexer, adminApiKey: config.adminApiKey });
await app.listen({ host: config.host, port: config.port });
```

- [ ] **Step 5: Run API tests**

Run:

```bash
pnpm vitest run apps/api/tests/api.test.ts
```

Expected: PASS.

- [ ] **Step 6: Typecheck API package**

Run:

```bash
pnpm --filter @confidential-indexer/api typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api
git commit -m "feat(api): expose partner read and backfill endpoints"
```

---

### Task 6: Zama DecryptionProvider Adapter

**Files:**
- Create: `packages/zama/src/ZamaDecryptionProvider.ts`
- Create: `packages/zama/src/index.ts`
- Create: `packages/zama/tests/zama-error-mapping.test.ts`

**Interfaces:**
- Consumes: `DecryptionProvider` from `@confidential-indexer/core`.
- Produces: `ZamaDecryptionProvider` and `mapZamaError(error)`.

- [ ] **Step 1: Write failing error-mapping test**

Write `packages/zama/tests/zama-error-mapping.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { mapZamaError } from "../src/index.js";

describe("mapZamaError", () => {
  it("maps delegation errors to not_delegated", () => {
    expect(mapZamaError(new Error("DelegationNotFoundError: no active delegation"))).toEqual({ status: "not_delegated", reason: "missing_delegation" });
  });

  it("maps propagation-like errors to retryable_error", () => {
    expect(mapZamaError(new Error("gateway has not synced ACL state yet"))).toEqual({ status: "retryable_error", reason: "delegation_propagating" });
  });

  it("maps unknown SDK errors to retryable_error", () => {
    expect(mapZamaError(new Error("relayer request failed"))).toEqual({ status: "retryable_error", reason: "sdk_error" });
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run:

```bash
pnpm vitest run packages/zama/tests/zama-error-mapping.test.ts
```

Expected: FAIL because `mapZamaError` does not exist.

- [ ] **Step 3: Implement Zama adapter**

Write `packages/zama/src/ZamaDecryptionProvider.ts`:

```ts
import type {
  DecryptAmountResult,
  DecryptionProvider,
  DecryptTransferAmountInput,
  RefreshBalanceInput,
  RefreshBalanceResult,
} from "@confidential-indexer/core";

export interface ZamaTokenLike {
  decryptBalanceAs(input: { delegatorAddress: `0x${string}` }): Promise<bigint>;
}

export interface ZamaSdkLike {
  decryption: {
    delegatedDecryptValues(inputs: Array<{ encryptedValue: `0x${string}`; contractAddress: `0x${string}` }>, delegatorAddress: `0x${string}`): Promise<Record<`0x${string}`, bigint | string | number>>;
  };
  createToken(address: `0x${string}`): ZamaTokenLike;
}

export type ZamaSdkFactory = (chainId: number) => ZamaSdkLike;

export function mapZamaError(error: unknown): Exclude<DecryptAmountResult, { status: "decrypted" }> {
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();
  if (normalized.includes("delegationnotfound") || normalized.includes("no active delegation") || normalized.includes("expired")) {
    return { status: "not_delegated", reason: "missing_delegation" };
  }
  if (normalized.includes("propagat") || normalized.includes("sync") || normalized.includes("acl state")) {
    return { status: "retryable_error", reason: "delegation_propagating" };
  }
  if (normalized.includes("relayer") || normalized.includes("gateway")) {
    return { status: "retryable_error", reason: "relayer_unavailable" };
  }
  return { status: "retryable_error", reason: "sdk_error" };
}

export class ZamaDecryptionProvider implements DecryptionProvider {
  constructor(private readonly sdkForChain: ZamaSdkFactory) {}

  async decryptTransferAmount(input: DecryptTransferAmountInput): Promise<DecryptAmountResult> {
    try {
      const sdk = this.sdkForChain(input.chainId);
      const values = await sdk.decryption.delegatedDecryptValues(
        [{ encryptedValue: input.encryptedAmount, contractAddress: input.tokenAddress }],
        input.holder,
      );
      const clear = values[input.encryptedAmount];
      if (clear === undefined) return { status: "retryable_error", reason: "sdk_error" };
      return { status: "decrypted", amount: BigInt(clear) };
    } catch (error) {
      return mapZamaError(error);
    }
  }

  async refreshCurrentBalance(input: RefreshBalanceInput): Promise<RefreshBalanceResult> {
    try {
      const sdk = this.sdkForChain(input.chainId);
      const token = sdk.createToken(input.tokenAddress);
      const balance = await token.decryptBalanceAs({ delegatorAddress: input.holder });
      return { status: "known", balance, source: "direct_decrypt" };
    } catch (error) {
      const mapped = mapZamaError(error);
      return { status: "unknown", reason: mapped.reason };
    }
  }
}
```

Write `packages/zama/src/index.ts`:

```ts
export * from "./ZamaDecryptionProvider.js";
```

- [ ] **Step 4: Run Zama adapter tests**

Run:

```bash
pnpm vitest run packages/zama/tests/zama-error-mapping.test.ts
```

Expected: PASS.

- [ ] **Step 5: Typecheck Zama package**

Run:

```bash
pnpm --filter @confidential-indexer/zama typecheck
```

Expected: PASS.

- [ ] **Step 6: Add DECISIONS note for Zama adapter seam**

Append this section to `DECISIONS.md`:

```md
## Zama SDK behind DecryptionProvider

We evaluated calling `@zama-fhe/sdk` directly from the indexing workflow versus hiding it behind `DecryptionProvider`. We chose the adapter because delegated decryption has several details that should not leak into the rest of the service: per-network signer setup, permit/session storage, gateway propagation delays, and SDK error taxonomy.

The trade-off is an extra module that initially has only one production adapter. It still earns its place because tests use `FakeDecryptionProvider`, and because SDK alpha APIs may change while the domain workflow and partner API should remain stable.
```

- [ ] **Step 7: Commit**

```bash
git add packages/zama DECISIONS.md
git commit -m "feat(zama): adapt delegated decryption behind provider seam"
```

---

### Task 7: Hyperindex Event Source Adapter and Hyperindex App Stub

**Files:**
- Create: `packages/hyperindex-adapter/src/HyperindexPollingEventSource.ts`
- Create: `packages/hyperindex-adapter/src/index.ts`
- Create: `packages/hyperindex-adapter/tests/hyperindex-polling-event-source.test.ts`
- Create: `apps/hyperindex/src/erc7984-events.ts`
- Create: `apps/hyperindex/README.md`

**Interfaces:**
- Consumes: `IndexedEventSource`, `IndexedEvent`, and Postgres `Pool`.
- Produces: `HyperindexPollingEventSource`, a polling adapter with one method `nextBatch(cursor)`.

- [ ] **Step 1: Write failing adapter test**

Write `packages/hyperindex-adapter/tests/hyperindex-polling-event-source.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { HyperindexPollingEventSource } from "../src/index.js";

class FakePool {
  async query(_sql: string, _params: unknown[]) {
    return {
      rows: [
        {
          kind: "confidential_transfer",
          chain_id: 31337,
          token_address: "0x0000000000000000000000000000000000000001",
          tx_hash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          log_index: 0,
          block_number: "1",
          block_timestamp: new Date("2026-06-29T00:00:00.000Z"),
          from_address: "0x00000000000000000000000000000000000000aa",
          to_address: "0x00000000000000000000000000000000000000bb",
          encrypted_amount: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        },
      ],
    };
  }
}

describe("HyperindexPollingEventSource", () => {
  it("normalizes Hyperindex rows into IndexedEventBatch", async () => {
    const source = new HyperindexPollingEventSource({ pool: new FakePool(), limit: 10 });
    const batch = await source.nextBatch(null);

    expect(batch.events[0]).toMatchObject({ kind: "confidential_transfer", chainId: 31337, logIndex: 0 });
    expect(batch.nextCursor).toEqual({ blockNumber: 1n, logIndex: 0 });
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run:

```bash
pnpm vitest run packages/hyperindex-adapter/tests/hyperindex-polling-event-source.test.ts
```

Expected: FAIL because adapter source does not exist.

- [ ] **Step 3: Implement polling adapter**

Write `packages/hyperindex-adapter/src/HyperindexPollingEventSource.ts`:

```ts
import type { EventCursor, IndexedEvent, IndexedEventBatch, IndexedEventSource } from "@confidential-indexer/core";

export interface QueryablePool {
  query(sql: string, params: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }>;
}

export interface HyperindexPollingEventSourceConfig {
  pool: QueryablePool;
  limit: number;
}

export class HyperindexPollingEventSource implements IndexedEventSource {
  constructor(private readonly config: HyperindexPollingEventSourceConfig) {}

  async nextBatch(cursor: EventCursor | null): Promise<IndexedEventBatch> {
    const result = await this.config.pool.query(
      `select * from hyperindex_events
       where ($1::numeric is null or block_number > $1 or (block_number = $1 and log_index > $2))
       order by block_number asc, log_index asc
       limit $3`,
      [cursor?.blockNumber.toString() ?? null, cursor?.logIndex ?? null, this.config.limit],
    );
    const events = result.rows.map((row) => this.mapRow(row));
    const last = events.at(-1);
    return { events, nextCursor: last ? { blockNumber: last.blockNumber, logIndex: last.logIndex } : cursor };
  }

  private mapRow(row: Record<string, unknown>): IndexedEvent {
    if (row.kind === "delegation_granted") {
      return {
        kind: "delegation_granted",
        chainId: Number(row.chain_id),
        tokenAddress: row.token_address as `0x${string}`,
        txHash: row.tx_hash as `0x${string}`,
        logIndex: Number(row.log_index),
        blockNumber: BigInt(row.block_number as string),
        blockTimestamp: row.block_timestamp as Date,
        delegator: row.delegator as `0x${string}`,
        delegate: row.delegate as `0x${string}`,
        expiresAt: (row.expires_at as Date | null) ?? null,
      };
    }
    if (row.kind === "delegation_revoked") {
      return {
        kind: "delegation_revoked",
        chainId: Number(row.chain_id),
        tokenAddress: row.token_address as `0x${string}`,
        txHash: row.tx_hash as `0x${string}`,
        logIndex: Number(row.log_index),
        blockNumber: BigInt(row.block_number as string),
        blockTimestamp: row.block_timestamp as Date,
        delegator: row.delegator as `0x${string}`,
        delegate: row.delegate as `0x${string}`,
      };
    }
    return {
      kind: "confidential_transfer",
      chainId: Number(row.chain_id),
      tokenAddress: row.token_address as `0x${string}`,
      txHash: row.tx_hash as `0x${string}`,
      logIndex: Number(row.log_index),
      blockNumber: BigInt(row.block_number as string),
      blockTimestamp: row.block_timestamp as Date,
      from: row.from_address as `0x${string}`,
      to: row.to_address as `0x${string}`,
      encryptedAmount: row.encrypted_amount as `0x${string}`,
    };
  }
}
```

Write `packages/hyperindex-adapter/src/index.ts`:

```ts
export * from "./HyperindexPollingEventSource.js";
```

- [ ] **Step 4: Add Hyperindex app event-decoder note**

Write `apps/hyperindex/src/erc7984-events.ts`:

```ts
import { TOKEN_TOPICS, ACL_TOPICS } from "@zama-fhe/sdk";

export const erc7984Topics = {
  tokenTopics: TOKEN_TOPICS,
  aclTopics: ACL_TOPICS,
};
```

Write `apps/hyperindex/README.md`:

```md
# Hyperindex app

This app owns raw chain indexing. The submission keeps Hyperindex separate from decrypted data. Hyperindex should write normalized rows into a `hyperindex_events` shape consumed by `HyperindexPollingEventSource`:

- `kind`
- `chain_id`
- `token_address`
- `tx_hash`
- `log_index`
- `block_number`
- `block_timestamp`
- transfer fields: `from_address`, `to_address`, `encrypted_amount`
- delegation fields: `delegator`, `delegate`, `expires_at`

The Zama SDK exports event topic constants and decoders for ERC-7984 token and ACL events. The production Hyperindex config should use those constants to select logs and normalize them into this shape.
```

- [ ] **Step 5: Run adapter tests and typecheck**

Run:

```bash
pnpm vitest run packages/hyperindex-adapter/tests/hyperindex-polling-event-source.test.ts
pnpm --filter @confidential-indexer/hyperindex-adapter typecheck
pnpm --filter @confidential-indexer/hyperindex typecheck
```

Expected: PASS.

- [ ] **Step 6: Add DECISIONS note for polling adapter**

Append this section to `DECISIONS.md`:

```md
## Hyperindex handoff through IndexedEventSource

We evaluated three handoff models: sharing Hyperindex's database directly, publishing events to a queue, and polling through a narrow event-source adapter. We chose polling through `IndexedEventSource` for the submission because it keeps Hyperindex isolated as the chain indexing module while avoiding extra broker infrastructure.

The important decision is the seam, not polling itself. The decryption pipeline only asks for batches after a cursor, so Redis Streams, NATS, Kafka, or a Hyperindex webhook can replace the polling adapter without changing the partner API or decryption workflow. The trade-off is a small amount of latency and some coupling to Hyperindex's output shape.
```

- [ ] **Step 7: Commit**

```bash
git add packages/hyperindex-adapter apps/hyperindex DECISIONS.md
git commit -m "feat(hyperindex): consume indexed events through polling seam"
```

---

### Task 8: Wire Real Composition Root and Worker Loop

**Files:**
- Modify: `apps/api/src/main.ts`
- Modify: `apps/api/src/config.ts`
- Modify: `apps/api/src/workers/runOnce.ts`
- Create: `apps/api/src/workers/runLoop.ts`

**Interfaces:**
- Consumes: `HyperindexPollingEventSource`, `ZamaDecryptionProvider`, Postgres repositories, config env.
- Produces: API app that can run with real Postgres, Hyperindex DB output, and Zama adapter factory.

- [ ] **Step 1: Extend config test by running current API tests**

Run:

```bash
pnpm vitest run apps/api/tests/api.test.ts
```

Expected: PASS before changes.

- [ ] **Step 2: Update config for Hyperindex and worker settings**

Replace `apps/api/src/config.ts` with:

```ts
import { z } from "zod";

export const appConfigSchema = z.object({
  databaseUrl: z.string().url(),
  hyperindexDatabaseUrl: z.string().url(),
  adminApiKey: z.string().min(1),
  host: z.string().default("127.0.0.1"),
  port: z.coerce.number().int().default(3000),
  eventSourcePollLimit: z.coerce.number().int().min(1).max(1000).default(100),
  workerIntervalMs: z.coerce.number().int().min(250).default(2000),
});

export type AppConfig = z.infer<typeof appConfigSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return appConfigSchema.parse({
    databaseUrl: env.DATABASE_URL,
    hyperindexDatabaseUrl: env.HYPERINDEX_DATABASE_URL ?? env.DATABASE_URL,
    adminApiKey: env.ADMIN_API_KEY,
    host: env.API_HOST,
    port: env.API_PORT,
    eventSourcePollLimit: env.EVENT_SOURCE_POLL_LIMIT,
    workerIntervalMs: env.WORKER_INTERVAL_MS,
  });
}
```

- [ ] **Step 3: Add worker loop**

Write `apps/api/src/workers/runLoop.ts`:

```ts
import type { ConfidentialIndexer } from "@confidential-indexer/core";
import { runOnce } from "./runOnce.js";

export function runLoop(indexer: ConfidentialIndexer, intervalMs: number): { stop: () => void } {
  let stopped = false;
  let timeout: NodeJS.Timeout | null = null;

  const tick = async () => {
    if (stopped) return;
    try {
      await runOnce(indexer);
    } finally {
      if (!stopped) timeout = setTimeout(tick, intervalMs);
    }
  };

  timeout = setTimeout(tick, 0);

  return {
    stop() {
      stopped = true;
      if (timeout) clearTimeout(timeout);
    },
  };
}
```

- [ ] **Step 4: Wire main to real adapters**

Replace `apps/api/src/main.ts` with:

```ts
import { createConfidentialIndexer } from "@confidential-indexer/core";
import { createPool, PostgresReadModel, PostgresRepositories, runMigrations } from "@confidential-indexer/db";
import { HyperindexPollingEventSource } from "@confidential-indexer/hyperindex-adapter";
import { ZamaDecryptionProvider, type ZamaSdkLike } from "@confidential-indexer/zama";
import { loadConfig } from "./config.js";
import { createServer } from "./http/createServer.js";
import { runLoop } from "./workers/runLoop.js";

const config = loadConfig();
const appPool = createPool(config.databaseUrl);
const hyperindexPool = createPool(config.hyperindexDatabaseUrl);
await runMigrations(appPool);

const repos = new PostgresRepositories(appPool, "hyperindex");
const readModel = new PostgresReadModel(appPool, "hyperindex");
const eventSource = new HyperindexPollingEventSource({ pool: hyperindexPool, limit: config.eventSourcePollLimit });

const decryption = new ZamaDecryptionProvider((_chainId: number): ZamaSdkLike => {
  throw new Error("Zama SDK factory is not configured for this local stub. Configure it before live delegated decryption.");
});

const indexer = createConfidentialIndexer({
  sourceName: "hyperindex",
  eventSource,
  decryption,
  transfers: repos.transfers,
  balances: repos.balances,
  checkpoints: repos.checkpoints,
  attempts: repos.attempts,
});

runLoop(indexer, config.workerIntervalMs);

const app = createServer({ readModel, indexer, adminApiKey: config.adminApiKey });
await app.listen({ host: config.host, port: config.port });
```

- [ ] **Step 5: Run API tests and typecheck**

Run:

```bash
pnpm vitest run apps/api/tests/api.test.ts
pnpm --filter @confidential-indexer/api typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api
git commit -m "feat(api): wire worker loop to event and decryption seams"
```

---

### Task 9: End-to-End Pipeline Test with Fakes

**Files:**
- Create: `apps/api/tests/pipeline.test.ts`
- Modify: `README.md`

**Interfaces:**
- Consumes: API server, core fakes, Postgres repositories.
- Produces: assignment-required happy-path and negative-path tests demonstrating event in to API out.

- [ ] **Step 1: Write pipeline tests**

Write `apps/api/tests/pipeline.test.ts`:

```ts
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createConfidentialIndexer, FakeDecryptionProvider, FakeIndexedEventSource, type IndexedEvent } from "@confidential-indexer/core";
import { createPool, PostgresReadModel, PostgresRepositories, runMigrations } from "@confidential-indexer/db";
import { createServer } from "../src/http/createServer.js";

const databaseUrl = process.env.DATABASE_URL ?? "postgres://indexer:indexer@localhost:5432/confidential_indexer";

function transfer(encryptedAmount: `0x${string}`): IndexedEvent {
  return {
    kind: "confidential_transfer",
    chainId: 31337,
    tokenAddress: "0x0000000000000000000000000000000000000001",
    txHash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    logIndex: 0,
    blockNumber: 1n,
    blockTimestamp: new Date("2026-06-29T00:00:00.000Z"),
    from: "0x00000000000000000000000000000000000000aa",
    to: "0x00000000000000000000000000000000000000bb",
    encryptedAmount,
  };
}

async function createHarness(events: IndexedEvent[], configureDecryption: (provider: FakeDecryptionProvider) => void) {
  const pool = createPool(databaseUrl);
  const schema = `pipeline_${randomUUID().replaceAll("-", "")}`;
  await pool.query(`create schema ${schema}`);
  await pool.query(`set search_path to ${schema}, public`);
  await runMigrations(pool);

  const repos = new PostgresRepositories(pool, "hyperindex");
  const readModel = new PostgresReadModel(pool, "hyperindex");
  const provider = new FakeDecryptionProvider();
  configureDecryption(provider);
  const indexer = createConfidentialIndexer({ sourceName: "hyperindex", eventSource: new FakeIndexedEventSource(events), decryption: provider, transfers: repos.transfers, balances: repos.balances, checkpoints: repos.checkpoints, attempts: repos.attempts });
  const app = createServer({ readModel, indexer, adminApiKey: "secret" });
  return { pool, app, indexer };
}

describe("fake end-to-end pipeline", () => {
  it("happy path: event in produces cleartext transfer and balance out", async () => {
    const encryptedAmount = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    const { pool, app, indexer } = await createHarness([transfer(encryptedAmount)], (provider) => provider.setAmount(encryptedAmount, 25n));

    await indexer.ingestNextBatch();
    await indexer.processPendingDecryptions(10);

    const transfers = await app.inject({ method: "GET", url: "/v1/transfers/0x00000000000000000000000000000000000000bb" });
    const balances = await app.inject({ method: "GET", url: "/v1/balances/0x00000000000000000000000000000000000000bb" });

    expect(transfers.json().items[0]).toMatchObject({ amount: "25", decryptionStatus: "decrypted" });
    expect(balances.json().items[0]).toMatchObject({ balance: "25", balanceSource: "events" });

    await pool.end();
  });

  it("negative path: undecryptable event stays visible with null amount", async () => {
    const encryptedAmount = "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";
    const { pool, app, indexer } = await createHarness([transfer(encryptedAmount)], (provider) => provider.failWith({ status: "not_delegated", reason: "missing_delegation" }));

    await indexer.ingestNextBatch();
    await indexer.processPendingDecryptions(10);

    const transfers = await app.inject({ method: "GET", url: "/v1/transfers/0x00000000000000000000000000000000000000bb" });

    expect(transfers.json().items[0]).toMatchObject({ amount: null, decryptionStatus: "not_delegated", decryptionReason: "missing_delegation" });

    await pool.end();
  });
});
```

- [ ] **Step 2: Run pipeline tests**

Run:

```bash
pnpm dev:db
pnpm vitest run apps/api/tests/pipeline.test.ts
```

Expected: PASS.

- [ ] **Step 3: Update README test instructions**

Append to `README.md`:

```md
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
```

- [ ] **Step 4: Run all tests**

Run:

```bash
pnpm dev:db
pnpm test
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/tests README.md
git commit -m "test(api): prove fake end-to-end indexing pipeline"
```

---

### Task 10: Dockerized Dev and Prod-Like Compose Flows

**Files:**
- Create: `Dockerfile`
- Create: `.dockerignore`
- Create: `compose.dev.yaml`
- Modify: `compose.yaml`
- Modify: `package.json`
- Modify: `.env.example`

**Interfaces:**
- Consumes: API app from Task 8, Postgres schema from Task 3, workspace scripts from Task 1.
- Produces: `docker compose -f compose.dev.yaml up --build` for development and `docker compose up --build` for prod-like local/demo startup.

- [ ] **Step 1: Write `.dockerignore`**

Write `.dockerignore`:

```dockerignore
.git
node_modules
**/node_modules
**/dist
.pnpm-store
.env
.env.*
!.env.example
coverage
.DS_Store
docs/superpowers/plans
```

- [ ] **Step 2: Add Docker scripts to root package**

Modify root `package.json` scripts so the `scripts` object is exactly:

```json
{
  "build": "turbo build",
  "dev:db": "docker compose -f compose.dev.yaml up -d postgres",
  "docker:dev": "docker compose -f compose.dev.yaml up --build",
  "docker:prod": "docker compose up --build",
  "format:check": "oxfmt --check .",
  "lint": "oxlint .",
  "test": "vitest run",
  "typecheck": "turbo typecheck"
}
```

- [ ] **Step 3: Create multi-stage Dockerfile**

Write `Dockerfile`:

```Dockerfile
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
```

- [ ] **Step 4: Replace prod-like `compose.yaml`**

Replace `compose.yaml` with:

```yaml
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: indexer
      POSTGRES_PASSWORD: indexer
      POSTGRES_DB: confidential_indexer
    volumes:
      - postgres-data:/var/lib/postgresql/data
    ports:
      - "5432:5432"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U indexer -d confidential_indexer"]
      interval: 2s
      timeout: 2s
      retries: 20

  api:
    build:
      context: .
      target: api
    env_file:
      - .env
    environment:
      DATABASE_URL: postgres://indexer:indexer@postgres:5432/confidential_indexer
      HYPERINDEX_DATABASE_URL: postgres://indexer:indexer@postgres:5432/confidential_indexer
      API_HOST: 0.0.0.0
      API_PORT: 3000
    ports:
      - "3000:3000"
    depends_on:
      postgres:
        condition: service_healthy
    restart: unless-stopped

volumes:
  postgres-data:
```

- [ ] **Step 5: Create development compose file**

Write `compose.dev.yaml`:

```yaml
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: indexer
      POSTGRES_PASSWORD: indexer
      POSTGRES_DB: confidential_indexer
    volumes:
      - postgres-dev-data:/var/lib/postgresql/data
    ports:
      - "5432:5432"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U indexer -d confidential_indexer"]
      interval: 2s
      timeout: 2s
      retries: 20

  api:
    image: node:22-alpine
    working_dir: /app
    command: sh -lc "corepack enable && pnpm install && pnpm --filter @confidential-indexer/api dev"
    env_file:
      - .env
    environment:
      DATABASE_URL: postgres://indexer:indexer@postgres:5432/confidential_indexer
      HYPERINDEX_DATABASE_URL: postgres://indexer:indexer@postgres:5432/confidential_indexer
      API_HOST: 0.0.0.0
      API_PORT: 3000
    volumes:
      - .:/app
      - pnpm-store:/pnpm
      - node-modules:/app/node_modules
    ports:
      - "3000:3000"
    depends_on:
      postgres:
        condition: service_healthy

volumes:
  postgres-dev-data:
  pnpm-store:
  node-modules:
```

- [ ] **Step 6: Update `.env.example` for Docker**

Replace `.env.example` with:

```bash
DATABASE_URL=postgres://indexer:indexer@localhost:5432/confidential_indexer
HYPERINDEX_DATABASE_URL=postgres://indexer:indexer@localhost:5432/confidential_indexer
ADMIN_API_KEY=replace-with-local-dev-key
API_HOST=127.0.0.1
API_PORT=3000
EVENT_SOURCE_POLL_LIMIT=100
WORKER_INTERVAL_MS=2000
INDEXER_SIGNER_PRIVATE_KEY_31337=0x0000000000000000000000000000000000000000000000000000000000000000
NETWORKS_JSON=[{"chainId":31337,"name":"anvil","rpcUrl":"http://127.0.0.1:8545","relayerUrl":"http://127.0.0.1:8546","indexerSignerPrivateKeyEnv":"INDEXER_SIGNER_PRIVATE_KEY_31337","tokens":[{"address":"0x0000000000000000000000000000000000000001","startBlock":0}]}]
```

- [ ] **Step 7: Verify Docker dev flow**

Run:

```bash
cp .env.example .env
docker compose -f compose.dev.yaml up --build -d
curl --fail http://127.0.0.1:3000/v1/health
docker compose -f compose.dev.yaml down
```

Expected: `curl` returns JSON with `"ok":true` and compose shuts down cleanly.

- [ ] **Step 8: Verify Docker prod-like flow**

Run:

```bash
docker compose up --build -d
curl --fail http://127.0.0.1:3000/v1/health
docker compose down
```

Expected: `curl` returns JSON with `"ok":true` and compose shuts down cleanly.

- [ ] **Step 9: Add DECISIONS note for Docker scope**

Append this section to `DECISIONS.md`:

```md
## Dockerized dev and prod-like local flows

We evaluated only documenting local `pnpm` commands versus making Docker Compose the primary startup path. We chose Docker Compose for both development and prod-like local/demo because the submission should be runnable from a fresh clone with minimal host setup beyond Docker and pnpm. `compose.dev.yaml` favors fast iteration with bind mounts and `tsx`; `compose.yaml` builds an optimized API image and uses healthchecks for service ordering.

This is prod-like, not production infrastructure. TLS termination, reverse proxy configuration, managed secrets, backups, and deployment-specific hardening are intentionally outside this submission.
```

- [ ] **Step 10: Commit**

```bash
git add Dockerfile .dockerignore compose.yaml compose.dev.yaml package.json .env.example DECISIONS.md
git commit -m "chore(docker): add dev and prod compose flows"
```

---

### Task 11: GitHub Actions PR Validation

**Files:**
- Create: `.github/workflows/ci.yml`
- Modify: `README.md`

**Interfaces:**
- Consumes: workspace scripts, Dockerfile, Compose files, Postgres-backed tests.
- Produces: pull request workflow that runs lint, format check, typecheck, tests with Postgres, and Docker build validation.

- [ ] **Step 1: Create CI workflow**

Write `.github/workflows/ci.yml`:

```yaml
name: CI

on:
  pull_request:
  push:
    branches:
      - main

permissions:
  contents: read

concurrency:
  group: ci-${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

jobs:
  quality:
    name: Quality checks
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - name: Checkout
        uses: actions/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5 # v4

      - name: Setup pnpm
        uses: pnpm/action-setup@f40ffcd9367d9f12939873eb1018b921a783ffaa # v4
        with:
          version: 9.15.4

      - name: Setup Node
        uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020 # v4
        with:
          node-version: 22
          cache: pnpm

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Lint
        run: pnpm lint

      - name: Format check
        run: pnpm format:check

      - name: Typecheck
        run: pnpm typecheck

  test:
    name: Tests
    runs-on: ubuntu-latest
    timeout-minutes: 15
    services:
      postgres:
        image: postgres:16-alpine
        env:
          POSTGRES_USER: indexer
          POSTGRES_PASSWORD: indexer
          POSTGRES_DB: confidential_indexer
        ports:
          - 5432:5432
        options: >-
          --health-cmd "pg_isready -U indexer -d confidential_indexer"
          --health-interval 2s
          --health-timeout 2s
          --health-retries 20
    env:
      DATABASE_URL: postgres://indexer:indexer@localhost:5432/confidential_indexer
      HYPERINDEX_DATABASE_URL: postgres://indexer:indexer@localhost:5432/confidential_indexer
      ADMIN_API_KEY: ci-admin-key
      API_HOST: 127.0.0.1
      API_PORT: 3000
    steps:
      - name: Checkout
        uses: actions/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5 # v4

      - name: Setup pnpm
        uses: pnpm/action-setup@f40ffcd9367d9f12939873eb1018b921a783ffaa # v4
        with:
          version: 9.15.4

      - name: Setup Node
        uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020 # v4
        with:
          node-version: 22
          cache: pnpm

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Run tests
        run: pnpm test

  docker:
    name: Docker build
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - name: Checkout
        uses: actions/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5 # v4

      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@8d2750c68a42422c14e847fe6c8ac0403b4cbd6f # v3

      - name: Build API image
        run: docker build --target api -t confidential-indexer-api:ci .
```

- [ ] **Step 2: Validate workflow syntax locally**

Run:

```bash
actionlint .github/workflows/ci.yml
```

Expected: PASS. If `actionlint` is not installed, run:

```bash
docker run --rm -v "$PWD:/repo" -w /repo rhysd/actionlint:1.7.7 .github/workflows/ci.yml
```

Expected: PASS.

- [ ] **Step 3: Run the same checks locally**

Run:

```bash
pnpm lint
pnpm format:check
pnpm typecheck
pnpm dev:db
pnpm test
docker build --target api -t confidential-indexer-api:ci .
```

Expected: all commands pass.

- [ ] **Step 4: Update README with CI note**

Append to `README.md`:

```md
## Pull request validation

GitHub Actions runs on pull requests and pushes to `main`. CI validates linting, formatting, typechecking, Postgres-backed tests, and Docker image buildability. Third-party actions are pinned to full commit SHAs for immutable workflow execution.
```

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/ci.yml README.md
git commit -m "ci: validate pull requests"
```

---

### Task 12: Decisions, Final README, and Verification

**Files:**
- Create or modify: `DECISIONS.md`
- Modify: `README.md`
- Modify: `.env.example`

**Interfaces:**
- Consumes: all implemented modules and tests.
- Produces: copy-pasteable setup/run/test docs and assignment-required reflection.

- [ ] **Step 1: Write `DECISIONS.md`**

Write `DECISIONS.md`:

```md
# Decisions

## Hyperindex instead of a custom EVM indexer

We evaluated writing a small log poller, using a general EVM library directly, and using Hyperindex. We chose Hyperindex because the assignment explicitly asks us to compose an off-the-shelf indexing library rather than spend time rebuilding indexing mechanics. The trade-off is accepting Hyperindex's configuration and output model, which we isolate behind `IndexedEventSource`.

## Hyperindex separate from decrypted data

We evaluated putting decrypted fields into Hyperindex-owned storage versus keeping a separate Decryption/API read model. We chose separation because encrypted chain facts and partner-facing cleartext state have different ownership, retry, and privacy concerns. Hyperindex remains the chain indexing module; Postgres stores decrypted amounts, balances, attempts, and checkpoints owned by this service.

## Postgres for the read model

We evaluated SQLite, document storage, and Postgres. We chose Postgres because the read model needs idempotent event upserts, stable pagination, balance projections, attempt history, and operationally familiar querying. SQLite would be simpler for a local demo, but weaker as a signal for a multi-network partner indexer.

## Polling through IndexedEventSource

We evaluated direct DB coupling, a queue/event bus, and cursor-based polling. We chose polling for the submission because it avoids extra infrastructure while preserving the important seam. The decryption pipeline only depends on `nextBatch(cursor)`, so a future Redis Streams, NATS, Kafka, or webhook adapter can replace polling without changing the API or decryption workflow.

## Delegated decryption as the supported model

A backend indexer normally is not the sender or receiver in wallet-user transfers, so it cannot assume direct decryption rights. We chose delegated decryption as the explicit product model: holders grant the Indexer Signer rights for each confidential token contract. Events without rights are stored as pending rather than dropped.

## Current balance versus history completeness

We separate current balance correctness from transfer-history completeness. After delegation, `decryptBalanceAs` can refresh the current balance even when historical event amounts are still pending. The API exposes `balanceSource` and `historyCompleteness` so the wallet partner can show honest state.

## Deterministic tests instead of live-chain CI

We evaluated requiring local fhEVM/Anvil in tests versus fake `IndexedEventSource` and `DecryptionProvider`. We chose fakes for automated tests because they prove our service pipeline without relying on relayer timing or delegation propagation. The live chain path belongs in the README/demo flow.

## Dockerized dev and prod-like local flows

We evaluated only documenting local `pnpm` commands versus making Docker Compose the primary startup path. We chose Docker Compose for both development and prod-like local/demo because the submission should be runnable from a fresh clone with minimal host setup beyond Docker and pnpm. `compose.dev.yaml` favors fast iteration with bind mounts and `tsx`; `compose.yaml` builds an optimized API image and uses healthchecks for service ordering.

This is prod-like, not production infrastructure. TLS termination, reverse proxy configuration, managed secrets, backups, and deployment-specific hardening are intentionally outside this submission.

## GitHub Actions for pull request validation

We chose GitHub Actions because the submission is delivered as a Git repository and PR validation should be visible to reviewers. CI runs independent quality, test, and Docker build jobs so formatting or type errors fail fast while Postgres-backed tests and image buildability are still checked. Third-party actions are pinned to full commit SHAs to avoid mutable action tags.

## Least confident under partner load

The polling and decryption worker would break first under high event volume. It currently processes simple batches and serial decryption attempts. I would prove the limit with a load test that inserts thousands of Hyperindex rows, measures lag and retry growth, and compares serial processing against bounded-concurrency decryption.

## What was cut

I cut dynamic token registration, a production queue, advanced rate limiting, and a mandatory Sepolia test. With another four hours I would first replace the polling adapter with a durable queue or add bounded-concurrency decryption with per-chain rate limits, depending on observed bottlenecks.

## SDK feedback

1. Delegated backend examples should include a complete Node service example using `@zama-fhe/sdk/node`, a persistent signer, and `delegatedDecryptValues`. This unblocks wallet partners building server-side indexers. Priority: high.
2. Delegation propagation errors should have a stable error code that distinguishes missing delegation from recently propagated ACL state. This unblocks reliable retry policy. Priority: high.
3. Event-decoder docs should show how ERC-7984 event handles relate to decryptable values and contract addresses. This unblocks indexer authors who start from logs rather than token helper methods. Priority: medium.

## AI assistance

AI assistance was used to explore the design, inspect SDK type definitions, and draft the module plan. One subtle mistake corrected during design was the assumption that decryption required a key per token contract. The SDK model is signer and delegation based: rights are granted by delegator, delegate, and contract address.
```

- [ ] **Step 2: Expand README run instructions**

Replace `README.md` with:

```md
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

## Live network notes

The design supports local fhEVM/Anvil first and Sepolia through static configuration. Real delegated decryption requires a configured Indexer Signer for the network and holder delegations for the relevant ERC-7984 token contracts.

## Project layout

- `apps/hyperindex`: chain indexing configuration and event capture.
- `apps/api`: decryption workers and HTTP API.
- `packages/core`: domain interfaces and orchestration.
- `packages/db`: Postgres schema and read-model adapters.
- `packages/zama`: Zama SDK adapter.
- `packages/hyperindex-adapter`: adapter from Hyperindex output to normalized events.
```

- [ ] **Step 3: Run final verification**

Run:

```bash
pnpm dev:db
pnpm test
pnpm typecheck
pnpm lint
pnpm format:check
actionlint .github/workflows/ci.yml
cp .env.example .env
docker compose -f compose.dev.yaml up --build -d
curl --fail http://127.0.0.1:3000/v1/health
docker compose -f compose.dev.yaml down
docker compose up --build -d
curl --fail http://127.0.0.1:3000/v1/health
docker compose down
```

Expected: all commands pass, and both Docker health checks return JSON containing `"ok":true`.

- [ ] **Step 4: Commit**

```bash
git add DECISIONS.md README.md .env.example
git commit -m "docs: document confidential indexer decisions and usage"
```

---

## Self-Review

### Spec coverage

- Hyperindex off-the-shelf indexing: Task 7 creates Hyperindex app stub and polling adapter.
- Separate Postgres read model: Task 3 creates schema and repositories.
- Delegated decryption primary model: Task 6 creates `ZamaDecryptionProvider`; Task 12 documents decision.
- Pending encrypted events preserved: Task 3 stores nullable amount and statuses; Task 4 tests negative path.
- Partner API: Task 5 exposes balances, transfers, health, and admin backfill.
- Deterministic tests: Task 2, Task 4, Task 5, and Task 9 use fakes and API injection.
- DECISIONS.md: Task 12 writes decisions, reflection, cuts, SDK feedback, and AI assistance; Task 10 adds Docker scope notes.
- pnpm/turbo/oxlint/oxfmt monorepo: Task 1.
- Dockerized dev and prod-like local flows: Task 10 creates Dockerfile, compose files, and verification commands.
- GitHub Actions PR validation: Task 11 creates pinned-action CI for quality checks, tests, and Docker build.
- Deep module seams: Tasks 2, 4, 5, 6, and 7 implement `IndexedEventSource`, `DecryptionProvider`, `ConfidentialIndexer`, and `ReadModel`.

### Placeholder scan

The plan contains no unresolved markers or vague implementation instructions. Each task has exact files, commands, expected results, and code blocks for code-writing steps.

### Type consistency

The plan consistently uses `IndexedEventSource.nextBatch`, `DecryptionProvider.decryptTransferAmount`, `DecryptionProvider.refreshCurrentBalance`, `createConfidentialIndexer`, and `ReadModel` signatures defined in Task 2 and Task 4.
