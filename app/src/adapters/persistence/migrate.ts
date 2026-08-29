// Forward-only SQL migration runner (P2.6 §3, §9). No ORM auto-migration.
// Each file in migrations/ is applied once, in filename order, inside a
// transaction, and recorded in schema_migrations.
//
// Usage:  node src/adapters/persistence/migrate.ts            (apply pending)
//         node src/adapters/persistence/migrate.ts --status   (list state)

import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { getPool, closePool } from './db.ts';
import { config } from '../../config.ts';

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), '../../../migrations');

async function ensureRegistry(): Promise<void> {
  await getPool().query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename    text PRIMARY KEY,
      applied_at  timestamptz NOT NULL DEFAULT now()
    )
  `);
}

function migrationFiles(): string[] {
  return readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();
}

async function appliedSet(): Promise<Set<string>> {
  const { rows } = await getPool().query<{ filename: string }>(
    'SELECT filename FROM schema_migrations',
  );
  return new Set(rows.map((r) => r.filename));
}

export async function migrate(): Promise<{ applied: string[] }> {
  await ensureRegistry();
  const done = await appliedSet();
  const applied: string[] = [];
  for (const file of migrationFiles()) {
    if (done.has(file)) continue;
    const sql = readFileSync(join(migrationsDir, file), 'utf8');
    const client = await getPool().connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file]);
      await client.query('COMMIT');
      applied.push(file);
    } catch (err) {
      await client.query('ROLLBACK');
      throw new Error(`Migration ${file} failed: ${(err as Error).message}`);
    } finally {
      client.release();
    }
  }
  return { applied };
}

async function status(): Promise<void> {
  await ensureRegistry();
  const done = await appliedSet();
  for (const file of migrationFiles()) {
    console.log(`${done.has(file) ? '[applied] ' : '[pending] '}${file}`);
  }
}

if (import.meta.main) {
  const run = process.argv.includes('--status') ? status : run_apply;
  run()
    .then(() => closePool())
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err.message);
      process.exit(1);
    });
}

async function run_apply(): Promise<void> {
  const { applied } = await migrate();
  console.log(
    `Database: ${config.databaseUrl}\n` +
      (applied.length
        ? `Applied ${applied.length} migration(s):\n  ${applied.join('\n  ')}`
        : 'No pending migrations.'),
  );
}
