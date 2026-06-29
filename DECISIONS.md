## Zama SDK behind DecryptionProvider

We evaluated calling `@zama-fhe/sdk` directly from the indexing workflow versus hiding it behind `DecryptionProvider`. We chose the adapter because delegated decryption has several details that should not leak into the rest of the service: per-network signer setup, permit/session storage, gateway propagation delays, and SDK error taxonomy.

The trade-off is an extra module that initially has only one production adapter. It still earns its place because tests use `FakeDecryptionProvider`, and because SDK alpha APIs may change while the domain workflow and partner API should remain stable.
