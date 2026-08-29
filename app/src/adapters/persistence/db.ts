// PostgreSQL connectivity + UnitOfWork (P2.6 §6 — the ONLY place SQL/driver live).

import pg from 'pg';
import { config } from '../../config.ts';
import type { Tx, UnitOfWork } from '../../ports/repositories.ts';

const { Pool } = pg;

let pool: pg.Pool | null = null;

export function getPool(): pg.Pool {
  if (!pool) {
    pool = new Pool({ connectionString: config.databaseUrl, max: 10 });
  }
  return pool;
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

export const db: UnitOfWork = {
  async query<R = unknown>(text: string, params?: readonly unknown[]) {
    return getPool().query(text, params as unknown[] | undefined) as unknown as {
      rows: R[];
    };
  },
  async transaction(fn) {
    const client = await getPool().connect();
    try {
      await client.query('BEGIN');
      const tx: Tx = {
        query: <R = unknown>(text: string, params?: readonly unknown[]) =>
          client.query(text, params as unknown[] | undefined) as unknown as Promise<{
            rows: R[];
          }>,
      };
      const result = await fn(tx);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  },
};
