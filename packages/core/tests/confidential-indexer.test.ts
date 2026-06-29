import { describe, expect, it } from "vitest";
import {
  createConfidentialIndexer,
  FakeDecryptionProvider,
  FakeIndexedEventSource,
  type IndexedEvent,
  type StoredTransfer,
  type TransferRepository,
  type BalanceRepository,
  type CheckpointRepository,
  type DecryptionAttemptRepository,
} from "../src/index.js";

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

function createMemoryRepos() {
  const transfers: StoredTransfer[] = [];
  const checkpoints = new Map<string, { blockNumber: bigint; logIndex: number } | null>();
  const attempts: Array<{ status: string; reason: string | null }> = [];
  const balances = new Map<string, bigint>();

  const transferRepo: TransferRepository = {
    async upsertIndexedEvent(event) {
      if (event.kind !== "confidential_transfer") return;
      transfers.push({ ...event, amount: null, decryptionStatus: "pending", decryptionReason: "missing_delegation" });
    },
    async listPendingDecryptions(limit) {
      return transfers.filter((item) => item.decryptionStatus !== "decrypted").slice(0, limit);
    },
    async markTransferDecrypted(input) {
      const item = transfers.find((candidate) => candidate.txHash === input.txHash && candidate.logIndex === input.logIndex);
      if (item) {
        item.amount = input.amount;
        item.decryptionStatus = "decrypted";
        item.decryptionReason = null;
      }
    },
    async markTransferUndecrypted(input) {
      const item = transfers.find((candidate) => candidate.txHash === input.txHash && candidate.logIndex === input.logIndex);
      if (item) {
        item.decryptionStatus = input.status;
        item.decryptionReason = input.reason;
      }
    },
    async listTransfersForHolder(query) {
      return { items: transfers.filter((item) => item.from === query.holder || item.to === query.holder), limit: query.limit, offset: query.offset };
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
        items: [{ chainId: 31337, tokenAddress: transfer.tokenAddress, holder: query.holder, balance: balances.get(query.holder) ?? null, balanceStatus: balances.has(query.holder) ? "known" : "unknown", balanceSource: balances.has(query.holder) ? "events" : "none", historyCompleteness: "partial", updatedAt: new Date("2026-06-29T00:00:00.000Z") }],
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

  return { transferRepo, balanceRepo, checkpointRepo, attemptRepo, transfers, balances, attempts };
}

describe("ConfidentialIndexer", () => {
  it("ingests, decrypts, records attempts, and updates balances", async () => {
    const repos = createMemoryRepos();
    const decryption = new FakeDecryptionProvider();
    decryption.setAmount(transfer.encryptedAmount, 25n);
    const indexer = createConfidentialIndexer({ sourceName: "hyperindex", eventSource: new FakeIndexedEventSource([transfer]), decryption, transfers: repos.transferRepo, balances: repos.balanceRepo, checkpoints: repos.checkpointRepo, attempts: repos.attemptRepo });

    await expect(indexer.ingestNextBatch()).resolves.toEqual({ ingested: 1, nextCursor: { blockNumber: 1n, logIndex: 0 } });
    await expect(indexer.processPendingDecryptions(10)).resolves.toEqual({ attempted: 1, decrypted: 1, pending: 0, failed: 0 });

    expect(repos.transfers[0]?.amount).toBe(25n);
    expect(repos.balances.get(transfer.to)).toBe(25n);
    expect(repos.attempts).toEqual([{ status: "decrypted", reason: null }]);
  });

  it("keeps undecryptable events queryable", async () => {
    const repos = createMemoryRepos();
    const decryption = new FakeDecryptionProvider();
    decryption.failWith({ status: "not_delegated", reason: "missing_delegation" });
    const indexer = createConfidentialIndexer({ sourceName: "hyperindex", eventSource: new FakeIndexedEventSource([transfer]), decryption, transfers: repos.transferRepo, balances: repos.balanceRepo, checkpoints: repos.checkpointRepo, attempts: repos.attemptRepo });

    await indexer.ingestNextBatch();
    await expect(indexer.processPendingDecryptions(10)).resolves.toEqual({ attempted: 1, decrypted: 0, pending: 1, failed: 0 });

    expect(repos.transfers[0]?.amount).toBeNull();
    expect(repos.transfers[0]?.decryptionStatus).toBe("not_delegated");
  });
});
