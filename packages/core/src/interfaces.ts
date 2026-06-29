import type {
  Address,
  BackfillHolderInput,
  BackfillReport,
  BalanceRecord,
  DecryptAmountResult,
  DecryptTransferAmountInput,
  DecryptionReport,
  EventCursor,
  Hex,
  IndexedEvent,
  IndexedEventBatch,
  IngestionReport,
  RefreshBalanceInput,
  RefreshBalanceResult,
  StoredTransfer,
} from "./domain.js";

export interface IndexedEventSource {
  nextBatch(cursor: EventCursor | null): Promise<IndexedEventBatch>;
}

export interface DecryptionProvider {
  decryptTransferAmount(input: DecryptTransferAmountInput): Promise<DecryptAmountResult>;
  refreshCurrentBalance(input: RefreshBalanceInput): Promise<RefreshBalanceResult>;
}

export interface CheckpointRepository {
  getCursor(sourceName: string): Promise<EventCursor | null>;
  saveCursor(sourceName: string, cursor: EventCursor | null): Promise<void>;
}

export interface TransferRepository {
  upsertIndexedEvent(event: IndexedEvent): Promise<void>;
  listPendingDecryptions(limit: number): Promise<StoredTransfer[]>;
  markTransferDecrypted(input: {
    chainId: number;
    txHash: Hex;
    logIndex: number;
    amount: bigint;
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

export interface BalanceRepository {
  applyDecryptedTransfer(transfer: StoredTransfer, amount: bigint): Promise<void>;
  saveDirectBalance(record: BalanceRecord): Promise<void>;
  listBalances(query: BalanceQuery): Promise<BalancePage>;
}

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

export interface BalanceQuery {
  holder: Address;
  chainId?: number;
  tokenAddress?: Address;
}

export interface BalancePage {
  items: BalanceRecord[];
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

export interface HealthSnapshot {
  ok: boolean;
  database: "up" | "down";
  checkpoints: Array<{ sourceName: string; cursor: EventCursor | null }>;
}

export interface ReadModel {
  getBalances(query: BalanceQuery): Promise<BalancePage>;
  getTransfers(query: TransferQuery): Promise<TransferPage>;
  getHealth(): Promise<HealthSnapshot>;
}

export interface ConfidentialIndexer {
  ingestNextBatch(): Promise<IngestionReport>;
  processPendingDecryptions(limit?: number): Promise<DecryptionReport>;
  backfillHolder(input: BackfillHolderInput): Promise<BackfillReport>;
}
