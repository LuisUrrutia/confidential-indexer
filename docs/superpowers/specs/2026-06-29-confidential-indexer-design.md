# Confidential ERC-7984 Indexer Design

## Context

The project is a TypeScript Node take-home submission for a confidential ERC-7984 token indexer. A wallet partner wants ERC-20-style read APIs for confidential token balances and transfer history without learning FHE details. The service must use an existing indexer, integrate `@zama-fhe/sdk@alpha`, persist cleartext where authorized, expose partner-friendly HTTP endpoints, include light tests, and explain trade-offs in `DECISIONS.md`.

The repository currently starts from `IDEA.md`. The implementation will be a TypeScript monorepo using `pnpm`, `turbo`, `oxlint`, and `oxfmt`.

## Goals

- Index many configured ERC-7984 token contracts across many configured networks.
- Use Hyperindex as the chain indexing layer instead of building an EVM indexer from scratch.
- Keep decrypted/read-model data outside Hyperindex in a separate Postgres database.
- Support delegated decryption as the primary access model.
- Preserve events that cannot yet be decrypted, so later delegation can backfill cleartext.
- Expose clear API responses that distinguish known cleartext data from pending or incomplete FHE state.
- Provide fast, deterministic tests with fake event and decryption providers.
- Document decisions, alternatives, cuts, and SDK feedback in `DECISIONS.md`.

## Non-goals

- Dynamic network or token registration through an admin API.
- A production queue/event-bus handoff in the first submission.
- A full Sepolia integration test as a required automated test.
- Writing a custom blockchain indexer.
- Hiding FHE uncertainty behind misleading ERC-20-style responses.

## Architecture

The system has two logical services.

### Hyperindex service

Hyperindex owns raw chain indexing. It is statically configured at startup for supported networks and token contracts. It watches ERC-7984 confidential token events such as confidential transfers, shield/wrap activity, unshield/unwrap activity, and ACL delegation events where practical.

Hyperindex does not own decrypted data. Its output is treated as indexed chain facts.

### Decryption/API service

The decryption/API service consumes Hyperindex output through an `IndexedEventSource` interface. The initial implementation uses cursor-based polling, but the rest of the service depends only on the interface so a queue, webhook, or event bus can replace polling later.

The service uses one configured indexer signer per network. That signer is the delegated decryptor identity. Users or holders grant decryption rights to that address for each confidential token contract they want the partner to index in cleartext.

The service stores its own read model in Postgres and exposes HTTP endpoints for balances, transfer history, health, and admin backfill.

```text
Chain -> Hyperindex -> IndexedEventSource -> Decryption pipeline -> Postgres -> HTTP API
```

## Monorepo structure

Planned packages and apps:

- `apps/hyperindex`: Hyperindex configuration and handlers for configured networks/tokens.
- `apps/api`: HTTP API and background workers.
- `packages/core`: domain types, status enums, and interfaces.
- `packages/db`: Postgres schema, migrations, and repository implementations.
- `packages/zama`: adapter around `@zama-fhe/sdk@alpha`.

The repo uses `pnpm` workspaces, `turbo` for task orchestration, and `oxlint`/`oxfmt` for linting and formatting.

## Codebase module design

The codebase should favor deep modules: small interfaces that hide large implementation detail. The API app is the composition root; business behavior lives in core modules and is exercised through the same interfaces used in production.

### `IndexedEventSource`

This seam hides Hyperindex output and handoff mechanics.

```ts
interface IndexedEventSource {
  nextBatch(cursor: EventCursor | null): Promise<IndexedEventBatch>;
}
```

Its interface promise is: return normalized confidential-token and ACL events after the supplied cursor. Callers should not know whether the adapter polls a Hyperindex database, calls GraphQL, reads files, receives webhooks, or consumes a future queue.

Adapters:

- `HyperindexPollingEventSource` for the submission.
- `FakeIndexedEventSource` for deterministic tests.

Cursoring, pagination, dedupe ordering, Hyperindex schema quirks, and event normalization belong behind this interface.

### `DecryptionProvider`

This seam hides Zama SDK complexity.

```ts
interface DecryptionProvider {
  decryptTransferAmount(input: DecryptTransferAmountInput): Promise<DecryptAmountResult>;
  refreshCurrentBalance(input: RefreshBalanceInput): Promise<RefreshBalanceResult>;
}
```

Its interface promise is: given a holder, token, network, and encrypted amount or balance target, return either cleartext or a domain-level failure. It should hide SDK instance construction, per-network signers, `delegatedDecryptValues`, `decryptBalanceAs`, permit/session storage, delegation propagation errors, and raw SDK error taxonomy.

Adapters:

- `ZamaDecryptionProvider` for production.
- `FakeDecryptionProvider` for tests.

The rest of the codebase should not call SDK-shaped methods such as `delegatedDecryptValues` directly.

### `ConfidentialIndexer`

This is the orchestration module for ingestion, decryption, and backfill.

