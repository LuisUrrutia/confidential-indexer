import type { Address } from "./addresses.js";
import { DelegationEventKind } from "./events.js";
import type { IndexedEvent } from "./events.js";

export interface DelegationRepository {
  upsertGrant(
    event: Extract<IndexedEvent, { kind: typeof DelegationEventKind.DelegationGranted }>,
  ): Promise<void>;
  markRevoked(
    event: Extract<IndexedEvent, { kind: typeof DelegationEventKind.DelegationRevoked }>,
  ): Promise<void>;
  listActiveDelegators(input: { chainId: number; tokenAddress: Address }): Promise<Address[]>;
  isActive(input: {
    chainId: number;
    tokenAddress: Address;
    delegator: Address;
    delegate?: Address;
  }): Promise<boolean>;
}
