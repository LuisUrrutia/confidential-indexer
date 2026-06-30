import type { Address, Hex } from "./addresses.js";
import type { StoredTransfer } from "./transfers.js";

export interface DecryptionAttemptRepository {
  recordAttempt(input: {
    chainId: number;
    tokenAddress: Address;
    txHash: Hex;
    logIndex: number;
    status: StoredTransfer["decryptionStatus"];
    reason: StoredTransfer["decryptionReason"];
    message: string | null;
  }): Promise<void>;
}
