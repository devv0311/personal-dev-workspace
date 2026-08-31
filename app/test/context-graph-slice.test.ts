// T3.2 — the Context Graph as an interrogable product surface.
//
// P3.2 proved the read model is authorization-safe. These tests assert the
// properties the VERTICAL SLICE depends on, end to end:
//
//   real object → real node → select → reveal real relationships → inspect →
//   provenance → why-it-matters → search → the SAME object
//
// The load-bearing claim is cross-surface object identity: the graph, the
// inspector, search and the API must all resolve one object to one id. A test
// that only checked "a node exists" would not catch a second, graph-only
// representation drifting alongside the real one — so each assertion here ties
// a rendered thing back to a persisted row.

import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { resetDatabase, shutdown, baseFixture, IDS } from './helpers.ts';
import { getPool, db } from '../src/adapters/persistence/db.ts';
import { createApp } from '../src/adapters/http/server.ts';
import { buildContainer } from '../src/adapters/http/container.ts';
import { captureNote } from '../src/application/capture-note.ts';
import { buildContextGraph, inspectObject } from '../src/application/context-graph.ts';
import { asPrincipalId, asObjectId, asWorkspaceId } from '../src/domain/ids.ts';
import type { ResolvedScope } from '../src/domain/visibility.ts';
import type { ConfidenceState } from '../src/domain/relationships.ts';

let container: ReturnType<typeof buildContainer>;
let server: ReturnType<typeof createApp>;
let baseUrl = '';

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

async function scopeFor(principal: string): Promise<ResolvedScope> {
  const s = await container.scopeResolver.resolve(asPrincipalId(principal));
  assert.ok(s, 'scope should resolve');
  return s;
}

/**
 * Insert a relationship row directly at a chosen confidence state. The
 * repository's `create` is used for the states the application can author;
 * `weak` and `inferred_high` have no write path yet (relationship inference is
 * a later milestone), so they are inserted at the SQL level — which is exactly
 * the shape a future inference pass will produce.
 */
async function edgeAt(
  from: string,
  to: string,
  confidenceState: ConfidenceState,
  verb = 'related_to',
) {
  await getPool().query(
    `INSERT INTO relationship
       (workspace_id, from_object_id, to_object_id, verb, origin,
        confidence_state, author_id, visibility_scope,
        provenance_kind, provenance_detail)
     VALUES ($1,$2,$3,$4,'explicit',$5,$6,'shared','inference:test',$7)`,
    [
      IDS.workspace,
      from,
      to,
      verb,
      confidenceState,
      IDS.alice,
      JSON.stringify({ signals: ['content_similarity'] }),
    ],
  );
}

/** The worker maintains object_fts asynchronously; index directly for a test. */
async function indexAll(): Promise<void> {
  await container.retrieval.rebuild(asWorkspaceId(IDS.workspace));
}

/* ------------------------------------------------ real objects, real nodes -- */

test('every graph node is a real persisted object — nothing is fabricated', async () => {
  const alice = await scopeFor(IDS.alice);
  const one = await captureNote(container, {
    scope: alice,
    projectId: IDS.projectA,
    title: 'Token bucket',
    body: 'O(1) per request',
  });
  const two = await captureNote(container, {
    scope: alice,
    projectId: IDS.projectB,
    title: 'Retry budget',
    body: '',
  });

  const graph = await buildContextGraph(container, alice);

  // Every non-root node id must exist as a real row. This is the assertion a
  // decorative node or a synthetic "cluster" would fail.
  const { rows } = await getPool().query<{ id: string }>('SELECT id FROM object');
  const persisted = new Set(rows.map((r) => r.id));
  const rendered = graph.nodes.filter((n) => n.kind !== 'workspace');
  assert.ok(rendered.length > 0);
  for (const n of rendered) {
    assert.ok(persisted.has(n.id), `node ${n.id} (${n.title}) is not a persisted object`);
  }
  assert.equal(
    rendered.length,
    persisted.size,
    'the graph renders every visible object and no more',
  );

  // The root is the real workspace, named in PRODUCT vocabulary (blueprint §5.5).
  const root = graph.nodes.find((n) => n.kind === 'workspace');
  assert.ok(root);
  assert.equal(root.id, IDS.workspace, 'the root IS the workspace row, not a synthetic node');
  assert.equal(root.title, 'Workspace');
  assert.doesNotMatch(
    root.title.toLowerCase(),
    /claude|context core|agentic|second brain/,
    'the root must never be named after the assistant or the reference product',
  );

  // Real field content reaches the node, so the field shows what was captured.
  const node = graph.nodes.find((n) => n.id === one.id);
  assert.ok(node);
  assert.equal(node.title, 'Token bucket');
  assert.equal(node.snippet, 'O(1) per request');
  assert.equal(node.homeProjectId, IDS.projectA);
  assert.equal(node.type, 'note');
  assert.equal(graph.nodes.find((n) => n.id === two.id)?.homeProjectId, IDS.projectB);
});

