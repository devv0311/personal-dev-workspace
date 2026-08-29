// P3.2 — the graph's interaction logic (layout, neighbourhood, search, filter,
// focus). Pure functions, so they are tested directly rather than through a
// browser. This file is JavaScript because the module it tests ships to the
// browser as JavaScript — the same file the UI loads, not a copy.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  GEO,
  ZOOM,
  buildIndex,
  layoutGraph,
  neighborhood,
  visibleNodeIds,
  collapsibleIds,
  filterChipsFor,
  searchNodes,
  boundsOf,
  focusTransform,
  zoomAbout,
  clampZoom,
  wedgeSlot,
  pulseLinkTarget,
  recentActivity,
} from '../src/adapters/web/graph-model.js';

const node = (id, type, title, homeProjectId = null, extra = {}) => ({
  id,
  kind: type === 'workspace' ? 'workspace' : 'object',
  type,
  layer: type === 'workspace' ? 'core' : type === 'project' ? 'context' : 'memory',
  title,
  snippet: extra.snippet ?? '',
  homeProjectId,
  createdAt: extra.createdAt ?? `2026-01-${String(extra.day ?? 1).padStart(2, '0')}T00:00:00.000Z`,
});

/** Mirrors the /api/graph payload shape for two projects and four captures. */
function fixture() {
  const nodes = [
    node('W', 'workspace', 'Context Core'),
    node('P1', 'project', 'API Gateway Rework', null, { day: 2 }),
    node('P2', 'project', 'Context Engine', null, { day: 3 }),
    node('N1', 'note', 'Token bucket', 'P1', { day: 4, snippet: 'O(1) per request' }),
    node('N2', 'note', 'Retry budget', 'P1', { day: 5 }),
    node('N3', 'note', 'Lexical retrieval first', 'P2', { day: 6 }),
    node('N4', 'note', 'Ranking is deterministic', 'P2', { day: 7, snippet: 'token order' }),
  ];
  const edges = [
    { id: 'a1', from: 'N1', to: 'P1', verb: 'belongs_to', origin: 'explicit', synthesised: true },
    { id: 'a2', from: 'N2', to: 'P1', verb: 'belongs_to', origin: 'explicit', synthesised: true },
    { id: 'a3', from: 'N3', to: 'P2', verb: 'belongs_to', origin: 'explicit', synthesised: true },
    { id: 'a4', from: 'N4', to: 'P2', verb: 'belongs_to', origin: 'explicit', synthesised: true },
    { id: 'r1', from: 'N1', to: 'N3', verb: 'references', origin: 'explicit', synthesised: false },
    { id: 's1', from: 'P1', to: 'W', verb: 'belongs_to', origin: 'structural', synthesised: true },
    { id: 's2', from: 'P2', to: 'W', verb: 'belongs_to', origin: 'structural', synthesised: true },
  ];
  return { nodes, edges, stats: { projects: 2, captures: 4 } };
}

test('the index reconstructs containment and adjacency from the payload', () => {
  const ix = buildIndex(fixture());
  assert.equal(ix.rootId, 'W');
  assert.deepEqual(ix.childrenOf.get('P1'), ['N1', 'N2']);
  assert.deepEqual(ix.childrenOf.get('W'), ['P1', 'P2']);
  assert.equal(ix.parentOf.get('N3'), 'P2');
  assert.equal(ix.parentOf.get('P1'), 'W');
  assert.deepEqual([...ix.adjacency.get('P1')].sort(), ['N1', 'N2', 'W']);
});

test('an edge naming an unknown node is dropped rather than drawn', () => {
  const g = fixture();
  g.edges.push({ id: 'ghost', from: 'N1', to: 'NOT-VISIBLE', verb: 'related_to' });
  const ix = buildIndex(g);
  assert.ok(!ix.edges.some((e) => e.id === 'ghost'));
  assert.ok(!(ix.adjacency.get('N1') ?? new Set()).has('NOT-VISIBLE'));
});

