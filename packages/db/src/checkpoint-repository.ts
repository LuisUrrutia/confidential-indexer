import type { CheckpointRepository, EventCursor } from "@confidential-indexer/core";
import type { PostgresPool } from "./postgres-pool.js";

function toBigInt(value: string | number | bigint): bigint {
  return typeof value === "bigint" ? value : BigInt(value);
}

export class PostgresCheckpointRepository implements CheckpointRepository {
  constructor(
    private readonly pool: PostgresPool,
    private readonly sourceName: string,
  ) {}

  async getCursor(): Promise<EventCursor | null> {
    const result = await this.pool.query(
      "select block_number, log_index from event_checkpoints where source_name = $1",
      [this.sourceName],
    );
    const row = result.rows[0];
    if (!row || row.block_number === null || row.log_index === null) return null;
    return { blockNumber: toBigInt(row.block_number), logIndex: Number(row.log_index) };
  }

  async saveCursor(_sourceName: string, cursor: EventCursor | null): Promise<void> {
    await this.pool.query(
      `insert into event_checkpoints (source_name, block_number, log_index)
       values ($1, $2, $3)
       on conflict (source_name) do update set block_number = excluded.block_number, log_index = excluded.log_index, updated_at = now()`,
      [this.sourceName, cursor?.blockNumber.toString() ?? null, cursor?.logIndex ?? null],
    );
  }
}
