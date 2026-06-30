import type {
  Address,
  BackfillHolderInput,
  BackfillReport,
  BalanceRecord,
  BatchDecryptTransferAmountResult,
  BatchDecryptTransferAmountsInput,
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
  StoredActivity,
  StoredTransfer,
} from "./domain.js";

export interface IndexedEventSource {
  nextBatch(cursor: EventCursor | null): Promise<IndexedEventBatch>;
}

export interface DecryptionProvider {
  decryptTransferAmount(input: DecryptTransferAmountInput): Promise<DecryptAmountResult>;
  batchDecryptTransferAmounts(
    input: BatchDecryptTransferAmountsInput,
  ): Promise<BatchDecryptTransferAmountResult[]>;
  refreshCurrentBalance(input: RefreshBalanceInput): Promise<RefreshBalanceResult>;
}

export interface CheckpointRepository {
  getCursor(sourceName: string): Promise<EventCursor | null>;
  saveCursor(sourceName: string, cursor: EventCursor | null): Promise<void>;
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

export interface HealthSourceSnapshot {
  sourceName: string;
  chainId: number | null;
  tokenAddress: Address | null;
  cursor: EventCursor | null;
  pendingDecryptions: number;
  retryableDecryptions: number;
  failedDecryptions: number;
  lastIndexedAt: Date | null;
  lastIndexedBlock: bigint | null;
  headBlock: bigint | null;
  blocksBehind: bigint | null;
}

export interface HealthSnapshot {
  ok: boolean;
  database: "up" | "down";
  checkpoints: Array<{ sourceName: string; cursor: EventCursor | null }>;
  sources: HealthSourceSnapshot[];
}

export interface ReadModel {
  getBalances(query: BalanceQuery): Promise<BalancePage>;
  getTransfers(query: TransferQuery): Promise<TransferPage>;
  getActivities(query: ActivityQuery): Promise<ActivityPage>;
  getHealth(): Promise<HealthSnapshot>;
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
