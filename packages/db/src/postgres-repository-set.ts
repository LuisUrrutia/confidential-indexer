import type {
  ActivityRepository,
  BalanceRepository,
  CheckpointRepository,
  DecryptionAttemptRepository,
  DelegationRepository,
  TransferRepository,
} from "@confidential-indexer/core";
import { PostgresActivityRepository } from "./activity-repository.js";
import { PostgresBalanceRepository } from "./balance-repository.js";
import { PostgresCheckpointRepository } from "./checkpoint-repository.js";
import { PostgresDecryptionAttemptRepository } from "./decryption-attempt-repository.js";
import { PostgresDelegationRepository } from "./delegation-repository.js";
import type { PostgresPool } from "./postgres-pool.js";
import { PostgresTransferRepository } from "./transfer-repository.js";

export class PostgresRepositorySet {
  readonly checkpoints: CheckpointRepository;
  readonly transfers: TransferRepository;
  readonly activities: ActivityRepository;
  readonly delegations: DelegationRepository;
  readonly balances: BalanceRepository;
  readonly attempts: DecryptionAttemptRepository;

  constructor(pool: PostgresPool, sourceName: string) {
    this.checkpoints = new PostgresCheckpointRepository(pool, sourceName);
    this.transfers = new PostgresTransferRepository(pool);
    this.activities = new PostgresActivityRepository(pool);
    this.delegations = new PostgresDelegationRepository(pool);
    this.balances = new PostgresBalanceRepository(pool);
    this.attempts = new PostgresDecryptionAttemptRepository(pool);
  }
}
