import type { Address, Hex } from "./addresses.js";

export const TokenActivityKind = {
  ConfidentialTransfer: "confidential_transfer",
  Shield: "shield",
  UnshieldRequested: "unshield_requested",
  UnshieldFinalized: "unshield_finalized",
} as const;

export type TokenActivityKind = (typeof TokenActivityKind)[keyof typeof TokenActivityKind];

export const TOKEN_ACTIVITY_KIND_VALUES = [
  TokenActivityKind.ConfidentialTransfer,
  TokenActivityKind.Shield,
  TokenActivityKind.UnshieldRequested,
  TokenActivityKind.UnshieldFinalized,
] as const satisfies readonly TokenActivityKind[];

export const DelegationEventKind = {
  DelegationGranted: "delegation_granted",
  DelegationRevoked: "delegation_revoked",
} as const;

export type DelegationEventKind = (typeof DelegationEventKind)[keyof typeof DelegationEventKind];

export const DELEGATION_EVENT_KIND_VALUES = [
  DelegationEventKind.DelegationGranted,
  DelegationEventKind.DelegationRevoked,
] as const satisfies readonly DelegationEventKind[];

export const IndexedEventKind = {
  ...TokenActivityKind,
  ...DelegationEventKind,
} as const;

export type IndexedEventKind = TokenActivityKind | DelegationEventKind;

export const INDEXED_EVENT_KIND_VALUES = [
  ...TOKEN_ACTIVITY_KIND_VALUES,
  ...DELEGATION_EVENT_KIND_VALUES,
] as const satisfies readonly IndexedEventKind[];

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
  kind: typeof TokenActivityKind.ConfidentialTransfer;
  from: Address;
  to: Address;
  encryptedAmount: Hex;
}

export interface ShieldEvent extends IndexedEventBase {
  kind: typeof TokenActivityKind.Shield;
  to: Address;
  encryptedAmount: Hex;
  amount: bigint;
}

export interface UnshieldRequestedEvent extends IndexedEventBase {
  kind: typeof TokenActivityKind.UnshieldRequested;
  receiver: Address;
  encryptedAmount: Hex;
  unwrapRequestId: Hex | null;
}

export interface UnshieldFinalizedEvent extends IndexedEventBase {
  kind: typeof TokenActivityKind.UnshieldFinalized;
  receiver: Address;
  encryptedAmount: Hex;
  amount: bigint;
  unwrapRequestId: Hex | null;
}

export interface DelegationGrantedEvent extends IndexedEventBase {
  kind: typeof DelegationEventKind.DelegationGranted;
  delegator: Address;
  delegate: Address;
  expiresAt: Date | null;
}

export interface DelegationRevokedEvent extends IndexedEventBase {
  kind: typeof DelegationEventKind.DelegationRevoked;
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
