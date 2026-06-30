# Hyperindex app

This app owns raw chain indexing. The production path is an Envio HyperIndex project:

- `config.yaml` declares the ERC-7984 token contract and ACL contract.
- `schema.graphql` defines the normalized `HyperindexEvent` table.
- `src/handlers/erc7984.ts` registers Envio handlers that write rows through `envio-event-writer.ts`.

The Decryption/API Service consumes rows from `hyperindex_events` through `HyperindexPollingEventSource`.
The normalized shape includes:

- `kind`
- `chain_id`
- `token_address`
- `tx_hash`
- `log_index`
- `block_number`
- `block_timestamp`
- transfer fields: `from_address`, `to_address`, `receiver`, `encrypted_amount`, `cleartext_amount`, `unwrap_request_id`
- delegation fields: `delegator`, `delegate`, `expires_at`

For live demos and manual Sepolia scans, use the root `pnpm live:scan` script.
