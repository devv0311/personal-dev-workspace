// Atomicity of the capture write set (P2.6 §12.4): if any step fails, the whole
// transaction rolls back — no partial object/activity/audit/outbox.

import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { resetDatabase, shutdown, baseFixture, IDS } from './helpers.ts';
import { getPool } from '../src/adapters/persistence/db.ts';
import { buildContainer } from '../src/adapters/http/container.ts';
import { captureNote } from '../src/application/capture-note.ts';
import { asPrincipalId } from '../src/domain/ids.ts';

let container: ReturnType<typeof buildContainer>;

before(async () => {
  await resetDatabase();
  container = buildContainer();
});
beforeEach(async () => {
  await getPool().query('TRUNCATE workspace CASCADE');
  await baseFixture();
});
after(async () => {
  await shutdown();
});

test('a failure in the outbox write rolls back the whole capture', async () => {
  const scope = await container.scopeResolver.resolve(asPrincipalId(IDS.alice));
  assert.ok(scope);

  // Poison the outbox writer for this call only.
  const poisoned = {
    ...container,
    outbox: {
      append: async () => {
        throw new Error('simulated outbox failure');
      },
    },
  };

  await assert.rejects(
    captureNote(poisoned, { scope, projectId: IDS.projectA, body: 'should not persist' }),
    /simulated outbox failure/,
  );

  const objects = await getPool().query<{ n: number }>(
    `SELECT count(*)::int AS n FROM object WHERE type = 'note'`,
  );
  const activity = await getPool().query<{ n: number }>(
    `SELECT count(*)::int AS n FROM activity`,
  );
  const audit = await getPool().query<{ n: number }>(
    `SELECT count(*)::int AS n FROM audit_event`,
  );
  const outbox = await getPool().query<{ n: number }>(
    `SELECT count(*)::int AS n FROM outbox_event`,
  );

  assert.equal(objects.rows[0]!.n, 0, 'no note persisted');
  assert.equal(activity.rows[0]!.n, 0, 'no activity persisted');
  assert.equal(audit.rows[0]!.n, 0, 'no audit persisted');
  assert.equal(outbox.rows[0]!.n, 0, 'no outbox event persisted');
});

test('a successful capture after a failed one persists cleanly', async () => {
  const scope = await container.scopeResolver.resolve(asPrincipalId(IDS.alice));
  assert.ok(scope);
  const note = await captureNote(container, { scope, projectId: IDS.projectA, body: 'ok' });
  const row = await getPool().query(`SELECT id FROM object WHERE id = $1`, [note.id]);
  assert.equal(row.rows.length, 1);
});
