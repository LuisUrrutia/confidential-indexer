import { describe, expect, it } from "vitest";
import {
  createConfidentialIndexer,
  type BatchDecryptTransferAmountResult,
  type BatchDecryptTransferAmountsInput,
  type DecryptionProvider,
  type IndexedEvent,
  type StoredTransfer,
  type StoredActivity,
  type TransferRepository,
  type ActivityRepository,
  type BalanceRepository,
  type CheckpointRepository,
  type DecryptionAttemptRepository,
  type DelegationRepository,
  type RefreshBalanceResult,
} from "../src/index.js";
import { InMemoryDecryptionProvider, InMemoryIndexedEventSource } from "../src/testing/index.js";

const transfer: IndexedEvent = {
  kind: "confidential_transfer",
  chainId: 31337,
  tokenAddress: "0x0000000000000000000000000000000000000001",
  txHash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  logIndex: 0,
  blockNumber: 1n,
  blockTimestamp: new Date("2026-06-29T00:00:00.000Z"),
  from: "0x00000000000000000000000000000000000000aa",
  to: "0x00000000000000000000000000000000000000bb",
  encryptedAmount: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
};

const unshieldRequest: IndexedEvent = {
  kind: "unshield_requested",
  chainId: 31337,
  tokenAddress: "0x0000000000000000000000000000000000000001",
  txHash: "0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
  logIndex: 1,
  blockNumber: 2n,
  blockTimestamp: new Date("2026-06-29T00:01:00.000Z"),
  receiver: "0x00000000000000000000000000000000000000bb",
  encryptedAmount: "0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
  unwrapRequestId: "0x1111111111111111111111111111111111111111111111111111111111111111",
};

