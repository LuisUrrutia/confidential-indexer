import pg from "pg";

export type PostgresPool = pg.Pool;
export type PostgresPoolClient = pg.PoolClient;

export function createPostgresPool(databaseUrl: string): PostgresPool {
  return new pg.Pool({ connectionString: databaseUrl });
}
