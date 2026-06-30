import type { Address } from "./addresses.js";
import type { ActivityRepository, StoredActivity } from "./activities.js";
import type { BackfillHolderInput, BackfillReport } from "./backfill.js";
import { BalanceStatus, HistoryCompleteness } from "./balances.js";
import type { BalanceRepository } from "./balances.js";
import type { CheckpointRepository } from "./checkpoints.js";
import { DecryptionReason, DecryptionStatus } from "./decryption.js";
import type { DecryptAmountResult, DecryptionProvider, DecryptionReport } from "./decryption.js";
import type { DecryptionAttemptRepository } from "./decryption-attempts.js";
import type { DelegationRepository } from "./delegations.js";
import { DelegationEventKind } from "./events.js";
import type { IndexedEventSource } from "./event-source.js";
import { holderCandidatesForActivity, holderCandidatesForTransfer } from "./holder-candidates.js";
import type { StoredTransfer, TransferRepository } from "./transfers.js";

export interface IngestionReport {
  ingested: number;
  nextCursor: { blockNumber: bigint; logIndex: number } | null;
}

export interface ConfidentialIndexer {
  ingestNextBatch(): Promise<IngestionReport>;
  processPendingDecryptions(limit?: number): Promise<DecryptionReport>;
  backfillHolder(input: BackfillHolderInput): Promise<BackfillReport>;
}

export interface ConfidentialIndexerDeps {
  sourceName: string;
  eventSource: IndexedEventSource;
  decryption: DecryptionProvider;
  transfers: TransferRepository;
  activities: ActivityRepository;
  delegations: DelegationRepository;
  balances: BalanceRepository;
  checkpoints: CheckpointRepository;
  attempts: DecryptionAttemptRepository;
}
type UndecryptedAmountOutcome = Exclude<
  DecryptAmountResult,
  { status: typeof DecryptionStatus.Decrypted }
>;

type ProcessingStatus =
  | typeof DecryptionStatus.Decrypted
  | typeof DecryptionStatus.Pending
  | typeof DecryptionStatus.Failed
  | null;

function chooseUndecryptedResult(
  results: UndecryptedAmountOutcome[],
): UndecryptedAmountOutcome | null {
  return (
    results.find((result) => result.status === DecryptionStatus.RetryableError) ??
    results.find((result) => result.status === DecryptionStatus.Failed) ??
    results[0] ??
    null
  );
}