test('an empty workspace renders an empty graph, not a decorative one', async () => {
  await getPool().query('DELETE FROM object');
  const alice = await scopeFor(IDS.alice);
  const graph = await buildContextGraph(container, alice);

  assert.deepEqual(
    graph.nodes.map((n) => n.kind),
    ['workspace'],
    'only the real root remains — no filler nodes are invented',
  );
  assert.deepEqual(graph.edges, [], 'and no edges are invented either');
  assert.equal(graph.stats.projects, 0);
  assert.equal(graph.stats.captures, 0);
});

/* ------------------------------------------- real relationships, preserved -- */

test('a revealed relationship keeps verb, direction, origin, confidence and provenance', async () => {
  const alice = await scopeFor(IDS.alice);
  const note = await captureNote(container, {
    scope: alice,
    projectId: IDS.projectA,
    title: 'Rate limiting',
    body: 'x',
  });

  await db.transaction((tx) =>
    container.relationships.create(tx, {
      workspaceId: asWorkspaceId(IDS.workspace),
      fromObjectId: note.id,
      toObjectId: asObjectId(IDS.projectB),
      verb: 'references',
      origin: 'explicit',
      confidenceState: 'user_confirmed',
      authorId: asPrincipalId(IDS.alice),
      visibilityScope: 'shared',
      provenance: { kind: 'user', detail: { note: 'authored in review' } },
    }),
  );

  // What the FIELD draws.
  const graph = await buildContextGraph(container, alice);
  const drawn = graph.edges.find((e) => e.verb === 'references');
  assert.ok(drawn, 'the authored edge is drawn');
  assert.equal(drawn.from, note.id, 'direction is preserved: from the note…');
  assert.equal(drawn.to, IDS.projectB, '…to the project');
  assert.equal(drawn.origin, 'explicit');
  assert.equal(drawn.confidenceState, 'user_confirmed');
  assert.equal(drawn.authorId, IDS.alice, 'authorship survives to the client');
  assert.equal(drawn.provenance.kind, 'user');
  assert.equal(drawn.synthesised, false);

  // What the INSPECTOR shows for the same object — the same edge, not a count.
  const inspected = await inspectObject(container, alice, note.id);
  const row = inspected.edges.find((e) => e.edge.verb === 'references');
  assert.ok(row, 'relationships are listed individually, never aggregated');
  assert.equal(row.direction, 'out');
  assert.equal(row.other?.id, IDS.projectB, 'the far endpoint is a real object id');
  assert.equal(row.edge.confidenceState, 'user_confirmed');
  assert.equal(row.edge.provenance.kind, 'user');
  assert.equal(row.edge.authorId, IDS.alice);
});

test('WEAK relationships never enter primary context — field or inspector (P2.2 §4)', async () => {
  const alice = await scopeFor(IDS.alice);
  const a = await captureNote(container, {
    scope: alice,
    projectId: IDS.projectA,
    title: 'Alpha',
    body: 'x',
  });
  const b = await captureNote(container, {
    scope: alice,
    projectId: IDS.projectA,
    title: 'Beta',
    body: 'y',
  });

  await edgeAt(a.id, b.id, 'weak', 'related_to');
  await edgeAt(a.id, IDS.projectB, 'inferred_high', 'references');

  const graph = await buildContextGraph(container, alice);
  const states = graph.edges.map((e) => e.confidenceState);
  assert.ok(!states.includes('weak'), 'no weak edge is drawn in the field');
  assert.ok(
    states.includes('inferred_high'),
    'inferred-high IS surfaced (it is shown, marked as inferred) — only weak is withheld',
  );

  const inspected = await inspectObject(container, alice, a.id);
  const inspectedStates = inspected.edges.map((e) => e.edge.confidenceState);
  assert.ok(!inspectedStates.includes('weak'), 'no weak edge reaches the inspector either');
  assert.ok(inspectedStates.includes('inferred_high'));

  // The withheld link must not remove its endpoint: Beta is a real visible
  // object and stays a node on its own merits.
  assert.ok(
    graph.nodes.some((n) => n.id === b.id),
    'hiding a weak RELATIONSHIP must not hide the OBJECT at its far end',
  );

  // And the row is still in the database — withheld from a view, not deleted.
  const { rows } = await getPool().query(
    `SELECT count(*)::int AS n FROM relationship WHERE confidence_state = 'weak'`,
  );
  assert.equal(rows[0].n, 1, 'the weak row is preserved, only not surfaced');
});

/* --------------------------------------------- cross-surface object identity -- */

