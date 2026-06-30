# Confidential Indexer

This context defines the language for a wallet-partner service that turns ERC-7984 confidential token activity into cleartext read models when the service has delegated decryption rights.

## Language

**Wallet Partner**:
An external product that wants familiar token balance and transfer-history APIs without integrating FHE concepts directly.
_Avoid_: Client, customer, consumer

**Confidential Indexer**:
The service that consumes indexed confidential-token events, decrypts authorized values, stores cleartext read models, and exposes partner APIs.
_Avoid_: Indexer when referring specifically to Hyperindex

**Hyperindex Service**:
The separate chain-indexing service responsible for reading blockchain events and producing indexed event output.
_Avoid_: Decryption service, API service

**Decryption/API Service**:
The service that consumes Hyperindex output, performs delegated decryption, stores cleartext data, and serves the partner HTTP API.
_Avoid_: Hyperindex, chain indexer

**Indexer Signer**:
The configured network-specific account used by the Decryption/API Service as the delegate for decryption rights.
_Avoid_: Contract key, token key

**Holder**:
An address whose confidential token balance or transfer history may be shown through the partner API.
_Avoid_: User when the on-chain address is what matters

**Delegator**:
A holder that grants decryption rights to the Indexer Signer for a confidential token contract.
_Avoid_: Owner when discussing ACL decryption rights

**Delegate**:
An address that receives decryption rights from a Delegator. In this service, the Delegate is normally the Indexer Signer.
_Avoid_: Operator, spender

**Delegated Decryption**:
The supported access model where a Holder grants the Indexer Signer permission to decrypt values for a specific confidential token contract.
_Avoid_: Decode, unlock

**Confidential Token**:
An ERC-7984 token contract whose balances and transfer amounts are represented as encrypted values on-chain.
_Avoid_: ERC-20 when confidentiality is relevant

**Encrypted Amount**:
The encrypted handle emitted by a confidential token event for a transfer, shield, or unshield amount.
_Avoid_: Ciphertext when describing partner-facing API fields

**Cleartext Amount**:
The decrypted numeric amount stored and returned only when the service has valid decryption rights.
_Avoid_: Plain amount, decoded amount

**Pending Decryption**:
The state of an indexed event whose encrypted amount is stored but not yet available as cleartext.
_Avoid_: Missing transfer, dropped event

**Current Balance**:
The latest known cleartext balance for a Holder and Confidential Token, possibly obtained by direct balance decryption after delegation.
_Avoid_: Historical balance

**Transfer History Completeness**:
The degree to which a holder's indexed transfer history has cleartext amounts for all relevant events.
_Avoid_: Balance correctness

**Backfill**:
A retry process that attempts to decrypt previously pending events or refresh current balances after delegation becomes available.
_Avoid_: Reindex when chain events are already indexed