function createMemoryRepos() {
  const transfers: StoredTransfer[] = [];
  const activities: StoredActivity[] = [];
  const checkpoints = new Map<string, { blockNumber: bigint; logIndex: number } | null>();
  const attempts: Array<{ status: string; reason: string | null }> = [];
  const balances = new Map<string, bigint>();

  const transferRepo: TransferRepository = {
    async upsertIndexedEvent(event) {
      if (event.kind !== "confidential_transfer") return;
      transfers.push({
        ...event,
        amount: null,
        decryptionStatus: "pending",
        decryptionReason: "missing_delegation",
        decryptedBy: null,
      });
    },
    async listPendingDecryptions(limit) {
      return transfers.filter((item) => item.decryptionStatus !== "decrypted").slice(0, limit);
    },
    async listPendingDecryptionsForHolder(input) {
      return transfers
        .filter(
          (item) =>
            item.chainId === input.chainId &&
            item.tokenAddress === input.tokenAddress &&
            (item.from === input.holder || item.to === input.holder) &&
            item.decryptionStatus !== "decrypted",
        )
        .slice(0, input.limit);
    },
    async markTransferDecrypted(input) {
      const item = transfers.find(
        (candidate) => candidate.txHash === input.txHash && candidate.logIndex === input.logIndex,
      );
      if (item) {
        item.amount = input.amount;
        item.decryptionStatus = "decrypted";
        item.decryptionReason = null;
        item.decryptedBy = input.decryptedBy;
      }
    },
    async markTransferUndecrypted(input) {
      const item = transfers.find(
        (candidate) => candidate.txHash === input.txHash && candidate.logIndex === input.logIndex,
      );
      if (item) {
        item.decryptionStatus = input.status;
        item.decryptionReason = input.reason;
      }
    },
    async listTransfersForHolder(query) {
      return {
        items: transfers.filter((item) => item.from === query.holder || item.to === query.holder),
        limit: query.limit,
        offset: query.offset,
      };
    },
  };

  const activityRepo: ActivityRepository = {
    async upsertIndexedEvent(event) {
      if (event.kind === "delegation_granted" || event.kind === "delegation_revoked") return;
      activities.push({
        kind: event.kind,
        chainId: event.chainId,
        tokenAddress: event.tokenAddress,
        txHash: event.txHash,
        logIndex: event.logIndex,
        blockNumber: event.blockNumber,
        blockTimestamp: event.blockTimestamp,
        from: event.kind === "confidential_transfer" ? event.from : null,
        to: event.kind === "confidential_transfer" || event.kind === "shield" ? event.to : null,
        receiver:
          event.kind === "unshield_requested" || event.kind === "unshield_finalized"
            ? event.receiver
            : null,
        encryptedAmount: event.encryptedAmount,
        amount:
          event.kind === "shield" || event.kind === "unshield_finalized" ? event.amount : null,
        unwrapRequestId:
          event.kind === "unshield_requested" || event.kind === "unshield_finalized"
            ? event.unwrapRequestId
            : null,
        decryptionStatus:
          event.kind === "shield" || event.kind === "unshield_finalized" ? "decrypted" : "pending",
        decryptionReason:
          event.kind === "shield" || event.kind === "unshield_finalized"
            ? null
            : "missing_delegation",
        decryptedBy: null,
      });
    },
    async listPendingDecryptions(limit) {
      return activities
        .filter(
          (item) =>
            item.kind !== "confidential_transfer" &&
            item.encryptedAmount !== null &&
            item.decryptionStatus !== "decrypted",
        )
        .slice(0, limit);
    },
    async markActivityDecrypted(input) {
      const item = activities.find(
        (candidate) => candidate.txHash === input.txHash && candidate.logIndex === input.logIndex,
      );
      if (item) {
        item.amount = input.amount;
        item.decryptionStatus = "decrypted";
        item.decryptionReason = null;
        item.decryptedBy = input.decryptedBy;
      }
    },
    async markActivityUndecrypted(input) {
      const item = activities.find(
        (candidate) => candidate.txHash === input.txHash && candidate.logIndex === input.logIndex,
      );
      if (item) {
        item.decryptionStatus = input.status;
        item.decryptionReason = input.reason;
      }
    },
    async listPendingDecryptionsForHolder(input) {
      return activities
        .filter((item) => {
          if (item.chainId !== input.chainId || item.tokenAddress !== input.tokenAddress)
            return false;
          if (
            item.kind === "confidential_transfer" ||
            item.encryptedAmount === null ||
            item.decryptionStatus === "decrypted"
          ) {
            return false;
          }
          if (item.kind === "shield") return item.to === input.holder;
          if (item.kind === "unshield_requested" || item.kind === "unshield_finalized") {
            return item.receiver === input.holder;
          }
          return false;
        })
        .slice(0, input.limit);
    },
    async listActivitiesForHolder(query) {
      return {
        items: activities.filter((item) => {
          if (item.kind === "confidential_transfer")
            return item.from === query.holder || item.to === query.holder;
          if (item.kind === "shield") return item.to === query.holder;
          if (item.kind === "unshield_requested" || item.kind === "unshield_finalized")
            return item.receiver === query.holder;
          return false;
        }),
        limit: query.limit,
        offset: query.offset,
      };
    },
  };

  const delegationRepo: DelegationRepository = {
    async upsertGrant() {},
    async markRevoked() {},
    async listActiveDelegators() {
      return [];
    },
    async isActive() {
      return false;
    },
  };

  const balanceRepo: BalanceRepository = {
    async applyDecryptedTransfer(item, amount) {
      balances.set(item.from, (balances.get(item.from) ?? 0n) - amount);
      balances.set(item.to, (balances.get(item.to) ?? 0n) + amount);
    },
    async saveDirectBalance(record) {
      balances.set(record.holder, record.balance ?? 0n);
    },
    async listBalances(query) {
      return {
        items: [
          {
            chainId: 31337,
            tokenAddress: transfer.tokenAddress,
            holder: query.holder,
            balance: balances.get(query.holder) ?? null,
            balanceStatus: balances.has(query.holder) ? "known" : "unknown",
            balanceSource: balances.has(query.holder) ? "events" : "none",
            historyCompleteness: "partial",
            updatedAt: new Date("2026-06-29T00:00:00.000Z"),
          },
        ],
      };
    },
  };

  const checkpointRepo: CheckpointRepository = {
    async getCursor(sourceName) {
      return checkpoints.get(sourceName) ?? null;
    },
    async saveCursor(sourceName, cursor) {
      checkpoints.set(sourceName, cursor);
    },
  };

  const attemptRepo: DecryptionAttemptRepository = {
    async recordAttempt(input) {
      attempts.push({ status: input.status, reason: input.reason });
    },
  };

  return {
    transferRepo,
    activityRepo,
    delegationRepo,
    balanceRepo,
    checkpointRepo,
    attemptRepo,
    transfers,
    activities,
    balances,
    attempts,
  };
}

