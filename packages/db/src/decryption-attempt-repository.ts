import type { DecryptionAttemptRepository, StoredTransfer } from "@confidential-indexer/core";
import type { PostgresPool } from "./postgres-pool.js";

export class PostgresDecryptionAttemptRepository implements DecryptionAttemptRepository {
  constructor(private readonly pool: PostgresPool) {}

  async recordAttempt(input: {
    chainId: number;
    tokenAddress: StoredTransfer["tokenAddress"];
    txHash: StoredTransfer["txHash"];
    logIndex: number;
    status: StoredTransfer["decryptionStatus"];
    reason: StoredTransfer["decryptionReason"];
    message: string | null;
  }): Promise<void> {
    await this.pool.query(
      `insert into decryption_attempts (chain_id, token_address, tx_hash, log_index, status, reason, message)
       values ($1,$2,$3,$4,$5,$6,$7)`,
      [
        input.chainId,
        input.tokenAddress.toLowerCase(),
        input.txHash,
        input.logIndex,
        input.status,
        input.reason,
        input.message,
      ],
    );
  }
}
