/**
 * Postgres connection pool + pgvector registration.
 * The DB is the blackboard substrate (AGENT-ARCHITECTURE §5.1); everything durable flows through
 * here. Repositories (not agents) own SQL — agents never embed queries.
 */
import pg from 'pg';
import pgvector from 'pgvector/pg';
import { loadConfig } from '../config/index.js';

export type Pool = pg.Pool;
export type PoolClient = pg.PoolClient;

let pool: pg.Pool | undefined;

export function getPool(): pg.Pool {
  if (pool) return pool;
  const cfg = loadConfig();
  pool = new pg.Pool({ connectionString: cfg.DATABASE_URL });
  // Register the pgvector type parser/serializer on every new connection.
  pool.on('connect', (client) => {
    void pgvector.registerType(client);
  });
  return pool;
}

/** Run `fn` inside a transaction, rolling back on error. */
export async function withTransaction<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = undefined;
  }
}