class BatchOnlyDecryptionProvider implements DecryptionProvider {
  readonly batchCalls: BatchDecryptTransferAmountsInput[] = [];

  constructor(private readonly amounts: Map<`0x${string}`, bigint>) {}

  async decryptTransferAmount(): Promise<never> {
    throw new Error("single-row decryption should not be used for pending batches");
  }

  async batchDecryptTransferAmounts(
    input: BatchDecryptTransferAmountsInput,
  ): Promise<BatchDecryptTransferAmountResult[]> {
    this.batchCalls.push(input);
    return input.encryptedAmounts.map((encryptedAmount) => ({
      encryptedAmount,
      result: { status: "decrypted", amount: this.amounts.get(encryptedAmount) ?? 0n },
    }));
  }

  async refreshCurrentBalance(): Promise<RefreshBalanceResult> {
    return { status: "unknown", reason: "missing_delegation" };
  }
}

describe("ConfidentialIndexer", () => {
  it("ingests, decrypts, records attempts, and updates balances", async () => {
    const repos = createMemoryRepos();
    const decryption = new InMemoryDecryptionProvider();
    decryption.setAmount(transfer.encryptedAmount, 25n);
    const indexer = createConfidentialIndexer({
      sourceName: "hyperindex",
      eventSource: new InMemoryIndexedEventSource([transfer]),
      decryption,
      transfers: repos.transferRepo,
      balances: repos.balanceRepo,
      checkpoints: repos.checkpointRepo,
      attempts: repos.attemptRepo,
      activities: repos.activityRepo,
      delegations: repos.delegationRepo,
    });

    await expect(indexer.ingestNextBatch()).resolves.toEqual({
      ingested: 1,
      nextCursor: { blockNumber: 1n, logIndex: 0 },
    });
    await expect(indexer.processPendingDecryptions(10)).resolves.toEqual({
      attempted: 1,
      decrypted: 1,
      pending: 0,
      failed: 0,
    });

    expect(repos.transfers[0]?.amount).toBe(25n);
    expect(repos.balances.get(transfer.to)).toBe(25n);
    expect(repos.attempts).toEqual([{ status: "decrypted", reason: null }]);
  });

  it("batch decrypts pending transfer amounts per holder", async () => {
    const secondTransfer: IndexedEvent = {
      ...transfer,
      txHash: "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
      logIndex: 1,
      blockNumber: 2n,
      encryptedAmount: "0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
    };
    const amounts = new Map<`0x${string}`, bigint>([
      [transfer.encryptedAmount, 25n],
      [secondTransfer.encryptedAmount, 30n],
    ]);
    const repos = createMemoryRepos();
    const decryption = new BatchOnlyDecryptionProvider(amounts);
    const indexer = createConfidentialIndexer({
      sourceName: "hyperindex",
      eventSource: new InMemoryIndexedEventSource([transfer, secondTransfer]),
      decryption,
      transfers: repos.transferRepo,
      balances: repos.balanceRepo,
      checkpoints: repos.checkpointRepo,
      attempts: repos.attemptRepo,
      activities: repos.activityRepo,
      delegations: repos.delegationRepo,
    });

    await indexer.ingestNextBatch();

    await expect(indexer.processPendingDecryptions(10)).resolves.toEqual({
      attempted: 2,
      decrypted: 2,
      pending: 0,
      failed: 0,
    });
    expect(decryption.batchCalls).toEqual([
      {
        chainId: transfer.chainId,
        tokenAddress: transfer.tokenAddress,
        holder: transfer.to,
        encryptedAmounts: [transfer.encryptedAmount, secondTransfer.encryptedAmount],
      },
    ]);
    expect(repos.transfers.map((record) => record.amount)).toEqual([25n, 30n]);
  });

  it("batch decrypts pending unshield activity amounts per holder", async () => {
    const secondUnshieldRequest: IndexedEvent = {
      ...unshieldRequest,
      txHash: "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
      logIndex: 2,
      blockNumber: 3n,
      encryptedAmount: "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
      unwrapRequestId: "0x2222222222222222222222222222222222222222222222222222222222222222",
    };
    const amounts = new Map<`0x${string}`, bigint>([
      [unshieldRequest.encryptedAmount, 40n],
      [secondUnshieldRequest.encryptedAmount, 45n],
    ]);
    const repos = createMemoryRepos();
    const decryption = new BatchOnlyDecryptionProvider(amounts);
    const indexer = createConfidentialIndexer({
      sourceName: "hyperindex",
      eventSource: new InMemoryIndexedEventSource([unshieldRequest, secondUnshieldRequest]),
      decryption,
      transfers: repos.transferRepo,
      balances: repos.balanceRepo,
      checkpoints: repos.checkpointRepo,
      attempts: repos.attemptRepo,
      activities: repos.activityRepo,
      delegations: repos.delegationRepo,
    });

    await indexer.ingestNextBatch();

    await expect(indexer.processPendingDecryptions(10)).resolves.toEqual({
      attempted: 2,
      decrypted: 2,
      pending: 0,
      failed: 0,
    });
    expect(decryption.batchCalls).toEqual([
      {
        chainId: unshieldRequest.chainId,
        tokenAddress: unshieldRequest.tokenAddress,
        holder: unshieldRequest.receiver,
        encryptedAmounts: [unshieldRequest.encryptedAmount, secondUnshieldRequest.encryptedAmount],
      },
    ]);
    expect(repos.activities.map((record) => record.amount)).toEqual([40n, 45n]);
  });

  it("keeps undecryptable events queryable", async () => {
    const repos = createMemoryRepos();
    const decryption = new InMemoryDecryptionProvider();
    decryption.failWith({ status: "not_delegated", reason: "missing_delegation" });
    const indexer = createConfidentialIndexer({
      sourceName: "hyperindex",
      eventSource: new InMemoryIndexedEventSource([transfer]),
      decryption,
      transfers: repos.transferRepo,
      balances: repos.balanceRepo,
      checkpoints: repos.checkpointRepo,
      attempts: repos.attemptRepo,
      activities: repos.activityRepo,
      delegations: repos.delegationRepo,
    });

    await indexer.ingestNextBatch();
    await expect(indexer.processPendingDecryptions(10)).resolves.toEqual({
      attempted: 1,
      decrypted: 0,
      pending: 1,
      failed: 0,
    });

    expect(repos.transfers[0]?.amount).toBeNull();
    expect(repos.transfers[0]?.decryptionStatus).toBe("not_delegated");
  });

  it("decrypts pending unshield requests into activity history", async () => {
    const repos = createMemoryRepos();
    const decryption = new InMemoryDecryptionProvider();
    decryption.setAmount(unshieldRequest.encryptedAmount, 40n);
    const indexer = createConfidentialIndexer({
      sourceName: "hyperindex",
      eventSource: new InMemoryIndexedEventSource([unshieldRequest]),
      decryption,
      transfers: repos.transferRepo,
      balances: repos.balanceRepo,
      checkpoints: repos.checkpointRepo,
      attempts: repos.attemptRepo,
      activities: repos.activityRepo,
      delegations: repos.delegationRepo,
    });

    await indexer.ingestNextBatch();
    await expect(indexer.processPendingDecryptions(10)).resolves.toEqual({
      attempted: 1,
      decrypted: 1,
      pending: 0,
      failed: 0,
    });

    expect(repos.activities[0]).toMatchObject({
      kind: "unshield_requested",
      amount: 40n,
      decryptionStatus: "decrypted",
      decryptedBy: unshieldRequest.receiver,
    });
  });
});
