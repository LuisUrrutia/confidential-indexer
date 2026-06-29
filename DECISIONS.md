## Zama SDK behind DecryptionProvider

We evaluated calling `@zama-fhe/sdk` directly from the indexing workflow versus hiding it behind `DecryptionProvider`. We chose the adapter because delegated decryption has several details that should not leak into the rest of the service: per-network signer setup, permit/session storage, gateway propagation delays, and SDK error taxonomy.

The trade-off is an extra module that initially has only one production adapter. It still earns its place because tests use `FakeDecryptionProvider`, and because SDK alpha APIs may change while the domain workflow and partner API should remain stable.

## Hyperindex handoff through IndexedEventSource

We evaluated three handoff models: sharing Hyperindex's database directly, publishing events to a queue, and polling through a narrow event-source adapter. We chose polling through `IndexedEventSource` for the submission because it keeps Hyperindex isolated as the chain indexing module while avoiding extra broker infrastructure.

The important decision is the seam, not polling itself. The decryption pipeline only asks for batches after a cursor, so Redis Streams, NATS, Kafka, or a Hyperindex webhook can replace the polling adapter without changing the partner API or decryption workflow. The trade-off is a small amount of latency and some coupling to Hyperindex's output shape.

## Dockerized dev and prod-like local flows

We evaluated only documenting local `pnpm` commands versus making Docker Compose the primary startup path. We chose Docker Compose for both development and prod-like local/demo because the submission should be runnable from a fresh clone with minimal host setup beyond Docker and pnpm. `compose.dev.yaml` favors fast iteration with bind mounts and `tsx`; `compose.yaml` builds an optimized API image and uses healthchecks for service ordering.

This is prod-like, not production infrastructure. TLS termination, reverse proxy configuration, managed secrets, backups, and deployment-specific hardening are intentionally outside this submission.
