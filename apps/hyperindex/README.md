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
