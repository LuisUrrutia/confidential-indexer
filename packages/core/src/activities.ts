import type { Address, Hex } from "./addresses.js";
import type { BackfillHolderInput } from "./backfill.js";
import type { DecryptionReason, DecryptionStatus } from "./decryption.js";
import type { IndexedEvent, TokenActivityKind } from "./events.js";

export interface StoredActivity {
  kind: TokenActivityKind;
  chainId: number;
  tokenAddress: Address;
  txHash: Hex;
  logIndex: number;
  blockNumber: bigint;
  blockTimestamp: Date;
  from: Address | null;
  to: Address | null;
  receiver: Address | null;
  encryptedAmount: Hex | null;
  amount: bigint | null;
  unwrapRequestId: Hex | null;
  decryptionStatus: DecryptionStatus;
  decryptionReason: DecryptionReason;
  decryptedBy: Address | null;
}

export interface ActivityQuery {
  holder: Address;
  chainId?: number;
  tokenAddress?: Address;
  kind?: StoredActivity["kind"];
  decryptionStatus?: StoredActivity["decryptionStatus"];
  limit: number;
  offset: number;
}

export interface ActivityPage {
  items: StoredActivity[];
  limit: number;
  offset: number;
}

export interface ActivityRepository {
  upsertIndexedEvent(event: IndexedEvent): Promise<void>;
  listPendingDecryptions(limit: number): Promise<StoredActivity[]>;
  listPendingDecryptionsForHolder(
    input: BackfillHolderInput & { limit: number },
  ): Promise<StoredActivity[]>;
  markActivityDecrypted(input: {
    chainId: number;
    txHash: Hex;
    logIndex: number;
    amount: bigint;
    decryptedBy: Address;
  }): Promise<void>;
  markActivityUndecrypted(input: {
    chainId: number;
    txHash: Hex;
    logIndex: number;
    status: StoredActivity["decryptionStatus"];
    reason: StoredActivity["decryptionReason"];
  }): Promise<void>;
  listActivitiesForHolder(query: ActivityQuery): Promise<ActivityPage>;
}
