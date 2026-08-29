import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { resetDatabase, shutdown } from './helpers.ts';
import { getPool } from '../src/adapters/persistence/db.ts';
import { createApp } from '../src/adapters/http/server.ts';
import { buildContainer } from '../src/adapters/http/container.ts';

before(async () => {
  await resetDatabase();
});
after(async () => {
  await shutdown();
});

test('migrations create a deterministic schema from empty', async () => {
  const { rows } = await getPool().query<{ table_name: string }>(
    `SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' ORDER BY table_name`,
  );
  const names = rows.map((r) => r.table_name);
  for (const expected of [
    'workspace',
    'principal',
    'workspace_membership',
    'object',
    'relationship',
    'project_share',
    'activity',
    'audit_event',
    'outbox_event',
    'object_fts',
    'schema_migrations',
  ]) {
    assert.ok(names.includes(expected), `missing table: ${expected}`);
  }
});

test('object.owner_id is NOT NULL (P2.6 review correction)', async () => {
  const { rows } = await getPool().query<{ is_nullable: string }>(
    `SELECT is_nullable FROM information_schema.columns
      WHERE table_name = 'object' AND column_name = 'owner_id'`,
  );
  assert.equal(rows[0]?.is_nullable, 'NO');
});

test('the belongs_to singular constraint exists', async () => {
  const { rows } = await getPool().query<{ indexname: string }>(
    `SELECT indexname FROM pg_indexes
      WHERE tablename = 'relationship'
        AND indexname = 'relationship_one_belongs_to_per_object'`,
  );
  assert.equal(rows.length, 1);
});

test('the app starts and /healthz reports ok against real Postgres', async () => {
  const server = createApp(buildContainer());
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/healthz`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { status: 'ok' });
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
