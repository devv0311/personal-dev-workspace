import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { resetDatabase, shutdown, baseFixture, IDS } from './helpers.ts';
import { getPool } from '../src/adapters/persistence/db.ts';
import { createApp } from '../src/adapters/http/server.ts';
import { buildContainer } from '../src/adapters/http/container.ts';
import { captureNote } from '../src/application/capture-note.ts';
import { listProjects, viewProject } from '../src/application/view-project.ts';
import { asPrincipalId } from '../src/domain/ids.ts';

let container: ReturnType<typeof buildContainer>;
let baseUrl = '';
let server: ReturnType<typeof createApp>;

before(async () => {
  await resetDatabase();
  container = buildContainer();
  server = createApp(container);
  await new Promise<void>((r) => server.listen(0, r));
  const a = server.address();
  baseUrl = `http://127.0.0.1:${typeof a === 'object' && a ? a.port : 0}`;
});
beforeEach(async () => {
  await getPool().query('TRUNCATE workspace CASCADE');
  await baseFixture();
});
after(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  await shutdown();
});

const as = (id: string) => ({ authorization: `Dev ${id}` });

async function getJson<T>(path: string, headers: Record<string, string>): Promise<T> {
  const res = await fetch(`${baseUrl}${path}`, { headers });
  return (await res.json()) as T;
}
type ProjectList = { projects: Array<{ id: string }> };

test('unauthenticated API requests are rejected (deny-by-default)', async () => {
  const res = await fetch(`${baseUrl}/api/projects`);
  assert.equal(res.status, 401);
});

test('a client-supplied principal in the body is ignored (INV-4a)', async () => {
  // Bob authenticates, but tries to act as Alice via a body field.
  const res = await fetch(`${baseUrl}/api/projects/${IDS.projectA}/notes`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...as(IDS.bob) },
    body: JSON.stringify({ body: 'x', principalId: IDS.alice, ownerId: IDS.alice }),
  });
  // Bob still can't see Project A → 404, not a successful capture as Alice.
  assert.equal(res.status, 404);
  const count = await getPool().query(`SELECT count(*)::int AS n FROM object WHERE type='note'`);
  assert.equal((count.rows[0] as { n: number }).n, 0);
});

test('Bob (member, no share) cannot list, view, or capture into Alice\'s project', async () => {
  // list
  const list = await getJson<ProjectList>('/api/projects', as(IDS.bob));
  assert.deepEqual(list.projects, []);

  // view
  const view = await fetch(`${baseUrl}/api/projects/${IDS.projectA}`, { headers: as(IDS.bob) });
  assert.equal(view.status, 404);

  // capture
  const cap = await fetch(`${baseUrl}/api/projects/${IDS.projectA}/notes`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...as(IDS.bob) },
    body: JSON.stringify({ body: 'should not persist' }),
  });
  assert.equal(cap.status, 404);
  const n = await getPool().query(`SELECT count(*)::int AS n FROM object WHERE type='note'`);
  assert.equal((n.rows[0] as { n: number }).n, 0);
});

test('sharing the project makes it visible to Bob (INV-12: shares drive visibility)', async () => {
  await getPool().query(
    `INSERT INTO project_share (workspace_id, project_id, principal_id, granted_by)
     VALUES ($1,$2,$3,$4)`,
    [IDS.workspace, IDS.projectA, IDS.bob, IDS.alice],
  );

  const list = await getJson<ProjectList>('/api/projects', as(IDS.bob));
  assert.equal(list.projects.length, 1);
  assert.equal(list.projects[0]!.id, IDS.projectA);

  const view = await fetch(`${baseUrl}/api/projects/${IDS.projectA}`, { headers: as(IDS.bob) });
  assert.equal(view.status, 200);
});

test('the application-layer use cases enforce the same boundary as the HTTP layer', async () => {
  const bob = await container.scopeResolver.resolve(asPrincipalId(IDS.bob));
  assert.ok(bob);
  assert.deepEqual(await listProjects(container, bob), []);
  await assert.rejects(viewProject(container, bob, IDS.projectA), /not found/i);
  await assert.rejects(
    captureNote(container, { scope: bob, projectId: IDS.projectA, body: 'no' }),
    /not found/i,
  );
});
