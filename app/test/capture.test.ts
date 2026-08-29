import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { resetDatabase, shutdown, baseFixture, freshQuery, IDS } from './helpers.ts';
import { getPool } from '../src/adapters/persistence/db.ts';
import { buildContainer } from '../src/adapters/http/container.ts';
import { captureNote } from '../src/application/capture-note.ts';
import { viewProject } from '../src/application/view-project.ts';
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

async function aliceScope() {
  const s = await container.scopeResolver.resolve(asPrincipalId(IDS.alice));
  assert.ok(s);
  return s;
}

test('capture → persist → associate → display (the full slice path)', async () => {
  const scope = await aliceScope();

  const note = await captureNote(container, {
    scope,
    projectId: IDS.projectA,
    title: 'Chose token-bucket',
    body: 'O(1) per request; good enough for our RPS.',
  });

  assert.equal(note.type, 'note');
  assert.equal(note.homeProjectId, IDS.projectA);
  assert.equal(note.ownerId, IDS.alice);
  assert.equal(note.createdBy, IDS.alice);

  // Association is visible through the project view, read from persisted state.
  const view = await viewProject(container, scope, IDS.projectA);
  assert.equal(view.captures.length, 1);
  assert.equal(view.captures[0]!.object.id, note.id);
  assert.equal(view.captures[0]!.anchoredBy.verb, 'belongs_to');
  assert.equal(view.captures[0]!.anchoredBy.toObjectId, IDS.projectA);
  assert.equal(view.captures[0]!.anchoredBy.synthesised, true);
});

test('the captured object survives losing the application pool (real persistence)', async () => {
  const scope = await aliceScope();
  const note = await captureNote(container, {
    scope,
    projectId: IDS.projectA,
    body: 'persisted body',
  });

  // Simulate an application restart: drop the pool, query with a brand-new client.
  await shutdown();
  const rows = await freshQuery<{ id: string; body: string; home_project_id: string }>(
    `SELECT id, body, home_project_id FROM object WHERE id = $1`,
    [note.id],
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.body, 'persisted body');
  assert.equal(rows[0]!.home_project_id, IDS.projectA);

  container = buildContainer(); // rebuild for later tests
});

test('capture writes object + activity + audit + outbox in one atomic set', async () => {
  const scope = await aliceScope();
  const note = await captureNote(container, { scope, projectId: IDS.projectA, body: 'x' });

  const activity = await getPool().query(
    `SELECT kind FROM activity WHERE object_id = $1`,
    [note.id],
  );
  const audit = await getPool().query(
    `SELECT action FROM audit_event WHERE supporting_refs @> $1::jsonb`,
    [JSON.stringify([note.id])],
  );
  const outbox = await getPool().query(
    `SELECT type, payload FROM outbox_event WHERE payload->>'objectId' = $1`,
    [note.id],
  );

  assert.equal(activity.rows[0]?.kind, 'captured');
  assert.equal(audit.rows[0]?.action, 'object.captured');
  assert.equal(outbox.rows[0]?.type, 'object.created');
  assert.deepEqual(outbox.rows[0]?.payload, { objectId: note.id, kind: 'created' });
});

test('capturing into a non-existent project is rejected and writes nothing', async () => {
  const scope = await aliceScope();
  const before = await getPool().query(`SELECT count(*)::int AS n FROM object`);
  await assert.rejects(
    captureNote(container, {
      scope,
      projectId: '00000000-0000-4000-8000-0000dead0000',
      body: 'orphan',
    }),
    /not found/i,
  );
  const after = await getPool().query(`SELECT count(*)::int AS n FROM object`);
  assert.equal((before.rows[0] as { n: number }).n, (after.rows[0] as { n: number }).n);
});

test('empty capture (no title, no body) is rejected', async () => {
  const scope = await aliceScope();
  await assert.rejects(
    captureNote(container, { scope, projectId: IDS.projectA, title: '  ', body: '' }),
    /needs a title or a body/i,
  );
});