export function createConfidentialIndexer(deps: ConfidentialIndexerDeps): ConfidentialIndexer {
  async function candidatesForTransfer(transfer: StoredTransfer): Promise<Address[]> {
    return holderCandidatesForTransfer(
      transfer,
      await deps.delegations.listActiveDelegators({
        chainId: transfer.chainId,
        tokenAddress: transfer.tokenAddress,
      }),
    );
  }

  async function candidatesForActivity(activity: StoredActivity): Promise<Address[]> {
    return holderCandidatesForActivity(
      activity,
      await deps.delegations.listActiveDelegators({
        chainId: activity.chainId,
        tokenAddress: activity.tokenAddress,
      }),
    );
  }

  async function recordUndecrypted(
    transfer: StoredTransfer,
    result: UndecryptedAmountOutcome,
  ): Promise<void> {
    await deps.transfers.markTransferUndecrypted({
      chainId: transfer.chainId,
      txHash: transfer.txHash,
      logIndex: transfer.logIndex,
      status: result.status,
      reason: result.reason,
    });
    await deps.activities.markActivityUndecrypted({
      chainId: transfer.chainId,
      txHash: transfer.txHash,
      logIndex: transfer.logIndex,
      status: result.status,
      reason: result.reason,
    });
  }

  async function markTransferDecrypted(
    transfer: StoredTransfer,
    amount: bigint,
    decryptedBy: Address,
  ): Promise<void> {
    await deps.transfers.markTransferDecrypted({
      chainId: transfer.chainId,
      txHash: transfer.txHash,
      logIndex: transfer.logIndex,
      amount,
      decryptedBy,
    });
    await deps.activities.markActivityDecrypted({
      chainId: transfer.chainId,
      txHash: transfer.txHash,
      logIndex: transfer.logIndex,
      amount,
      decryptedBy,
    });
    await deps.balances.applyDecryptedTransfer(transfer, amount);
  }

  async function recordTransferAttempt(
    transfer: StoredTransfer,
    candidate: Address,
    result: DecryptAmountResult,
  ): Promise<void> {
    await deps.attempts.recordAttempt({
      chainId: transfer.chainId,
      tokenAddress: transfer.tokenAddress,
      txHash: transfer.txHash,
      logIndex: transfer.logIndex,
      status: result.status,
      reason: result.status === DecryptionStatus.Decrypted ? null : result.reason,
      message:
        result.status === DecryptionStatus.Decrypted ? null : `${candidate}:${result.reason}`,
    });
  }

  async function recordActivityUndecrypted(
    activity: StoredActivity,
    result: UndecryptedAmountOutcome,
  ): Promise<void> {
    await deps.activities.markActivityUndecrypted({
      chainId: activity.chainId,
      txHash: activity.txHash,
      logIndex: activity.logIndex,
      status: result.status,
      reason: result.reason,
    });
  }

  async function markActivityDecrypted(
    activity: StoredActivity,
    amount: bigint,
    decryptedBy: Address,
  ): Promise<void> {
    await deps.activities.markActivityDecrypted({
      chainId: activity.chainId,
      txHash: activity.txHash,
      logIndex: activity.logIndex,
      amount,
      decryptedBy,
    });
  }

  async function recordActivityAttempt(
    activity: StoredActivity,
    candidate: Address,
    result: DecryptAmountResult,
  ): Promise<void> {
    await deps.attempts.recordAttempt({
      chainId: activity.chainId,
      tokenAddress: activity.tokenAddress,
      txHash: activity.txHash,
      logIndex: activity.logIndex,
      status: result.status,
      reason: result.status === DecryptionStatus.Decrypted ? null : result.reason,
      message:
        result.status === DecryptionStatus.Decrypted ? null : `${candidate}:${result.reason}`,
    });
  }

  async function processTransfers(pending: StoredTransfer[]): Promise<DecryptionReport> {
    const report: DecryptionReport = {
      attempted: pending.length,
      decrypted: 0,
      pending: 0,
      failed: 0,
    };
    const candidateLists = await Promise.all(pending.map(candidatesForTransfer));
    const statuses: ProcessingStatus[] = pending.map(() => null);
    const failures = pending.map((): UndecryptedAmountOutcome[] => []);

    for (const [index, candidates] of candidateLists.entries()) {
      if (candidates.length > 0) continue;
      const result: UndecryptedAmountOutcome = {
        status: DecryptionStatus.NotDelegated,
        reason: DecryptionReason.MissingDelegation,
      };
      await recordUndecrypted(pending[index]!, result);
      statuses[index] = DecryptionStatus.Pending;
    }

    const maxCandidates = Math.max(0, ...candidateLists.map((candidates) => candidates.length));
    for (let candidateIndex = 0; candidateIndex < maxCandidates; candidateIndex += 1) {
      const groups = new Map<
        string,
        {
          chainId: number;
          tokenAddress: Address;
          holder: Address;
          transferIndexes: number[];
        }
      >();

      for (const [index, transfer] of pending.entries()) {
        if (statuses[index]) continue;
        const holder = candidateLists[index]?.[candidateIndex];
        if (!holder) continue;
        const key = `${transfer.chainId}:${transfer.tokenAddress.toLowerCase()}:${holder.toLowerCase()}`;
        const group = groups.get(key) ?? {
          chainId: transfer.chainId,
          tokenAddress: transfer.tokenAddress,
          holder,
          transferIndexes: [],
        };
        group.transferIndexes.push(index);
        groups.set(key, group);
      }

      for (const group of groups.values()) {
        const encryptedAmounts = group.transferIndexes.map(
          (transferIndex) => pending[transferIndex]!.encryptedAmount,
        );
        const results = await deps.decryption.batchDecryptTransferAmounts({
          chainId: group.chainId,
          tokenAddress: group.tokenAddress,
          holder: group.holder,
          encryptedAmounts,
        });
        const resultsByAmount = new Map(
          results.map((item) => [item.encryptedAmount.toLowerCase(), item.result]),
        );

        for (const transferIndex of group.transferIndexes) {
          if (statuses[transferIndex]) continue;
          const transfer = pending[transferIndex]!;
          const result: DecryptAmountResult = resultsByAmount.get(
            transfer.encryptedAmount.toLowerCase(),
          ) ?? {
            status: DecryptionStatus.RetryableError,
            reason: DecryptionReason.SdkError,
          };
          await recordTransferAttempt(transfer, group.holder, result);
          if (result.status === DecryptionStatus.Decrypted) {
            await markTransferDecrypted(transfer, result.amount, group.holder);
            statuses[transferIndex] = DecryptionStatus.Decrypted;
          } else {
            failures[transferIndex]?.push(result);
          }
        }
      }
    }

    for (const [index, transfer] of pending.entries()) {
      if (statuses[index]) continue;
      const best = chooseUndecryptedResult(failures[index] ?? []);
      if (!best) {
        statuses[index] = DecryptionStatus.Pending;
        continue;
      }
      await recordUndecrypted(transfer, best);
      statuses[index] =
        best.status === DecryptionStatus.Failed
          ? DecryptionStatus.Failed
          : DecryptionStatus.Pending;
    }

    for (const status of statuses) {
      if (status === DecryptionStatus.Decrypted) report.decrypted += 1;
      else if (status === DecryptionStatus.Failed) report.failed += 1;
      else report.pending += 1;
    }
    return report;
  }

  async function processActivities(pending: StoredActivity[]): Promise<DecryptionReport> {
    const report: DecryptionReport = {
      attempted: pending.length,
      decrypted: 0,
      pending: 0,
      failed: 0,
    };
    const candidateLists = await Promise.all(pending.map(candidatesForActivity));
    const failures = pending.map((): UndecryptedAmountOutcome[] => []);
    const statuses: DecryptionStatus[] = pending.map(() => DecryptionStatus.Pending);
    const maxCandidates = Math.max(0, ...candidateLists.map((candidates) => candidates.length));

    for (let candidateIndex = 0; candidateIndex < maxCandidates; candidateIndex += 1) {
      const groups = new Map<
        string,
        {
          chainId: number;
          tokenAddress: Address;
          holder: Address;
          activityIndexes: number[];
        }
      >();

      for (const [index, activity] of pending.entries()) {
        if (statuses[index] === DecryptionStatus.Decrypted || !activity.encryptedAmount) continue;
        const holder = candidateLists[index]?.[candidateIndex];
        if (!holder) continue;
        const key = `${activity.chainId}:${activity.tokenAddress.toLowerCase()}:${holder.toLowerCase()}`;
        const group =
          groups.get(key) ??
          ({
            chainId: activity.chainId,
            tokenAddress: activity.tokenAddress,
            holder,
            activityIndexes: [],
          } satisfies {
            chainId: number;
            tokenAddress: Address;
            holder: Address;
            activityIndexes: number[];
          });
        group.activityIndexes.push(index);
        groups.set(key, group);
      }

      for (const group of groups.values()) {
        const encryptedAmounts = group.activityIndexes.flatMap((index) => {
          const encryptedAmount = pending[index]?.encryptedAmount;
          return encryptedAmount ? [encryptedAmount] : [];
        });
        const results = await deps.decryption.batchDecryptTransferAmounts({
          chainId: group.chainId,
          tokenAddress: group.tokenAddress,
          holder: group.holder,
          encryptedAmounts,
        });
        const resultsByAmount = new Map(results.map((item) => [item.encryptedAmount, item.result]));

        for (const index of group.activityIndexes) {
          if (statuses[index] === DecryptionStatus.Decrypted) continue;
          const activity = pending[index];
          if (!activity?.encryptedAmount) continue;
          const result = resultsByAmount.get(activity.encryptedAmount) ?? {
            status: DecryptionStatus.RetryableError,
            reason: DecryptionReason.SdkError,
          };
          await recordActivityAttempt(activity, group.holder, result);
          if (result.status === DecryptionStatus.Decrypted) {
            await markActivityDecrypted(activity, result.amount, group.holder);
            statuses[index] = DecryptionStatus.Decrypted;
          } else {
            failures[index]?.push(result);
          }
        }
      }
    }

    for (const [index, activity] of pending.entries()) {
      if (statuses[index] === DecryptionStatus.Decrypted) continue;
      const best = chooseUndecryptedResult(failures[index] ?? []);
      if (!best) {
        statuses[index] = DecryptionStatus.Pending;
        continue;
      }
      await recordActivityUndecrypted(activity, best);
      statuses[index] =
        best.status === DecryptionStatus.Failed
          ? DecryptionStatus.Failed
          : DecryptionStatus.Pending;
    }

    for (const status of statuses) {
      if (status === DecryptionStatus.Decrypted) report.decrypted += 1;
      else if (status === DecryptionStatus.Failed) report.failed += 1;
      else report.pending += 1;
    }
    return report;
  }

  function mergeReports(left: DecryptionReport, right: DecryptionReport): DecryptionReport {
    return {
      attempted: left.attempted + right.attempted,
      decrypted: left.decrypted + right.decrypted,
      pending: left.pending + right.pending,
      failed: left.failed + right.failed,
    };
  }

  return {
    async ingestNextBatch(): Promise<IngestionReport> {
      const cursor = await deps.checkpoints.getCursor(deps.sourceName);
      const batch = await deps.eventSource.nextBatch(cursor);
      for (const event of batch.events) {
        if (event.kind === DelegationEventKind.DelegationGranted) {
          await deps.delegations.upsertGrant(event);
          continue;
        }
        if (event.kind === DelegationEventKind.DelegationRevoked) {
          await deps.delegations.markRevoked(event);
          continue;
        }
        await deps.activities.upsertIndexedEvent(event);
        await deps.transfers.upsertIndexedEvent(event);
      }
      await deps.checkpoints.saveCursor(deps.sourceName, batch.nextCursor);
      return { ingested: batch.events.length, nextCursor: batch.nextCursor };
    },

    async processPendingDecryptions(limit = 100): Promise<DecryptionReport> {
      const transferReport = await processTransfers(
        await deps.transfers.listPendingDecryptions(limit),
      );
      const remaining = Math.max(0, limit - transferReport.attempted);
      if (remaining === 0) return transferReport;
      const activityReport = await processActivities(
        await deps.activities.listPendingDecryptions(remaining),
      );
      return mergeReports(transferReport, activityReport);
    },

    async backfillHolder(input: BackfillHolderInput): Promise<BackfillReport> {
      const transferReport = await processTransfers(
        await deps.transfers.listPendingDecryptionsForHolder({ ...input, limit: 100 }),
      );
      const decryptionReport = mergeReports(
        transferReport,
        await processActivities(
          await deps.activities.listPendingDecryptionsForHolder({
            ...input,
            limit: Math.max(0, 100 - transferReport.attempted),
          }),
        ),
      );
      const balance = await deps.decryption.refreshCurrentBalance(input);
      if (balance.status === BalanceStatus.Known) {
        await deps.balances.saveDirectBalance({
          chainId: input.chainId,
          tokenAddress: input.tokenAddress,
          holder: input.holder,
          balance: balance.balance,
          balanceStatus: BalanceStatus.Known,
          balanceSource: balance.source,
          historyCompleteness: HistoryCompleteness.Partial,
          updatedAt: new Date(),
        });
        return { holder: input.holder, transferReport: decryptionReport, balanceRefreshed: true };
      }
      return { holder: input.holder, transferReport: decryptionReport, balanceRefreshed: false };
    },
  };
}
