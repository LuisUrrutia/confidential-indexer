import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { PostgresPool } from "./postgres-pool.js";

export async function runSchemaMigrations(pool: PostgresPool): Promise<void> {
  const here = dirname(fileURLToPath(import.meta.url));
  const migrationPath = join(here, "..", "migrations", "001_initial.sql");
  const sql = await readFile(migrationPath, "utf8");
  await pool.query(sql);
}
