import type { Address, Hex } from "./addresses.js";
import type { BackfillHolderInput } from "./backfill.js";
import type { DecryptionReason, DecryptionStatus } from "./decryption.js";
import type { IndexedEvent } from "./events.js";

export interface StoredTransfer {
  chainId: number;
  tokenAddress: Address;
  txHash: Hex;
  logIndex: number;
  blockNumber: bigint;
  blockTimestamp: Date;
  from: Address;
  to: Address;
  encryptedAmount: Hex;
  amount: bigint | null;
  decryptionStatus: DecryptionStatus;
  decryptionReason: DecryptionReason;
  decryptedBy: Address | null;
}

export interface TransferQuery {
  holder: Address;
  chainId?: number;
  tokenAddress?: Address;
  decryptionStatus?: StoredTransfer["decryptionStatus"];
  limit: number;
  offset: number;
}

export interface TransferPage {
  items: StoredTransfer[];
  limit: number;
  offset: number;
}

export interface TransferRepository {
  upsertIndexedEvent(event: IndexedEvent): Promise<void>;
  listPendingDecryptions(limit: number): Promise<StoredTransfer[]>;
  listPendingDecryptionsForHolder(
    input: BackfillHolderInput & { limit: number },
  ): Promise<StoredTransfer[]>;
  markTransferDecrypted(input: {
    chainId: number;
    txHash: Hex;
    logIndex: number;
    amount: bigint;
    decryptedBy: Address;
  }): Promise<void>;
  markTransferUndecrypted(input: {
    chainId: number;
    txHash: Hex;
    logIndex: number;
    status: StoredTransfer["decryptionStatus"];
    reason: StoredTransfer["decryptionReason"];
  }): Promise<void>;
  listTransfersForHolder(query: TransferQuery): Promise<TransferPage>;
}
