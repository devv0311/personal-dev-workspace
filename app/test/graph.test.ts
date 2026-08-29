// P3.2 — the Context Graph read model.
//
// The interactive graph must never become a second, weaker authorization path.
// These tests assert that the graph is assembled from the SAME scope-filtered
// repositories as every other read, and that no edge can imply a node the
// principal cannot see.

import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { resetDatabase, shutdown, baseFixture, IDS } from './helpers.ts';
import { getPool, db } from '../src/adapters/persistence/db.ts';
import { createApp } from '../src/adapters/http/server.ts';
import { buildContainer } from '../src/adapters/http/container.ts';
import { captureNote } from '../src/application/capture-note.ts';
import {
  buildContextGraph,
  inspectObject,
  type ContextGraph,
} from '../src/application/context-graph.ts';
import { asPrincipalId, asObjectId, asWorkspaceId } from '../src/domain/ids.ts';
import type { ResolvedScope } from '../src/domain/visibility.ts';

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

function share(project: string, principal: string) {
  return getPool().query(
    `INSERT INTO project_share (workspace_id, project_id, principal_id, granted_by)
     VALUES ($1,$2,$3,$4)`,
    [IDS.workspace, project, principal, IDS.alice],
  );
}

/** The invariant that makes the graph safe: no edge may name an unseen node. */
function assertNoDanglingEdges(graph: ContextGraph): void {
  const ids = new Set(graph.nodes.map((n) => n.id));
  for (const e of graph.edges) {
    assert.ok(ids.has(e.from), `edge ${e.id} references unseen node ${e.from}`);
    assert.ok(ids.has(e.to), `edge ${e.id} references unseen node ${e.to}`);
  }
}

test('the graph is built from real persisted objects, keyed by their real ids', async () => {
  const alice = await scopeFor(IDS.alice);
  const note = await captureNote(container, {
    scope: alice,
    projectId: IDS.projectA,
    title: 'Token bucket',
    body: 'O(1) per request.',
  });

  const graph = await buildContextGraph(container, alice);

  const root = graph.nodes.find((n) => n.kind === 'workspace');
  assert.ok(root, 'root context node present');
  assert.equal(root.id, IDS.workspace, 'root node is the real workspace id');
  assert.equal(root.layer, 'core');

  const projects = graph.nodes.filter((n) => n.type === 'project');
  assert.deepEqual(
    projects.map((p) => p.id).sort(),
    [IDS.projectA, IDS.projectB].sort(),
    'project nodes are the real project objects',
  );
  for (const p of projects) assert.equal(p.layer, 'context');

  const noteNode = graph.nodes.find((n) => n.id === note.id);
  assert.ok(noteNode, 'the captured note is a graph node');
  assert.equal(noteNode.type, 'note');
  assert.equal(noteNode.layer, 'memory');
  assert.equal(noteNode.title, 'Token bucket');
  assert.equal(noteNode.homeProjectId, IDS.projectA);

  assert.equal(graph.stats.projects, 2);
  assert.equal(graph.stats.captures, 1);
  assertNoDanglingEdges(graph);
});

test('relationships are represented as the real edges they are', async () => {
  const alice = await scopeFor(IDS.alice);
  const note = await captureNote(container, {
    scope: alice,
    projectId: IDS.projectA,
    body: 'anchored',
  });

  // A real, stored relationship row between the note and Project B.
  await db.transaction((tx) =>
    container.relationships.create(tx, {
      workspaceId: asWorkspaceId(IDS.workspace),
      fromObjectId: note.id,
      toObjectId: asObjectId(IDS.projectB),
      verb: 'references',
      origin: 'explicit',
      confidenceState: 'known',
      authorId: asPrincipalId(IDS.alice),
      visibilityScope: 'shared',
      provenance: { kind: 'test', detail: {} },
    }),
  );

  const graph = await buildContextGraph(container, alice);

  const belongs = graph.edges.find(
    (e) => e.from === note.id && e.to === IDS.projectA && e.verb === 'belongs_to',
  );
  assert.ok(belongs, 'the synthesised belongs_to edge is in the graph');
  assert.equal(belongs.synthesised, true);
  assert.equal(belongs.relationshipId, null);

  const ref = graph.edges.find((e) => e.verb === 'references');
  assert.ok(ref, 'the stored relationship row is in the graph');
  assert.equal(ref.from, note.id);
  assert.equal(ref.to, IDS.projectB);
  assert.equal(ref.synthesised, false);
  assert.ok(ref.relationshipId, 'a stored edge carries its row id');

  // Structural containment restates object.workspace_id — labelled as such.
  const structural = graph.edges.filter((e) => e.origin === 'structural');
  assert.equal(structural.length, 2, 'one per top-level object (the two projects)');
  for (const e of structural) {
    assert.equal(e.to, IDS.workspace);
    assert.equal(e.provenance.kind, 'structural:workspace');
  }

  // No decorative edges: every edge restates a column or a row.
  for (const e of graph.edges) {
    assert.ok(
      e.relationshipId !== null || e.synthesised,
      `edge ${e.id} must be either a stored row or an explicitly derived edge`,
    );
  }
  assertNoDanglingEdges(graph);
});

test('Bob receives no unauthorized nodes or edges (deny-by-default)', async () => {
  const alice = await scopeFor(IDS.alice);
  await captureNote(container, { scope: alice, projectId: IDS.projectA, body: 'secret A' });
  await captureNote(container, { scope: alice, projectId: IDS.projectB, body: 'secret B' });

  const bob = await scopeFor(IDS.bob);
  const graph = await buildContextGraph(container, bob);

  assert.equal(graph.nodes.length, 1, 'only the root context node');
  assert.equal(graph.nodes[0]!.kind, 'workspace');
  assert.deepEqual(graph.edges, [], 'no edges at all');
  assert.equal(graph.stats.projects, 0);
  assert.equal(graph.stats.captures, 0);
});