```ts
interface ConfidentialIndexer {
  ingestNextBatch(): Promise<IngestionReport>;
  processPendingDecryptions(limit?: number): Promise<DecryptionReport>;
  backfillHolder(input: BackfillHolderInput): Promise<BackfillReport>;
}
```

It coordinates `IndexedEventSource`, repositories, and `DecryptionProvider`. It should not know Postgres SQL details or Zama SDK details. This is the main test surface for the happy-path and negative-path pipeline tests.

### `ReadModel`

This seam hides query and repository complexity from HTTP handlers.

```ts
interface ReadModel {
  getBalances(query: BalanceQuery): Promise<BalancePage>;
  getTransfers(query: TransferQuery): Promise<TransferPage>;
  getHealth(): Promise<HealthSnapshot>;
}
```

HTTP handlers should only parse requests, call `ReadModel`, and serialize responses. They should not join tables or inspect raw decryption attempts.

### Package responsibility

```text
apps/api                  composition root, HTTP, worker startup
apps/hyperindex           Hyperindex configuration and handlers
packages/core             domain types, interfaces, and workflow modules
packages/db               Postgres schema, repositories, read-model adapter
packages/zama             ZamaDecryptionProvider adapter
packages/hyperindex-adapter HyperindexPollingEventSource adapter
```

This structure keeps adapters replaceable without making every internal helper a public seam.

## Configuration model

Configuration is static at startup. A representative shape is:

```yaml
networks:
  - chainId: 31337
    name: anvil
    rpcUrl: http://127.0.0.1:8545
    relayerUrl: http://127.0.0.1:...
    indexerSignerPrivateKey: ${INDEXER_SIGNER_PRIVATE_KEY_31337}
    tokens:
      - address: 0x...
        startBlock: 0
```

The token contract is the monitored target. It is not a decryption key. Decryption is performed by the configured network signer when the relevant holder has delegated rights to that signer for the token contract.

## Decryption model

Delegated decryption is the primary supported model.

The alpha SDK exposes useful backend primitives:

- `@zama-fhe/sdk/node` with the `node()` relayer transport for Node.js.
- `sdk.delegations.isActive({ contractAddress, delegatorAddress, delegateAddress })`.
- `sdk.decryption.delegatedDecryptValues(encryptedInputs, delegatorAddress)`.
- `sdk.decryption.delegatedBatchDecryptValues(...)`.
- Token helpers such as `token.decryptBalanceAs({ delegatorAddress })`.
- Event helpers such as `decodeConfidentialTransfer`, wrap/unwrap decoders, and ACL delegation decoders.

Delegation is modeled as `delegator + delegate + contractAddress`. The configured indexer signer is the delegate. The holder is the delegator. Delegation can take 1-2 minutes to propagate to the gateway after the ACL transaction is mined, so recent delegation failures are retryable.

Direct decryption by the indexer as a transfer participant is not the product focus. The backend indexer normally is not the sender or receiver of wallet-user transfers. The design can leave room for a future direct-decrypt path, but the submission will be explicit that delegated decryption is the supported partner model.

## Data model

Postgres stores the decryption service read model. Core tables should include:

- `networks`: configured network snapshots.
- `tokens`: configured token snapshots.
- `indexed_events` or `transfers`: one row per chain event, idempotently keyed by `chain_id`, `tx_hash`, and `log_index`.
- `balances`: current cleartext balance projection per `chain_id`, `token_address`, and `holder`.
- `delegations`: observed delegation state per `chain_id`, `token_address`, `delegator`, and `delegate`.
- `decryption_attempts`: attempt history, errors, and retry metadata.
- `event_checkpoints`: cursor/checkpoint state for each event source.

Transfer rows store encrypted values immediately. Cleartext amount is nullable.

Important statuses:

- `decrypted`: cleartext amount is known.
- `pending`: stored but waiting for delegation, propagation, or retry.
- `not_delegated`: checked and no active delegation exists.
- `retryable_error`: SDK, relayer, propagation, or gateway issue worth retrying.
- `failed`: terminal or repeated failure after a threshold.

Balance metadata distinguishes:

- `balanceStatus`: `known` or `unknown`.
- `balanceSource`: `events`, `direct_decrypt`, or `none`.
- `historyCompleteness`: `complete`, `partial`, or `unknown`.

## Event ingestion flow

The API service runs a worker loop:

1. Read the current checkpoint.
2. Call `IndexedEventSource.nextBatch(checkpoint)`.
3. Normalize events from Hyperindex into domain events.
4. Upsert each event by `chain_id + token_address + tx_hash + log_index`.
5. Store encrypted amount handles immediately.
6. Advance the checkpoint only after successful persistence.

Polling is intentionally hidden behind `IndexedEventSource`. The take-home implementation can poll Hyperindex output. A production version can replace the adapter with Redis Streams, NATS, Kafka, or a Hyperindex webhook without changing decryption or API code.

## Decryption and backfill flow

For each pending encrypted event, the worker determines the relevant holder/delegator candidates from the event participants and token context. It checks whether the configured indexer signer has active delegation for the token.

