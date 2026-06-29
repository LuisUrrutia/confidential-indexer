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
