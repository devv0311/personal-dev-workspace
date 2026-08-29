// Transactional outbox (INV-13) + state-based idempotent consumer (P2.6 §16).

import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { resetDatabase, shutdown, baseFixture, IDS } from './helpers.ts';
import { getPool } from '../src/adapters/persistence/db.ts';
import { buildContainer } from '../src/adapters/http/container.ts';
import { captureNote } from '../src/application/capture-note.ts';
import { drainOnce } from '../src/worker/index.ts';
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

async function capture(body: string) {
  const scope = await container.scopeResolver.resolve(asPrincipalId(IDS.alice));
  assert.ok(scope);
  return captureNote(container, { scope, projectId: IDS.projectA, body });
}

test('capture enqueues exactly one undelivered outbox event', async () => {
  const note = await capture('one');
  const { rows } = await getPool().query<{ n: number }>(
    `SELECT count(*)::int AS n FROM outbox_event
      WHERE payload->>'objectId' = $1 AND delivered_at IS NULL`,
    [note.id],
  );
  assert.equal(rows[0]!.n, 1);
});

test('the worker drains events and builds the derived object_fts row', async () => {
  const note = await capture('token bucket rate limiter');
  const r1 = await drainOnce();
  assert.equal(r1.processed, 1);

  const fts = await getPool().query(
    `SELECT object_id FROM object_fts WHERE object_id = $1`,
    [note.id],
  );
  assert.equal(fts.rows.length, 1);

  const undelivered = await getPool().query<{ n: number }>(
    `SELECT count(*)::int AS n FROM outbox_event WHERE delivered_at IS NULL`,
  );
  assert.equal(undelivered.rows[0]!.n, 0);
});

test('redelivery of the same event converges (state-based, idempotent)', async () => {
  const note = await capture('idempotent');
  await drainOnce();

  // Re-arm the event as if it were redelivered.
  await getPool().query(
    `UPDATE outbox_event SET delivered_at = NULL WHERE payload->>'objectId' = $1`,
    [note.id],
  );
  const r2 = await drainOnce();
  assert.equal(r2.processed, 1);

  const fts = await getPool().query<{ n: number }>(
    `SELECT count(*)::int AS n FROM object_fts WHERE object_id = $1`,
    [note.id],
  );
  assert.equal(fts.rows[0]!.n, 1, 'still exactly one derived row after reprocessing');
});

test('an update event arriving after the object is deleted does not resurrect its index row', async () => {
  const note = await capture('will be deleted');
  await drainOnce();

  // Delete the object, then hand-enqueue a stale "updated" event for it.
  await getPool().query(`DELETE FROM object WHERE id = $1`, [note.id]);
  await getPool().query(
    `INSERT INTO outbox_event (workspace_id, type, payload)
     VALUES ($1, 'object.updated', jsonb_build_object('objectId', $2::text, 'kind','updated'))`,
    [IDS.workspace, note.id],
  );

  const r = await drainOnce();
  assert.equal(r.processed, 1);
  const fts = await getPool().query<{ n: number }>(
    `SELECT count(*)::int AS n FROM object_fts WHERE object_id = $1`,
    [note.id],
  );
  assert.equal(fts.rows[0]!.n, 0, 'state-based consumer deletes the derived row for an absent object');
});