test('sharing one project exposes exactly that project and its context — nothing else', async () => {
  const alice = await scopeFor(IDS.alice);
  const shared = await captureNote(container, {
    scope: alice,
    projectId: IDS.projectA,
    body: 'shared context',
  });
  const private_ = await captureNote(container, {
    scope: alice,
    projectId: IDS.projectB,
    body: 'private context',
  });

  await share(IDS.projectA, IDS.bob);

  const bob = await scopeFor(IDS.bob);
  const graph = await buildContextGraph(container, bob);
  const ids = new Set(graph.nodes.map((n) => n.id));

  assert.ok(ids.has(IDS.projectA), 'the shared project is visible');
  assert.ok(ids.has(shared.id), 'context in the shared project is visible');
  assert.ok(!ids.has(IDS.projectB), 'the unshared project must not leak');
  assert.ok(!ids.has(private_.id), 'context in the unshared project must not leak');

  assertNoDanglingEdges(graph);
});

test('a private relationship does not leak through the graph', async () => {
  const alice = await scopeFor(IDS.alice);
  const n1 = await captureNote(container, { scope: alice, projectId: IDS.projectA, body: 'one' });
  const n2 = await captureNote(container, { scope: alice, projectId: IDS.projectA, body: 'two' });
  await share(IDS.projectA, IDS.bob);

  // Alice's PRIVATE edge between two objects Bob CAN see.
  await db.transaction((tx) =>
    container.relationships.create(tx, {
      workspaceId: asWorkspaceId(IDS.workspace),
      fromObjectId: n1.id,
      toObjectId: n2.id,
      verb: 'related_to',
      origin: 'explicit',
      confidenceState: 'known',
      authorId: asPrincipalId(IDS.alice),
      visibilityScope: 'private',
      provenance: { kind: 'test', detail: {} },
    }),
  );

  const aliceGraph = await buildContextGraph(container, alice);
  assert.ok(
    aliceGraph.edges.some((e) => e.verb === 'related_to'),
    'the author sees her own private edge',
  );

  const bob = await scopeFor(IDS.bob);
  const bobGraph = await buildContextGraph(container, bob);
  const ids = new Set(bobGraph.nodes.map((n) => n.id));
  assert.ok(ids.has(n1.id) && ids.has(n2.id), 'both endpoints are visible to Bob');
  assert.ok(
    !bobGraph.edges.some((e) => e.verb === 'related_to'),
    'but the private relationship itself is not',
  );
});

test('selecting a node resolves the correct underlying object, with its edges', async () => {
  const alice = await scopeFor(IDS.alice);
  const note = await captureNote(container, {
    scope: alice,
    projectId: IDS.projectA,
    title: 'Chose token-bucket',
    body: 'Sliding-window needs sorted sets.',
  });

  const inspection = await inspectObject(container, alice, note.id);
  assert.equal(inspection.object.id, note.id, 'same object as the graph node id');
  assert.equal(inspection.object.title, 'Chose token-bucket');
  assert.equal(inspection.object.body, 'Sliding-window needs sorted sets.');

  const belongs = inspection.edges.find((e) => e.edge.verb === 'belongs_to');
  assert.ok(belongs);
  assert.equal(belongs.direction, 'out');
  assert.equal(belongs.other?.id, IDS.projectA);
  assert.equal(belongs.other?.title, 'Project A');

  // A project inspection carries its real captured context.
  const project = await inspectObject(container, alice, IDS.projectA);
  assert.equal(project.children.length, 1);
  assert.equal(project.children[0]!.id, note.id);
});

test('the graph HTTP endpoints enforce the same boundary as the rest of the API', async () => {
  const alice = await scopeFor(IDS.alice);
  const note = await captureNote(container, {
    scope: alice,
    projectId: IDS.projectA,
    body: 'alice only',
  });

  // unauthenticated
  assert.equal((await fetch(`${baseUrl}/api/graph`)).status, 401);
  assert.equal((await fetch(`${baseUrl}/api/objects/${note.id}`)).status, 401);

  // Alice
  const res = await fetch(`${baseUrl}/api/graph`, { headers: as(IDS.alice) });
  assert.equal(res.status, 200);
  const graph = (await res.json()) as ContextGraph;
  assert.ok(graph.nodes.some((n) => n.id === note.id));
  assertNoDanglingEdges(graph);

  // Bob over HTTP: an empty graph, and no object detail.
  const bobRes = await fetch(`${baseUrl}/api/graph`, { headers: as(IDS.bob) });
  const bobGraph = (await bobRes.json()) as ContextGraph;
  assert.equal(bobGraph.nodes.length, 1);
  assert.equal(bobGraph.edges.length, 0);

  const detail = await fetch(`${baseUrl}/api/objects/${note.id}`, { headers: as(IDS.bob) });
  assert.equal(detail.status, 404, 'invisible and absent are indistinguishable');
});

test('the whole-graph reads agree with the per-object reads (one policy, one answer)', async () => {
  const alice = await scopeFor(IDS.alice);
  const note = await captureNote(container, { scope: alice, projectId: IDS.projectA, body: 'x' });
  await share(IDS.projectA, IDS.bob);
  const bob = await scopeFor(IDS.bob);

  for (const scope of [alice, bob]) {
    const graph = await buildContextGraph(container, scope);
    const perObject = await container.relationships.forObject(scope, note.id);
    const fromGraph = graph.edges.filter((e) => e.from === note.id || e.to === note.id);
    assert.equal(
      fromGraph.length,
      perObject.length,
      'the graph edge set for an object matches forObject()',
    );
  }
});