test('layout is deterministic and puts each capture inside its project wedge', () => {
  const g = fixture();
  const a = layoutGraph(g);
  const b = layoutGraph(g);
  for (const [id, p] of a) {
    assert.deepEqual({ x: p.x, y: p.y }, { x: b.get(id).x, y: b.get(id).y }, `${id} is stable`);
  }

  assert.deepEqual({ x: a.get('W').x, y: a.get('W').y }, { x: GEO.CX, y: GEO.CY });

  for (const [projectId, kids] of [
    ['P1', ['N1', 'N2']],
    ['P2', ['N3', 'N4']],
  ]) {
    const base = a.get(projectId).angle;
    for (const kid of kids) {
      const k = a.get(kid);
      const delta = Math.abs(((k.angle - base + Math.PI) % (Math.PI * 2)) - Math.PI);
      assert.ok(delta <= GEO.WEDGE_HALF, `${kid} sits in ${projectId}'s wedge (${delta.toFixed(3)})`);
      assert.ok(
        k.radius > GEO.R_PROJ && k.radius < GEO.R_MEM,
        `${kid} sits in the memory band (r=${k.radius.toFixed(1)})`,
      );
    }
  }
});

test('wedge slots widen with each ring so dense projects stay legible', () => {
  assert.deepEqual(wedgeSlot(0), { ring: 0, slot: 0, capacity: 3 });
  assert.deepEqual(wedgeSlot(2), { ring: 0, slot: 2, capacity: 3 });
  assert.deepEqual(wedgeSlot(3), { ring: 1, slot: 0, capacity: 5 });
  assert.deepEqual(wedgeSlot(8), { ring: 2, slot: 0, capacity: 7 });
});

test('the neighbourhood of a node is what selection highlights', () => {
  const ix = buildIndex(fixture());
  const one = neighborhood(ix, 'N1', 1);
  assert.deepEqual([...one.nodeIds].sort(), ['N1', 'N3', 'P1']);
  assert.deepEqual([...one.edgeIds].sort(), ['a1', 'r1']);

  const two = neighborhood(ix, 'N1', 2);
  assert.ok(two.nodeIds.has('W'), 'two hops reaches the root through the project');
  assert.ok(two.nodeIds.has('P2'), 'two hops reaches the referenced note\'s project');

  assert.deepEqual([...neighborhood(ix, 'nope', 1).nodeIds], []);
});

test('search finds nodes by title then body, best match first', () => {
  const g = fixture();
  assert.deepEqual(searchNodes(g, 'token').map((n) => n.id), ['N1', 'N4']);
  assert.deepEqual(searchNodes(g, 'RANKING').map((n) => n.id), ['N4']);
  assert.deepEqual(searchNodes(g, 'zzz'), []);
  assert.deepEqual(searchNodes(g, '   '), []);
  assert.equal(searchNodes(g, 'e', 2).length, 2, 'respects the result limit');
});

test('type filters hide nodes from the view without touching the data', () => {
  const g = fixture();
  const ix = buildIndex(g);

  assert.equal(visibleNodeIds(ix).size, 7);

  const noNotes = visibleNodeIds(ix, { disabledTypes: new Set(['note']) });
  assert.deepEqual([...noNotes].sort(), ['P1', 'P2', 'W']);
  assert.equal(ix.nodes.size, 7, 'the underlying graph is unchanged');

  const chips = filterChipsFor(g);
  assert.deepEqual(
    chips.map((c) => [c.key, c.count]),
    [
      ['workspace', 1],
      ['project', 2],
      ['note', 4],
    ],
  );
});

test('collapsing a project hides its context but keeps it in the graph', () => {
  const ix = buildIndex(fixture());
  assert.deepEqual(collapsibleIds(ix).sort(), ['P1', 'P2']);

  const collapsed = visibleNodeIds(ix, { collapsed: new Set(['P1']) });
  assert.ok(collapsed.has('P1'), 'the project itself stays visible');
  assert.ok(!collapsed.has('N1') && !collapsed.has('N2'), 'its captures are hidden');
  assert.ok(collapsed.has('N3'), 'another project is unaffected');
  assert.equal(ix.nodes.size, 7, 'nothing was removed from the data');
});

test('focus fits the chosen neighbourhood into the visible area', () => {
  const pos = layoutGraph(fixture());
  const ix = buildIndex(fixture());
  const near = neighborhood(ix, 'P1', 1);
  const pts = [...near.nodeIds].map((id) => pos.get(id)).filter(Boolean);
  const box = boundsOf(pts, 60);

  const view = { x: 0, y: 0, w: 1000, h: 1000 };
  const t = focusTransform(box, view);

  // The neighbourhood's centre lands on the centre of the view.
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  assert.ok(Math.abs(t.k * cx + t.tx - 500) < 1e-6);
  assert.ok(Math.abs(t.k * cy + t.ty - 500) < 1e-6);
  assert.ok(t.k > 1, 'focusing a small neighbourhood zooms in');
  assert.ok(t.k <= 2.6, 'but not past the focus ceiling');
});