test('one object keeps ONE identity across graph, inspector, search and the API', async () => {
  const alice = await scopeFor(IDS.alice);
  const note = await captureNote(container, {
    scope: alice,
    projectId: IDS.projectA,
    title: 'Deterministic ranking',
    body: 'same inputs, same order',
  });

  // 1. the graph node
  const graph = await buildContextGraph(container, alice);
  const node = graph.nodes.find((n) => n.title === 'Deterministic ranking');
  assert.ok(node);
  assert.equal(node.id, note.id, 'graph node id IS the persisted object id');

  // 2. the inspector, addressed by that same id
  const inspected = await inspectObject(container, alice, node.id);
  assert.equal(inspected.object.id, note.id);
  assert.equal(inspected.object.title, node.title, 'no divergent copy of the title');

  // 3. retrieval (the search index P3.4 reads) resolves the same id
  await indexAll();
  const hits = await container.retrieval.findSimilar({
    scope: alice,
    queryText: 'deterministic ranking',
    k: 10,
  });
  assert.ok(
    hits.some((h) => h.objectId === note.id),
    'search resolves to the same object id, not a search-only record',
  );

  // 4. the HTTP surface the browser actually calls
  const viaApi = await fetch(`${baseUrl}/api/objects/${note.id}`, { headers: as(IDS.alice) });
  assert.equal(viaApi.status, 200);
  const payload = (await viaApi.json()) as { object: { id: string; title: string } };
  assert.equal(payload.object.id, note.id);
  assert.equal(payload.object.title, node.title);

  // 5. and the whole-graph payload the field renders agrees with all of them
  const viaGraph = await fetch(`${baseUrl}/api/graph`, { headers: as(IDS.alice) });
  const gp = (await viaGraph.json()) as { nodes: { id: string; title: string }[] };
  const fromApi = gp.nodes.find((n) => n.id === note.id);
  assert.ok(fromApi, 'the same id appears in the graph payload');
  assert.equal(fromApi.title, node.title);

  // No duplicate representation anywhere in the payload.
  const ids = gp.nodes.map((n) => n.id);
  assert.equal(new Set(ids).size, ids.length, 'no object is represented twice');
});

/* ------------------------------------------------------ provenance survives -- */

test('object provenance reaches the inspector as real, quotable detail', async () => {
  const alice = await scopeFor(IDS.alice);
  const note = await captureNote(container, {
    scope: alice,
    projectId: IDS.projectA,
    title: 'Provenance',
    body: 'z',
  });

  const inspected = await inspectObject(container, alice, note.id);
  assert.equal(inspected.object.ownerId, IDS.alice, 'owner is real');
  assert.equal(inspected.object.createdBy, IDS.alice, 'authorship is real');
  assert.ok(inspected.object.createdAt, 'creation time is real');
  assert.equal(inspected.object.homeProjectId, IDS.projectA, 'home project is real');

  // The anchoring edge is a synthesised read-model edge and says so, so the UI
  // can never present a computed edge as an authored one.
  const anchor = inspected.edges.find((e) => e.edge.verb === 'belongs_to');
  assert.ok(anchor);
  assert.equal(anchor.edge.synthesised, true);
  assert.equal(anchor.edge.provenance.kind, 'synthesised:home_project');
});

/* ------------------------------------------------- authorization, unchanged -- */

test('the slice adds no new authorization path — Bob still sees only his share', async () => {
  const alice = await scopeFor(IDS.alice);
  const hidden = await captureNote(container, {
    scope: alice,
    projectId: IDS.projectA,
    title: 'Alice private',
    body: 'secret',
  });
  const shared = await captureNote(container, {
    scope: alice,
    projectId: IDS.projectB,
    title: 'Shared context',
    body: 'visible',
  });
  await getPool().query(
    `INSERT INTO project_share (workspace_id, project_id, principal_id, granted_by)
     VALUES ($1,$2,$3,$4)`,
    [IDS.workspace, IDS.projectB, IDS.bob, IDS.alice],
  );

  const bob = await scopeFor(IDS.bob);
  const graph = await buildContextGraph(container, bob);
  const ids = new Set(graph.nodes.map((n) => n.id));

  assert.ok(ids.has(shared.id), 'Bob sees the shared context');
  assert.ok(!ids.has(hidden.id), 'Bob never sees the unshared context');
  assert.ok(!ids.has(IDS.projectA), 'nor the unshared project');
  for (const n of graph.nodes) {
    assert.notEqual(n.title, 'Alice private');
  }

  // Edges cannot imply an unseen node.
  for (const e of graph.edges) {
    assert.ok(ids.has(e.from) && ids.has(e.to), `edge ${e.id} references an unseen node`);
  }

  // Selecting Alice's object is indistinguishable from it not existing.
  await assert.rejects(() => inspectObject(container, bob, hidden.id), /not found/i);
  const probe = await fetch(`${baseUrl}/api/objects/${hidden.id}`, { headers: as(IDS.bob) });
  assert.equal(probe.status, 404);

  // Search cannot be used as a side channel either.
  await indexAll();
  const hits = await container.retrieval.findSimilar({
    scope: bob,
    queryText: 'secret private',
    k: 10,
  });
  assert.deepEqual(hits, [], 'retrieval is pre-restricted to Bob’s scope');
});

test('a search that matches nothing returns nothing — no substitute results', async () => {
  const alice = await scopeFor(IDS.alice);
  await captureNote(container, {
    scope: alice,
    projectId: IDS.projectA,
    title: 'Token bucket',
    body: 'x',
  });

  await indexAll();
  const hits = await container.retrieval.findSimilar({
    scope: alice,
    queryText: 'zzzznonexistentterm',
    k: 10,
  });
  assert.deepEqual(hits, [], 'an empty result stays empty rather than falling back');
});
