import type { Address, Hex } from "./addresses.js";

export type TokenActivityKind =
  | "confidential_transfer"
  | "shield"
  | "unshield_requested"
  | "unshield_finalized";

export interface EventCursor {
  blockNumber: bigint;
  logIndex: number;
}

export interface IndexedEventBase {
  chainId: number;
  tokenAddress: Address;
  txHash: Hex;
  logIndex: number;
  blockNumber: bigint;
  blockTimestamp: Date;
}

export interface ConfidentialTransferEvent extends IndexedEventBase {
  kind: "confidential_transfer";
  from: Address;
  to: Address;
  encryptedAmount: Hex;
}

export interface ShieldEvent extends IndexedEventBase {
  kind: "shield";
  to: Address;
  encryptedAmount: Hex;
  amount: bigint;
}

export interface UnshieldRequestedEvent extends IndexedEventBase {
  kind: "unshield_requested";
  receiver: Address;
  encryptedAmount: Hex;
  unwrapRequestId: Hex | null;
}

export interface UnshieldFinalizedEvent extends IndexedEventBase {
  kind: "unshield_finalized";
  receiver: Address;
  encryptedAmount: Hex;
  amount: bigint;
  unwrapRequestId: Hex | null;
}

export interface DelegationGrantedEvent extends IndexedEventBase {
  kind: "delegation_granted";
  delegator: Address;
  delegate: Address;
  expiresAt: Date | null;
}

export interface DelegationRevokedEvent extends IndexedEventBase {
  kind: "delegation_revoked";
  delegator: Address;
  delegate: Address;
}

export type TokenIndexedEvent =
  | ConfidentialTransferEvent
  | ShieldEvent
  | UnshieldRequestedEvent
  | UnshieldFinalizedEvent;

export type IndexedEvent = TokenIndexedEvent | DelegationGrantedEvent | DelegationRevokedEvent;

export interface IndexedEventBatch {
  events: IndexedEvent[];
  nextCursor: EventCursor | null;
}
