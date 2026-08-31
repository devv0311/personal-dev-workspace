// T3.3.4 — the Routines surface reads REAL background-execution records, and
// reads them through the authorization boundary.
//
// Two properties are asserted here, and they are the two that make the
// difference between an honest surface and a decorative one:
//
//   1. A row's state is the row's own state. `delivered` / `pending` /
//      `dead_lettered` are read from `delivered_at` and `dead_lettered`, and a
//      run's timestamp is the instant the worker actually recorded — never a
//      render-time clock, and never a synthesised schedule.
//   2. The counts are SCOPED. An outbox row names an object. Left unscoped, a
//      count would tell a member with no shares exactly how much activity
//      another member's invisible objects produced. Every count and every row
//      below passes through the same VisibilityPolicy as any other read.

import test from 'node:test';
import assert from 'node:assert/strict';

import { resetDatabase, shutdown, baseFixture, IDS } from './helpers.ts';
import { buildContainer } from '../src/adapters/http/container.ts';
import { captureNote } from '../src/application/capture-note.ts';
import { readWorkerActivity } from '../src/application/worker-activity.ts';
import { drainOnce } from '../src/worker/index.ts';
import { consumerFor } from '../src/worker/registry.ts';
import { asPrincipalId } from '../src/domain/ids.ts';
import { getPool } from '../src/adapters/persistence/db.ts';
import type { ResolvedScope } from '../src/domain/visibility.ts';

const container = () => buildContainer();
const POLL = 1000;

async function scopes(): Promise<{ alice: ResolvedScope; bob: ResolvedScope }> {
  const c = container();
  const alice = await c.scopeResolver.resolve(asPrincipalId(IDS.alice));
  const bob = await c.scopeResolver.resolve(asPrincipalId(IDS.bob));
  assert.ok(alice && bob);
  return { alice, bob };
}

test('a routine is attributed only to the consumer actually registered for it', () => {
  // The surface and the worker read the SAME registration, so a run can never
  // be attributed to a consumer that does not handle that event type.
  assert.equal(consumerFor('object.created'), 'fts-maintenance');
  assert.equal(consumerFor('object.updated'), 'fts-maintenance');
  // An unregistered type gets null — the surface says "no registered consumer"
  // rather than crediting the delivery to one that never ran.
  assert.equal(consumerFor('billing.invoiced'), null);
});

test('an empty queue reports an empty queue, not a fabricated schedule', async () => {
  await resetDatabase();
  await baseFixture();
  const { alice } = await scopes();

  const view = await readWorkerActivity(container(), alice, POLL);
  assert.equal(view.engine, 'outbox-worker');
  // The product has no clock-based scheduler and the payload says so, so no
  // surface built on it can print a fire time or a next run.
  assert.equal(view.scheduled, false);
  assert.equal(view.pollIntervalMs, POLL);
  assert.deepEqual(
    { d: view.delivered, p: view.pending, x: view.deadLettered, last: view.lastDeliveredAt },
    { d: 0, p: 0, x: 0, last: null },
  );
  assert.deepEqual(view.runs, []);
});

test('a capture produces a real pending record, and draining turns it into a real delivery', async () => {
  await resetDatabase();
  await baseFixture();
  const c = container();
  const { alice } = await scopes();

  const note = await captureNote(c, {
    scope: alice,
    projectId: IDS.projectA,
    title: 'a real capture',
    body: 'with a real body',
  });

  const queued = await readWorkerActivity(c, alice, POLL);
  assert.equal(queued.pending, 1);
  assert.equal(queued.delivered, 0);
  assert.equal(queued.lastDeliveredAt, null);
  const pendingRun = queued.runs[0]!;
  assert.equal(pendingRun.state, 'pending');
  assert.equal(pendingRun.event, 'object.created');
  assert.equal(pendingRun.routine, 'fts-maintenance');
  // The run names the REAL object it concerns, by id and by its live title —
  // which is what lets the row open that object on the map (T3.3.11).
  assert.equal(pendingRun.objectId, note.id);
  assert.equal(pendingRun.objectTitle, 'a real capture');
  assert.equal(pendingRun.attempts, 0);

  const drained = await drainOnce();
  assert.equal(drained.processed, 1);

  const after = await readWorkerActivity(c, alice, POLL);
  assert.equal(after.delivered, 1);
  assert.equal(after.pending, 0);
  assert.ok(after.lastDeliveredAt, 'a delivery must carry the instant it happened');
  const run = after.runs[0]!;
  assert.equal(run.state, 'delivered');
  assert.equal(run.attempts, 1);
  // The timestamp is the recorded delivery, not the moment of this read.
  assert.equal(run.at, after.lastDeliveredAt);
  assert.ok(new Date(run.at).getTime() <= Date.now());
});

test('a dead-lettered row is reported as dead-lettered, never as a success', async () => {
  await resetDatabase();
  await baseFixture();
  const c = container();
  const { alice } = await scopes();
  const note = await captureNote(c, {
    scope: alice,
    projectId: IDS.projectA,
    title: 'doomed',
    body: '',
  });

  await getPool().query(
    `UPDATE outbox_event SET dead_lettered = true, attempts = 5
      WHERE payload->>'objectId' = $1`,
    [note.id],
  );

  const view = await readWorkerActivity(c, alice, POLL);
  assert.equal(view.deadLettered, 1);
  assert.equal(view.delivered, 0);
  assert.equal(view.pending, 0);
  assert.equal(view.runs[0]!.state, 'dead_lettered');
  assert.equal(view.runs[0]!.attempts, 5);
});

test('execution records honour the authorization boundary', async () => {
  await resetDatabase();
  await baseFixture();
  const c = container();
  const { alice } = await scopes();

  // Two captures in a project Bob cannot see, one in a project he can.
  await captureNote(c, { scope: alice, projectId: IDS.projectA, title: 'hidden one', body: '' });
  await captureNote(c, { scope: alice, projectId: IDS.projectA, title: 'hidden two', body: '' });
  await captureNote(c, { scope: alice, projectId: IDS.projectB, title: 'shared one', body: '' });
  await getPool().query(
    `INSERT INTO project_share (workspace_id, project_id, principal_id, granted_by)
     VALUES ($1, $2, $3, $4)`,
    [IDS.workspace, IDS.projectB, IDS.bob, IDS.alice],
  );
  await drainOnce();

  const forAlice = await readWorkerActivity(c, alice, POLL);
  assert.equal(forAlice.delivered, 3);

  const bob = await c.scopeResolver.resolve(asPrincipalId(IDS.bob));
  assert.ok(bob);
  const forBob = await readWorkerActivity(c, bob, POLL);

  // Bob's COUNT is scoped too, not just his rows: an unscoped total would leak
  // the volume of work Alice's invisible objects generated.
  assert.equal(forBob.delivered, 1);
  assert.deepEqual(forBob.runs.map((r) => r.objectTitle), ['shared one']);
  const titles = JSON.stringify(forBob);
  assert.equal(titles.includes('hidden one'), false);
  assert.equal(titles.includes('hidden two'), false);
});

test.after(async () => {
  await shutdown();
});
