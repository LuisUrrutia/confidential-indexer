import type { Address } from "./addresses.js";
import type { IndexedEvent } from "./events.js";

export interface DelegationRepository {
  upsertGrant(event: Extract<IndexedEvent, { kind: "delegation_granted" }>): Promise<void>;
  markRevoked(event: Extract<IndexedEvent, { kind: "delegation_revoked" }>): Promise<void>;
  listActiveDelegators(input: { chainId: number; tokenAddress: Address }): Promise<Address[]>;
  isActive(input: {
    chainId: number;
    tokenAddress: Address;
    delegator: Address;
    delegate?: Address;
  }): Promise<boolean>;
}
