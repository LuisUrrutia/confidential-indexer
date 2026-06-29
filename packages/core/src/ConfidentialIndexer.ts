import type {
  BackfillHolderInput,
  BackfillReport,
  DecryptionReport,
  IngestionReport,
} from "./domain.js";
import type {
  ConfidentialIndexer,
  DecryptionAttemptRepository,
  DecryptionProvider,
  BalanceRepository,
  CheckpointRepository,
  IndexedEventSource,
  TransferRepository,
} from "./interfaces.js";

export interface ConfidentialIndexerDeps {
  sourceName: string;
  eventSource: IndexedEventSource;
  decryption: DecryptionProvider;
  transfers: TransferRepository;
  balances: BalanceRepository;
  checkpoints: CheckpointRepository;
  attempts: DecryptionAttemptRepository;
}

export function createConfidentialIndexer(deps: ConfidentialIndexerDeps): ConfidentialIndexer {
  return {
    async ingestNextBatch(): Promise<IngestionReport> {
      const cursor = await deps.checkpoints.getCursor(deps.sourceName);
      const batch = await deps.eventSource.nextBatch(cursor);
      for (const event of batch.events) {
        await deps.transfers.upsertIndexedEvent(event);
      }
      await deps.checkpoints.saveCursor(deps.sourceName, batch.nextCursor);
      return { ingested: batch.events.length, nextCursor: batch.nextCursor };
    },

    async processPendingDecryptions(limit = 100): Promise<DecryptionReport> {
      const pending = await deps.transfers.listPendingDecryptions(limit);
      const report: DecryptionReport = { attempted: 0, decrypted: 0, pending: 0, failed: 0 };

      for (const transfer of pending) {
        report.attempted += 1;
        const result = await deps.decryption.decryptTransferAmount({
          chainId: transfer.chainId,
          tokenAddress: transfer.tokenAddress,
          holder: transfer.to,
          encryptedAmount: transfer.encryptedAmount,
        });

        if (result.status === "decrypted") {
          await deps.transfers.markTransferDecrypted({ chainId: transfer.chainId, txHash: transfer.txHash, logIndex: transfer.logIndex, amount: result.amount });
          await deps.balances.applyDecryptedTransfer(transfer, result.amount);
          await deps.attempts.recordAttempt({ chainId: transfer.chainId, tokenAddress: transfer.tokenAddress, txHash: transfer.txHash, logIndex: transfer.logIndex, status: "decrypted", reason: null, message: null });
          report.decrypted += 1;
          continue;
        }

        await deps.transfers.markTransferUndecrypted({ chainId: transfer.chainId, txHash: transfer.txHash, logIndex: transfer.logIndex, status: result.status, reason: result.reason });
        await deps.attempts.recordAttempt({ chainId: transfer.chainId, tokenAddress: transfer.tokenAddress, txHash: transfer.txHash, logIndex: transfer.logIndex, status: result.status, reason: result.reason, message: result.reason });
        if (result.status === "failed") report.failed += 1;
        else report.pending += 1;
      }

      return report;
    },

    async backfillHolder(input: BackfillHolderInput): Promise<BackfillReport> {
      const transferReport = await this.processPendingDecryptions(100);
      const balance = await deps.decryption.refreshCurrentBalance(input);
      if (balance.status === "known") {
        await deps.balances.saveDirectBalance({
          chainId: input.chainId,
          tokenAddress: input.tokenAddress,
          holder: input.holder,
          balance: balance.balance,
          balanceStatus: "known",
          balanceSource: balance.source,
          historyCompleteness: "partial",
          updatedAt: new Date(),
        });
        return { holder: input.holder, transferReport, balanceRefreshed: true };
      }
      return { holder: input.holder, transferReport, balanceRefreshed: false };
    },
  };
}
