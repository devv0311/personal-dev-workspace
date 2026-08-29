// Test helpers. Every test file resets the TEST database to a known-empty schema,
// then applies real migrations — proving clean initialization from empty (P2.7 §11).

import pg from 'pg';
import { migrate } from '../src/adapters/persistence/migrate.ts';
import { getPool, closePool } from '../src/adapters/persistence/db.ts';
import { config } from '../src/config.ts';

if (process.env.NODE_ENV !== 'test') {
  throw new Error('tests must run with NODE_ENV=test');
}

export async function resetDatabase(): Promise<void> {
  // Bypass the app pool for the destructive DDL.
  const admin = new pg.Client({ connectionString: config.databaseUrl });
  await admin.connect();
  try {
    await admin.query('DROP SCHEMA IF EXISTS public CASCADE');
    await admin.query('CREATE SCHEMA public');
  } finally {
    await admin.end();
  }
  const { applied } = await migrate();
  if (applied.length === 0) throw new Error('expected migrations to apply from empty');
}

export async function shutdown(): Promise<void> {
  await closePool();
}

export const IDS = {
  workspace: '00000000-0000-4000-8000-0000000000f1',
  alice: '00000000-0000-4000-8000-0000000000fa',
  bob: '00000000-0000-4000-8000-0000000000fb',
  projectA: '00000000-0000-4000-8000-0000000000c1',
  projectB: '00000000-0000-4000-8000-0000000000c2',
} as const;

/** Minimal fixture: one workspace, Alice + Bob members, Alice owns projectA & B. */
export async function baseFixture(): Promise<void> {
  const p = getPool();
  await p.query(`INSERT INTO workspace (id, name) VALUES ($1,'T')`, [IDS.workspace]);
  for (const [id, name, subj] of [
    [IDS.alice, 'Alice', 'dev:alice'],
    [IDS.bob, 'Bob', 'dev:bob'],
  ] as const) {
    await p.query(
      `INSERT INTO principal (id, workspace_id, auth_subject, display_name) VALUES ($1,$2,$3,$4)`,
      [id, IDS.workspace, subj, name],
    );
    await p.query(
      `INSERT INTO workspace_membership (workspace_id, principal_id) VALUES ($1,$2)`,
      [IDS.workspace, id],
    );
  }
  for (const [id, title] of [
    [IDS.projectA, 'Project A'],
    [IDS.projectB, 'Project B'],
  ] as const) {
    await p.query(
      `INSERT INTO object (id, workspace_id, type, title, owner_id, created_by)
       VALUES ($1,$2,'project',$3,$4,$4)`,
      [id, IDS.workspace, title, IDS.alice],
    );
  }
}

export async function freshQuery<R = unknown>(
  text: string,
  params: readonly unknown[],
): Promise<R[]> {
  // A brand-new client — used to prove persistence survives losing the app pool.
  const c = new pg.Client({ connectionString: config.databaseUrl });
  await c.connect();
  try {
    const { rows } = await c.query(text, params as unknown[]);
    return rows as R[];
  } finally {
    await c.end();
  }
}