test('zoom keeps the point under the cursor fixed, and stays within bounds', () => {
  const start = { k: 1, tx: 0, ty: 0 };
  const anchor = { x: 320, y: 640 };
  const zoomed = zoomAbout(start, 2, anchor);
  assert.equal(zoomed.k, 2);
  assert.ok(Math.abs(zoomed.k * anchor.x + zoomed.tx - (start.k * anchor.x + start.tx)) < 1e-9);
  assert.ok(Math.abs(zoomed.k * anchor.y + zoomed.ty - (start.k * anchor.y + start.ty)) < 1e-9);

  assert.equal(clampZoom(1e6), ZOOM.MAX);
  assert.equal(clampZoom(0), ZOOM.MIN);
  assert.equal(zoomAbout({ k: ZOOM.MAX, tx: 0, ty: 0 }, 4, anchor).k, ZOOM.MAX);
});

/* ---------------------------------------------------- dashboard (P3.3) --- */
// Project Pulse's header link and "Context activity" grid are pure
// projections of the same graph payload the centre panel already holds —
// these tests are the guarantee that they can never diverge from it, and
// that every id they hand back is one the graph itself already contains
// (never a second, competing identity).

test('pulseLinkTarget resolves the same project identity everywhere', () => {
  const g = fixture();
  const byId = Object.fromEntries(g.nodes.map((n) => [n.id, n]));

  assert.equal(pulseLinkTarget(null), null, 'nothing selected → no link');
  assert.equal(pulseLinkTarget(byId.W), null, 'the workspace root is not one project');
  assert.equal(pulseLinkTarget(byId.P1), 'P1', 'a project links to itself');
  assert.equal(pulseLinkTarget(byId.N1), 'P1', "a capture links to its home project");
});

test('recentActivity scopes to the selected project\'s own captures, most recent first', () => {
  const g = fixture();
  const byId = Object.fromEntries(g.nodes.map((n) => [n.id, n]));
  // Mirrors what GET /api/objects/:id returns for a project: its own already
  // visibility-filtered children, as WorkspaceObject rows (createdAt, body).
  const detail = {
    children: [
      { id: 'N1', title: 'Token bucket', body: '', createdAt: byId.N1.createdAt },
      { id: 'N2', title: 'Retry budget', body: '', createdAt: byId.N2.createdAt },
    ],
  };

  const { items, total } = recentActivity(g, byId.P1, detail);
  assert.equal(total, 2);
  assert.deepEqual(items.map((i) => i.id), ['N2', 'N1'], 'most recently captured first');
  // Every id returned is one the graph already contains — never invented.
  for (const item of items) assert.ok(g.nodes.some((n) => n.id === item.id));
});

test('recentActivity falls back to the selected object\'s home-project siblings', () => {
  const g = fixture();
  const byId = Object.fromEntries(g.nodes.map((n) => [n.id, n]));

  // Selecting a capture itself (not its project) still scopes to that
  // capture's project — its siblings — not the whole workspace.
  const { items, total } = recentActivity(g, byId.N1, /* detail */ null);
  assert.equal(total, 2, "only P1's own captures");
  assert.deepEqual(items.map((i) => i.id).sort(), ['N1', 'N2']);
});

test('recentActivity is global when nothing ties the selection to one project', () => {
  const g = fixture();
  const byId = Object.fromEntries(g.nodes.map((n) => [n.id, n]));

  const nothingSelected = recentActivity(g, null, null);
  assert.equal(nothingSelected.total, 4, 'every capture in the graph');

  const workspaceSelected = recentActivity(g, byId.W, null);
  assert.equal(workspaceSelected.total, 4, 'the workspace root has no single project either');

  assert.deepEqual(
    nothingSelected.items.map((i) => i.id),
    workspaceSelected.items.map((i) => i.id),
    'the same real objects, the same order, regardless of why nothing is scoped',
  );
});

test('recentActivity caps the display list but reports the true total', () => {
  const nodes = [{ ...fixture().nodes[1] }]; // P1
  for (let i = 0; i < 25; i++) {
    nodes.push({
      id: `many-${i}`,
      kind: 'object',
      type: 'note',
      layer: 'memory',
      title: `Note ${i}`,
      snippet: '',
      homeProjectId: 'P1',
      createdAt: `2026-02-${String((i % 27) + 1).padStart(2, '0')}T00:00:00.000Z`,
    });
  }
  const g = { nodes, edges: [] };
  const { items, total } = recentActivity(g, nodes[0], null, 20);
  assert.equal(total, 25, 'the metric is never truncated');
  assert.equal(items.length, 20, 'the fixed-size grid is');
});
