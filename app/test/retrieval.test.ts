// P3.4 — the RetrievalProvider seam.
//
// Two implementations are exercised against the SAME contract. That is the
// point: it is what proves the seam is real (INV-11) and that eligibility rule
// 1 — "the provider pre-restricts to the visibility scope" — is a property of
// the contract rather than an accident of Postgres.

import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { resetDatabase, shutdown, baseFixture, IDS } from './helpers.ts';
import { getPool, db } from '../src/adapters/persistence/db.ts';
import { buildContainer } from '../src/adapters/http/container.ts';
import { captureNote } from '../src/application/capture-note.ts';
import { makeLexicalRetrievalProvider } from '../src/adapters/retrieval/lexical.pg.ts';
import { makeInMemoryRetrievalProvider } from '../src/adapters/retrieval/in-memory.ts';
import { asPrincipalId, asWorkspaceId } from '../src/domain/ids.ts';
import type { ResolvedScope } from '../src/domain/visibility.ts';
import type { RetrievalProvider } from '../src/ports/retrieval.ts';

let container: ReturnType<typeof buildContainer>;
let retrieval: RetrievalProvider;

before(async () => {
  await resetDatabase();
  container = buildContainer();
  retrieval = makeLexicalRetrievalProvider(db);
});
beforeEach(async () => {
  await getPool().query('TRUNCATE workspace CASCADE');
  await baseFixture();
});
after(async () => {
  await shutdown();
});

async function scopeFor(principal: string): Promise<ResolvedScope> {
  const s = await container.scopeResolver.resolve(asPrincipalId(principal));
  assert.ok(s);
  return s;
}

/** The worker maintains object_fts asynchronously; index directly for the test. */
async function indexAll(): Promise<void> {
  await retrieval.rebuild(asWorkspaceId(IDS.workspace));
}

test('lexical retrieval finds real captured objects and returns their real ids', async () => {
  const alice = await scopeFor(IDS.alice);
  const note = await captureNote(container, {
    scope: alice,
    projectId: IDS.projectA,
    title: 'Token bucket rate limiting',
    body: 'Sliding-window needs per-key sorted sets; token-bucket is O(1).',
  });
  await indexAll();

  const hits = await retrieval.findSimilar({ scope: alice, queryText: 'token bucket', k: 10 });
  assert.ok(hits.length > 0, 'the captured note is retrievable');
  const hit = hits.find((h) => h.objectId === note.id);
  assert.ok(hit, 'the hit carries the real object id — identity is preserved');
  assert.ok(hit.score > 0);
  assert.ok(hit.evidence.length > 0, 'evidence explains why it matched');
});

test('retrieval returns nothing rather than failing when nothing matches', async () => {
  const alice = await scopeFor(IDS.alice);
  await captureNote(container, { scope: alice, projectId: IDS.projectA, body: 'token bucket' });
  await indexAll();

  assert.deepEqual(await retrieval.findSimilar({ scope: alice, queryText: 'kubernetes', k: 5 }), []);
  assert.deepEqual(await retrieval.findSimilar({ scope: alice, queryText: '', k: 5 }), []);
  assert.deepEqual(await retrieval.findSimilar({ scope: alice, queryText: '   ', k: 5 }), []);
});

test('the provider PRE-RESTRICTS to the scope — Bob cannot retrieve Alice\'s text', async () => {
  const alice = await scopeFor(IDS.alice);
  await captureNote(container, {
    scope: alice,
    projectId: IDS.projectA,
    title: 'Token bucket rate limiting',
    body: 'Alice-only reasoning about rate limits.',
  });
  await indexAll();

  const bob = await scopeFor(IDS.bob);
  const bobHits = await retrieval.findSimilar({ scope: bob, queryText: 'token bucket', k: 10 });
  assert.deepEqual(bobHits, [], 'the index is shared; the visibility predicate is not optional');

  const aliceHits = await retrieval.findSimilar({ scope: alice, queryText: 'token bucket', k: 10 });
  assert.ok(aliceHits.length > 0, 'the same query works for the owner — the difference is the scope');
});

test('sharing a project makes exactly its context retrievable, and nothing else', async () => {
  const alice = await scopeFor(IDS.alice);
  const shared = await captureNote(container, {
    scope: alice,
    projectId: IDS.projectA,
    title: 'Rate limiting decision',
    body: 'shared reasoning',
  });
  const hidden = await captureNote(container, {
    scope: alice,
    projectId: IDS.projectB,
    title: 'Rate limiting elsewhere',
    body: 'hidden reasoning',
  });
  await getPool().query(
    `INSERT INTO project_share (workspace_id, project_id, principal_id, granted_by)
     VALUES ($1,$2,$3,$4)`,
    [IDS.workspace, IDS.projectA, IDS.bob, IDS.alice],
  );
  await indexAll();

  const bob = await scopeFor(IDS.bob);
  const ids = (await retrieval.findSimilar({ scope: bob, queryText: 'rate limiting', k: 10 })).map(
    (h) => h.objectId as string,
  );
  assert.ok(ids.includes(shared.id), 'context in the shared project is retrievable');
  assert.ok(!ids.includes(hidden.id), 'context in the unshared project is not');
});

test('rebuild reconstructs the derived index from authoritative rows alone (INV-6)', async () => {
  const alice = await scopeFor(IDS.alice);
  await captureNote(container, { scope: alice, projectId: IDS.projectA, title: 'Token bucket', body: 'x' });

  await getPool().query('DELETE FROM object_fts');
  assert.deepEqual(await retrieval.findSimilar({ scope: alice, queryText: 'token', k: 5 }), []);

  await retrieval.rebuild(asWorkspaceId(IDS.workspace));
  const after = await retrieval.findSimilar({ scope: alice, queryText: 'token', k: 5 });
  assert.ok(after.length > 0, 'the index is fully rebuildable from `object`');
});

test('the in-memory provider honours the SAME contract and the same policy', async () => {
  // A second implementation with no datastore at all. If the port ever leaked a
  // SQL fragment or a driver type, this could not exist.
  const alice = await scopeFor(IDS.alice);
  const bob = await scopeFor(IDS.bob);

  const inMemory = makeInMemoryRetrievalProvider([
    {
      id: 'aaaaaaaa-0000-4000-8000-00000000000a',
      workspace_id: IDS.workspace,
      owner_id: IDS.alice,
      home_project_id: IDS.projectA,
      title: 'Token bucket rate limiting',
      body: 'Alice-only reasoning.',
      created_at: '2026-01-01T00:00:00.000Z',
    },
  ]);

  const aliceHits = await inMemory.findSimilar({ scope: alice, queryText: 'token bucket', k: 5 });
  assert.equal(aliceHits.length, 1, 'the owner retrieves it');
  assert.equal(aliceHits[0]!.objectId, 'aaaaaaaa-0000-4000-8000-00000000000a');

  const bobHits = await inMemory.findSimilar({ scope: bob, queryText: 'token bucket', k: 5 });
  assert.deepEqual(bobHits, [], 'a provider with no SQL still enforces the same visibility rule');

  assert.equal(inMemory.describe().kind, 'lexical');
});