If active or recently observed delegation exists, the service calls the Zama adapter. For transfer amounts, the adapter uses delegated decryption. On success:

- the transfer row is updated with cleartext amount;
- `decryptionStatus` becomes `decrypted`;
- a decryption attempt is recorded;
- materialized balances are updated from the transfer direction.

On failure:

- the transfer remains queryable;
- `amount` remains `null`;
- status and reason are updated;
- retry metadata is stored.

When a delegation event is observed, or when an admin requests backfill, the service also refreshes the current balance with `token.decryptBalanceAs({ delegatorAddress })`. This can make the current balance correct even while historical transfer amounts remain partially decrypted. The API surfaces this distinction instead of pretending history is complete.

## HTTP API

The public API is versioned under `/v1`.

### `GET /v1/balances/:holder`

Returns balances for the holder across configured tokens and networks. Query filters may include `chainId` and `tokenAddress`.

Example item:

```json
{
  "chainId": 31337,
  "tokenAddress": "0x...",
  "holder": "0x...",
  "balance": "150",
  "balanceStatus": "known",
  "balanceSource": "direct_decrypt",
  "historyCompleteness": "partial",
  "updatedAt": "2026-06-29T00:00:00.000Z"
}
```

### `GET /v1/transfers/:holder`

Returns paginated transfer history for the holder. Query filters may include `chainId`, `tokenAddress`, and `decryptionStatus`.

Pending amount example:

```json
{
  "chainId": 31337,
  "tokenAddress": "0x...",
  "txHash": "0x...",
  "logIndex": 2,
  "from": "0xAlice",
  "to": "0xBob",
  "amount": null,
  "encryptedAmount": "0x...",
  "decryptionStatus": "pending",
  "decryptionReason": "missing_delegation",
  "blockNumber": "123",
  "timestamp": "2026-06-29T00:00:00.000Z"
}
```

Decrypted amount example:

```json
{
  "amount": "25",
  "decryptionStatus": "decrypted",
  "decryptionReason": null
}
```

### `GET /v1/health`

Reports service health, configured networks/tokens, database connectivity, worker status, latest checkpoints, and estimated lag.

### `POST /admin/backfill`

API-key protected. Triggers retry/backfill for a `chainId + tokenAddress + holder` tuple. This supports demos, manual recovery, and late delegation testing without adding a full admin product.

## Error handling

The API should not silently drop or hide encrypted records. Any indexed event that cannot be decrypted is still returned with `amount: null`, `encryptedAmount`, `decryptionStatus`, and `decryptionReason`.

SDK errors are mapped into partner-facing categories:

- missing or inactive delegation -> `not_delegated`;
- recent delegation propagation -> `pending` or `retryable_error` with retry metadata;
- relayer/gateway/network transient failure -> `retryable_error`;
- malformed event, unsupported token, or repeated unrecoverable error -> `failed`.

Internal error details are recorded in `decryption_attempts`; public API responses should avoid leaking secrets or noisy stack traces.

## Testing strategy

Automated tests prioritize deterministic service behavior over live chain complexity.

Happy-path test:

```text
fake indexed transfer event -> fake delegated decrypt succeeds -> API returns cleartext transfer and updated balance
```

Negative test:

```text
fake indexed transfer event -> no delegation or fake decrypt failure -> API returns amount=null with explicit decryption status/reason
```

The fake implementations exercise the same interfaces as production:

- `IndexedEventSource` fake provides normalized events.
- `DecryptionProvider` fake returns cleartext or typed failures.
- Repositories run against a test database where practical.

The README should separately document a local fhEVM/anvil demo path. Sepolia is supported by configuration but should not block fast local verification.

## Decisions to document in `DECISIONS.md`

`DECISIONS.md` must explain choices, alternatives, evaluation criteria, trade-offs, and future changes. Required sections include:

- Hyperindex instead of a custom EVM indexer.
- Hyperindex as a separate service instead of mixing decrypted state into its DB.
- Postgres for the decryption/read-model database.
- Polling through `IndexedEventSource` instead of direct DB coupling or a production queue.
- Delegated decryption as the explicit supported model.
- Local fhEVM/anvil as the primary demo path with Sepolia config support.
- Deterministic fake-provider tests instead of requiring a live chain in CI.
- What was cut and what would be done with another four hours.
- The least-confident component under partner load and how to prove or improve it.
- Specific feedback on `@zama-fhe/sdk@alpha` after implementation.
- AI assistance process and at least one AI-generated mistake corrected during development.

## Open implementation risks

- Hyperindex output shape may require an adapter that differs from the initial assumption.
- Zama SDK delegated decryption may require careful permit/session storage for backend signers.
- Delegation propagation timing may make tests against live networks flaky.
- Balance materialization from partially decrypted history must avoid overstating completeness.
- Polling latency and batch size must be tuned if event volume is higher than expected.

These risks are manageable because they are isolated behind `IndexedEventSource`, `DecryptionProvider`, repositories, and explicit API metadata.
