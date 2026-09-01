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
  explainObject,
  endpointIdentity,
  revealedLabelGroups,
  labelTextFor,
  SECTOR_GEO,
  SKILLS,
  UNFILED_SECTOR,
  layoutSectorTree,
  sectorsOf,
  sectorIndexOf,
  sectorFocusSet,
  ringPoints,
  semanticClassOf,
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
    { id: 'a1', from: 'N1', to: 'P1', verb: 'belongs_to', origin: 'structural', synthesised: true },
    { id: 'a2', from: 'N2', to: 'P1', verb: 'belongs_to', origin: 'structural', synthesised: true },
    { id: 'a3', from: 'N3', to: 'P2', verb: 'belongs_to', origin: 'structural', synthesised: true },
    { id: 'a4', from: 'N4', to: 'P2', verb: 'belongs_to', origin: 'structural', synthesised: true },
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

/* ------------------------------------------------------- T3.2 interaction --- */
// Selection is the primary graph interaction: it must reveal exactly the real
// edges incident to the selected object, with their direction intact, and
// nothing else. These run against the same graph-model.js the browser loads.

test('selection reveals exactly the selected node\'s real relationships', () => {
  const g = fixture();
  const ix = buildIndex(g);

  // Selecting the project reveals its anchors and its structural edge — the
  // edges that actually touch it, not a neighbourhood-wide sweep.
  const p1 = neighborhood(ix, 'P1', 1);
  assert.deepEqual([...p1.edgeIds].sort(), ['a1', 'a2', 's1']);
  for (const id of p1.edgeIds) {
    const e = g.edges.find((x) => x.id === id);
    assert.ok(e.from === 'P1' || e.to === 'P1', `${id} must actually touch P1`);
  }

  // Selecting a capture reveals its anchor plus its authored reference.
  const n1 = neighborhood(ix, 'N1', 1);
  assert.deepEqual([...n1.edgeIds].sort(), ['a1', 'r1']);

  // Nothing selected ⇒ nothing revealed.
  assert.deepEqual([...neighborhood(ix, 'missing', 1).edgeIds], []);
});

test('a revealed edge carries the direction the data recorded', () => {
  const g = fixture();
  const ix = buildIndex(g);
  const revealed = [...neighborhood(ix, 'N1', 1).edgeIds].map((id) =>
    ix.edges.find((e) => e.id === id),
  );

  const anchor = revealed.find((e) => e.id === 'a1');
  assert.equal(anchor.from, 'N1', 'outgoing from the selection');
  assert.equal(anchor.to, 'P1');
  assert.equal(anchor.verb, 'belongs_to', 'the verb is the data\'s, not a label we chose');

  const ref = revealed.find((e) => e.id === 'r1');
  assert.equal(ref.from, 'N1');
  assert.equal(ref.to, 'N3');
  assert.equal(ref.verb, 'references');

  // Direction as the view computes it: relative to the selected node.
  const dirFrom = (sel, e) => (e.from === sel ? 'out' : 'in');
  assert.equal(dirFrom('N1', ref), 'out');
  assert.equal(dirFrom('N3', ref), 'in', 'the same edge reads inbound from the far end');
});

test('filtering changes what is drawn without touching the underlying data', () => {
  const g = fixture();
  const ix = buildIndex(g);
  const before = ix.nodes.size;

  const noNotes = visibleNodeIds(ix, { disabledTypes: new Set(['note']) });
  assert.ok(!noNotes.has('N1') && !noNotes.has('N4'), 'notes are withheld from the view');
  assert.ok(noNotes.has('P1') && noNotes.has('W'), 'other classes are unaffected');
  assert.equal(ix.nodes.size, before, 'the graph data is unchanged');

  // The withheld nodes are still resolvable by id — filtering hid them, it did
  // not replace them with substitutes or renumber anything.
  assert.equal(ix.nodes.get('N1').title, 'Token bucket');

  // Re-enabling restores exactly the original set — no fabricated node appears.
  assert.deepEqual(
    [...visibleNodeIds(ix, { disabledTypes: new Set() })].sort(),
    [...ix.nodes.keys()].sort(),
  );
});

test('focus frames the selection\'s neighbourhood, and reset returns to the whole graph', () => {
  const g = fixture();
  const ix = buildIndex(g);
  const pos = layoutGraph(g, ix);
  const view = { x: 0, y: 0, w: 1000, h: 1000 };

  const near = neighborhood(ix, 'P2', 1);
  const focused = focusTransform(boundsOf([...near.nodeIds].map((id) => pos.get(id)), 60), view);
  const whole = focusTransform(boundsOf([...pos.values()], 60), view);

  assert.ok(focused.k > whole.k, 'focusing a neighbourhood zooms in past the whole-graph fit');

  // The focused neighbourhood lands centred — the selection stays put in space
  // rather than the graph reshuffling around it.
  const box = boundsOf([...near.nodeIds].map((id) => pos.get(id)), 60);
  assert.ok(Math.abs(focused.k * (box.x + box.w / 2) + focused.tx - 500) < 1e-6);

  // Layout is unchanged by any of it: same positions before and after.
  const again = layoutGraph(g, buildIndex(g));
  for (const [id, p] of pos) {
    assert.deepEqual({ x: p.x, y: p.y }, { x: again.get(id).x, y: again.get(id).y });
  }
});

/* --------------------------------------------- T3.2 why-it-matters + search -- */
// Reason-giving must be evidence-bearing and must never state an inference as
// fact. These assert the derivation itself, not its wording in the DOM.

test('why-it-matters explains from real fields and names its evidence', () => {
  const g = fixture();
  const byId = Object.fromEntries(g.nodes.map((n) => [n.id, n]));
  const detail = {
    object: { ...byId.N1, attributes: {} },
    children: [],
    edges: [
      {
        direction: 'out',
        other: { id: 'P1', type: 'project', title: 'API Gateway Rework' },
        edge: {
          verb: 'belongs_to', origin: 'structural', confidenceState: 'known',
          synthesised: true, relationshipId: null,
          provenance: { kind: 'synthesised:home_project' },
        },
      },
      {
        direction: 'out',
        other: { id: 'N3', type: 'note', title: 'Lexical retrieval first' },
        edge: {
          verb: 'references', origin: 'explicit', confidenceState: 'user_confirmed',
          synthesised: false, relationshipId: 'abcdef12-0000-0000-0000-000000000000',
          provenance: { kind: 'user' },
        },
      },
    ],
  };

  const { summary, reasons } = explainObject(byId.N1, detail, g);

  // Every reason carries the field/row it was derived from — nothing floats free.
  assert.ok(reasons.length > 0);
  for (const r of reasons) {
    assert.ok(r.evidence && r.evidence.length > 0, `"${r.text}" must name its evidence`);
  }

  assert.ok(reasons.some((r) => r.kind === 'identity' && /note/i.test(r.text)));
  // Dates are rendered readably and deterministically, not as raw ISO.
  const when = reasons.find((r) => r.evidence === 'object.created_at');
  assert.ok(when, 'capture time is explained');
  assert.match(when.text, /Captured 4 Jan 2026\./);
  assert.doesNotMatch(when.text, /T00:00:00/, 'no raw ISO timestamp leaks into prose');
  assert.ok(
    reasons.some((r) => r.kind === 'containment' && r.text.includes('API Gateway Rework')),
    'it says which project the object was captured into, by real title',
  );
  // Relationships appear individually, by verb and target — never as a count.
  const rel = reasons.filter((r) => r.kind === 'relationship');
  assert.equal(rel.length, 2);
  assert.ok(rel.some((r) => r.text.includes('references') && r.text.includes('Lexical retrieval first')));
  assert.ok(rel.every((r) => r.inferred === false), 'recorded facts are not marked inferred');
  assert.match(summary, /Connected to 2/);
});

test('an inferred relationship is hedged and marked; a weak one is not explained at all', () => {
  const g = fixture();
  const byId = Object.fromEntries(g.nodes.map((n) => [n.id, n]));
  const mk = (confidenceState) => ({
    direction: 'out',
    other: { id: 'N3', type: 'note', title: 'Lexical retrieval first' },
    edge: {
      verb: 'related_to', origin: 'explicit', confidenceState,
      synthesised: false, relationshipId: 'aaaaaaaa-0000-0000-0000-000000000000',
      provenance: { kind: 'inference' },
    },
  });

  const inferred = explainObject(byId.N1, { object: byId.N1, children: [], edges: [mk('inferred_high')] }, g);
  const row = inferred.reasons.find((r) => r.kind === 'relationship');
  assert.ok(row, 'an inferred link IS surfaced');
  assert.equal(row.inferred, true, 'and is flagged as inference');
  assert.match(row.text, /inferred/i, 'the hedge is in the WORDS, not only a colour');
  assert.doesNotMatch(row.text, /^related_to →/, 'it is not stated as a bare fact');
  // It must not count toward the "connected to N objects" claim.
  assert.match(inferred.summary, /Nothing links to this yet/);

  const weak = explainObject(byId.N1, { object: byId.N1, children: [], edges: [mk('weak')] }, g);
  assert.equal(
    weak.reasons.filter((r) => r.kind === 'relationship').length,
    0,
    'a weak link is never explained in primary context (P2.2 §4)',
  );
});

test('why-it-matters degrades honestly with no detail, and never invents a link', () => {
  const g = fixture();
  const byId = Object.fromEntries(g.nodes.map((n) => [n.id, n]));

  const bare = explainObject(byId.N2, null, g);
  assert.ok(bare.reasons.some((r) => r.kind === 'containment'), 'containment is known from the node alone');
  assert.equal(bare.reasons.filter((r) => r.kind === 'relationship').length, 0,
    'with no edge data it claims no relationships rather than guessing');
  assert.match(bare.summary, /Nothing links to this yet/);

  assert.deepEqual(explainObject(null), { summary: '', reasons: [] });

  // The workspace root explains itself from the real payload.
  const root = explainObject(byId.W, null, g);
  assert.match(root.reasons[0].text, /2 projects and 4 captured items/);
});

test('search resolves to real node identity, and a no-match query highlights nothing', () => {
  const g = fixture();
  const hits = searchNodes(g, 'token');
  assert.deepEqual(hits.map((n) => n.id), ['N1', 'N4']);
  // Every hit is a node already in the graph — search never invents a result.
  for (const h of hits) assert.ok(g.nodes.some((n) => n.id === h.id));

  // Spotlight semantics: the matched set is what gets lit; everything else is
  // attenuated in place, so matches keep their spatial identity.
  const pos = layoutGraph(g);
  for (const h of hits) assert.ok(pos.has(h.id), 'a match keeps the position it already had');

  assert.deepEqual(searchNodes(g, 'zzzznothing'), [], 'no match ⇒ nothing to light up');
});

/* ------------------------------------------------------- T3.2-R1 corrections */

// F2. The far end of a relationship must be named truthfully. Three states the
// product may never conflate: a titled object, a visible object that simply
// carries no title, and an endpoint the read model could not resolve at all.
test('an untitled but visible object is identified, never described as invisible', () => {
  const titled = endpointIdentity({ id: 'N1', type: 'note', title: 'Rate limiter: token bucket' });
  assert.equal(titled.text, 'Rate limiter: token bucket');
  assert.equal(titled.state, 'titled');
  assert.equal(titled.resolved, true);

  // A body-only capture is legitimate — "title optional if body set".
  const untitled = endpointIdentity({ id: '7fbf8c13-3784-4cc6-81e0-3fe5697df51e', type: 'note', title: '' });
  assert.equal(untitled.state, 'untitled');
  assert.equal(untitled.resolved, true, 'it IS visible — the title is what is missing');
  assert.match(untitled.text, /untitled note/i, 'stated by class…');
  assert.match(untitled.text, /7fbf8c13/, '…and by its real id');
  assert.doesNotMatch(untitled.text, /cannot see|outside your visibility/i);

  // Whitespace is not a title either.
  assert.equal(endpointIdentity({ id: 'x1', type: 'project', title: '   ' }).state, 'untitled');

  // Only a genuinely unresolved endpoint may speak of visibility.
  const missing = endpointIdentity(null);
  assert.equal(missing.state, 'unresolved');
  assert.equal(missing.resolved, false);
  assert.match(missing.text, /outside your visibility/i);
});

test('why-it-matters never claims an untitled object is one you cannot see', () => {
  const g = fixture();
  const byId = Object.fromEntries(g.nodes.map((n) => [n.id, n]));
  const detail = {
    object: { ...byId.P1, attributes: {} },
    children: [],
    edges: [
      {
        direction: 'in',
        other: { id: 'c680cf5f-59ea-4e77-8b98-061b9a5fd44f', type: 'note', title: '' },
        edge: {
          verb: 'belongs_to', origin: 'structural', confidenceState: 'known',
          synthesised: true, relationshipId: null,
          provenance: { kind: 'synthesised:home_project' },
        },
      },
      {
        direction: 'in',
        other: null, // the read model resolved nothing for this endpoint
        edge: {
          verb: 'references', origin: 'explicit', confidenceState: 'known',
          synthesised: false, relationshipId: 'bbbbbbbb-0000-0000-0000-000000000000',
          provenance: { kind: 'user' },
        },
      },
    ],
  };

  const rel = explainObject(byId.P1, detail, g).reasons.filter((r) => r.kind === 'relationship');
  assert.equal(rel.length, 2, 'both relationships are still explained individually');

  const [untitled, unresolved] = rel;
  assert.match(untitled.text, /untitled note · c680cf5f/i);
  assert.doesNotMatch(untitled.text, /cannot see/i, 'a visible object is not called invisible');
  assert.match(unresolved.text, /outside your visibility/i, 'the real case still says so');
});

// F4. One label per (verb, direction) — ten sibling captures are one fact, not
// ten stacked copies — with every edge preserved inside its group.
test('revealed labels group by verb and direction, and keep every edge', () => {
  const selected = 'P1';
  const edges = [
    { id: 'a1', from: 'N1', to: 'P1', verb: 'belongs_to', synthesised: true },
    { id: 'a2', from: 'N2', to: 'P1', verb: 'belongs_to', synthesised: true },
    { id: 'a3', from: 'N5', to: 'P1', verb: 'belongs_to', synthesised: true },
    { id: 's1', from: 'P1', to: 'W', verb: 'belongs_to', synthesised: true },
    { id: 'r1', from: 'P1', to: 'N3', verb: 'references', synthesised: false },
    { id: 'x1', from: 'N9', to: 'N8', verb: 'explains', synthesised: false }, // not incident
  ];

  const groups = revealedLabelGroups(edges, selected);

  // Three labels, not five: in|belongs_to, out|belongs_to, out|references.
  assert.equal(groups.length, 3);
  assert.deepEqual(
    groups.map((g) => g.key).sort(),
    ['in|belongs_to', 'out|belongs_to', 'out|references'],
  );

  // The fan of three incoming anchors is ONE label…
  const fan = groups.find((g) => g.key === 'in|belongs_to');
  assert.equal(fan.edges.length, 3, '…that still carries all three edges');
  assert.equal(labelTextFor(fan), '← belongs_to');
  assert.equal(labelTextFor(groups.find((g) => g.key === 'out|references')), '→ references');

  // No edge incident to the selection is lost, and nothing else is picked up.
  const kept = groups.flatMap((g) => g.edges.map((e) => e.id)).sort();
  assert.deepEqual(kept, ['a1', 'a2', 'a3', 'r1', 's1']);

  // Authored verbs are placed first — they say what containment geometry cannot.
  assert.equal(groups[0].key, 'out|references');
  assert.equal(groups[0].structural, false);
  assert.ok(groups.slice(1).every((g) => g.structural === true));

  // No count is produced: the label states the kind of tie, the inspector holds
  // the ties themselves (§5.3 forbids aggregate relationship counts).
  for (const g of groups) assert.doesNotMatch(labelTextFor(g), /\d/);
});

test('a selection with no relationships produces no labels at all', () => {
  assert.deepEqual(revealedLabelGroups([], 'P1'), []);
  assert.deepEqual(
    revealedLabelGroups([{ id: 'x', from: 'A', to: 'B', verb: 'references' }], 'P1'),
    [],
    'edges that do not touch the selection are never labelled',
  );
});

/* ============================================================================
   T3.2 — the ring system.

   The command ring and the Second Brain are two ring compositions over one
   dataset. What these cover is the part that must not drift: that the rings
   place REAL objects, that the same object keeps its identity across both
   projections, and that nothing in the ring vocabulary is padded with
   fabricated members to make a circle look full.
   ========================================================================== */

test('the skills ring is the product\'s real, runnable skills — not a padded circle', () => {
  // Every entry has to be a thing the shell can actually run. The count is
  // whatever that list is — the ring is never grown to match a reference.
  assert.ok(SKILLS.length > 0);
  const ids = SKILLS.map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length, 'no duplicate skill fills a slot');
  for (const c of SKILLS) {
    assert.ok(c.id && c.label && c.command && c.description, `${c.id} is fully specified`);
    assert.ok(c.engine === 'core' || c.engine === 'assistant', `${c.id} names a real engine`);
    assert.ok(!/fake|demo|placeholder|lorem/i.test(`${c.label} ${c.command} ${c.description}`));
  }
  // Exactly the four commands the Skills Deck runs, and nothing else. The two
  // that used to pad the ring — Connect (the map's own selection gesture) and
  // Search (the spotlight) — are NOT skills and must not reappear here.
  assert.deepEqual(
    SKILLS.map((c) => c.command).sort(),
    ['/ask', '/capture', '/extract-tasks', '/summarize'],
  );
});

test('ringPoints spaces a ring evenly and deterministically', () => {
  const pts = ringPoints(6, 100, { cx: 0, cy: 0, start: 0 });
  assert.equal(pts.length, 6);
  for (const p of pts) assert.ok(Math.abs(Math.hypot(p.x, p.y) - 100) < 1e-9);
  const step = pts[1].angle - pts[0].angle;
  for (let i = 1; i < pts.length; i++) {
    assert.ok(Math.abs(pts[i].angle - pts[i - 1].angle - step) < 1e-9);
  }
  assert.deepEqual(ringPoints(6, 100, { cx: 0, cy: 0, start: 0 }), pts);
});

test('semantic class follows the real object type, and the root is the core', () => {
  assert.equal(semanticClassOf(node('W', 'workspace', 'Workspace')), 'action');
  assert.equal(semanticClassOf(node('P', 'project', 'P')), 'domain');
  assert.equal(semanticClassOf(node('T', 'task', 'T')), 'temporal');
  assert.equal(semanticClassOf(node('N', 'note', 'N')), 'memory');
  assert.equal(semanticClassOf(node('D', 'decision', 'D')), 'memory');
});

/* ============================================================================
   T3.3-CORRECTION — THE RADIAL SECTOR TREE

   The old geometry was concentric rings BY DATA TYPE. What these tests pin is
   the property that replaced it: the layout states HIERARCHY. A project owns an
   angular sector; its context lives inside that sector and nowhere else; and
   focusing a project lights its branch and only its branch.
   ========================================================================== */

test('the tree is a hub, one sector per real project, and context on its own ray', () => {
  const g = fixture();
  const pos = layoutSectorTree(g);

  // Every real node is placed, and ONLY real nodes are placed: skills are drawn
  // by the view and never enter the layout as pseudo-objects.
  assert.deepEqual([...pos.keys()].sort(), g.nodes.map((n) => n.id).sort());

  const hub = pos.get('W');
  assert.deepEqual({ x: hub.x, y: hub.y }, { x: SECTOR_GEO.CX, y: SECTOR_GEO.CY });
  assert.equal(hub.band, 'core');
  assert.equal(hub.sectorId, null, 'the hub belongs to no sector');

  for (const id of ['P1', 'P2']) {
    assert.equal(pos.get(id).band, 'project');
    assert.equal(pos.get(id).sectorId, id, 'a project heads its own sector');
    assert.ok(Math.abs(pos.get(id).radius - SECTOR_GEO.R_PROJECT) < 1e-9);
  }
  for (const [id, parent] of [['N1', 'P1'], ['N2', 'P1'], ['N3', 'P2'], ['N4', 'P2']]) {
    assert.equal(pos.get(id).band, 'context');
    assert.equal(pos.get(id).sectorId, parent, `${id} is in ${parent}'s sector`);
    assert.ok(pos.get(id).radius >= SECTOR_GEO.R_CTX - 4, `${id} is outside the project ring`);
  }
});

test('sectors are contiguous, non-overlapping, and cover the circle exactly once', () => {
  for (const count of [1, 2, 3, 5, 8]) {
    const nodes = [node('W', 'workspace', 'Workspace')];
    for (let i = 0; i < count; i++) nodes.push(node(`P${i}`, 'project', `P${i}`, null, { day: i + 1 }));
    const sectors = sectorsOf({ nodes, edges: [] });
    assert.equal(sectors.length, count);
    const share = (Math.PI * 2) / count;
    for (let i = 0; i < count; i++) {
      const sc = sectors[i];
      assert.ok(Math.abs(sc.share - share) < 1e-9, 'every project gets an equal share');
      // Its own ray is the middle of its span, so context fans symmetrically.
      assert.ok(Math.abs(sc.angle - (sc.start + sc.end) / 2) < 1e-9);
      // Contiguous: this sector begins exactly where the previous one ended.
      if (i > 0) assert.ok(Math.abs(sc.start - sectors[i - 1].end) < 1e-9);
    }
    assert.ok(Math.abs(sectors[count - 1].end - sectors[0].start - Math.PI * 2) < 1e-9);
  }
});

test('context stays inside its own project\'s sector, never scattered around a ring', () => {
  const g = fixture();
  const pos = layoutSectorTree(g);
  for (const sector of sectorsOf(g)) {
    const half = (sector.share * SECTOR_GEO.FILL) / 2;
    for (const kid of sector.contextIds) {
      const delta = Math.abs(
        ((pos.get(kid).angle - sector.angle + Math.PI) % (Math.PI * 2)) - Math.PI,
      );
      assert.ok(delta <= half + 1e-6, `${kid} is inside ${sector.id}'s sector`);
      // And strictly inside the sector's own bounds — never over a boundary
      // into a sibling branch, which is what would make parentage ambiguous.
      assert.ok(delta < sector.share / 2, `${kid} does not cross a sector boundary`);
    }
  }
});

test('12 o\'clock is a sector boundary, so the vertical gutter stays clear', () => {
  for (const count of [1, 2, 3, 4, 5, 8]) {
    const nodes = [node('W', 'workspace', 'Workspace')];
    for (let i = 0; i < count; i++) nodes.push(node(`P${i}`, 'project', `P${i}`, null, { day: i + 1 }));
    const pos = layoutSectorTree({ nodes, edges: [] });
    const share = (Math.PI * 2) / count;
    for (let i = 0; i < count; i++) {
      const off = Math.abs(
        ((pos.get(`P${i}`).angle - SECTOR_GEO.START + Math.PI) % (Math.PI * 2)) - Math.PI,
      );
      assert.ok(off > share * 0.4, `with ${count} projects, P${i} is clear of the gutter`);
    }
  }
});

test('context fills outward, and an object with no project gets its own real sector', () => {
  const nodes = [node('W', 'workspace', 'Workspace'), node('P1', 'project', 'P1', null, { day: 1 })];
  // More context than one ring holds, so the next ring out has to be used.
  for (let i = 0; i < 9; i++) nodes.push(node(`N${i}`, 'note', `N${i}`, 'P1', { day: i + 2 }));
  nodes.push(node('ORPHAN', 'note', 'Unfiled', null, { day: 20 }));
  const graph = { nodes, edges: [] };
  const pos = layoutSectorTree(graph);

  const radii = [...new Set(Array.from({ length: 9 }, (_, i) => Math.round(pos.get(`N${i}`).radius / 10)))];
  assert.ok(radii.length > 1, 'nine captures reach more than one ring');

  // An unfiled object is not dropped into a data-type "inbox ring": it gets a
  // real sector of its own, with no project node, because there is no project.
  const sectors = sectorsOf(graph);
  assert.deepEqual(sectors.map((sc) => sc.id), ['P1', UNFILED_SECTOR]);
  const unfiled = sectors[1];
  assert.equal(unfiled.nodeId, null, 'no project object is invented for it');
  assert.deepEqual(unfiled.contextIds, ['ORPHAN']);
  assert.equal(pos.get('ORPHAN').sectorId, UNFILED_SECTOR);

  // A workspace with nothing unfiled has no such sector at all.
  const tidy = sectorsOf({
    nodes: nodes.filter((n) => n.id !== 'ORPHAN'),
    edges: [],
  });
  assert.deepEqual(tidy.map((sc) => sc.id), ['P1']);
});

test('sector counts are the real number of context objects in each branch', () => {
  const sectors = sectorsOf(fixture());
  assert.deepEqual(
    sectors.map((sc) => [sc.title, sc.count]),
    [['API Gateway Rework', 2], ['Context Engine', 2]],
  );
  // A project with nothing in it still gets its sector, and reports zero — the
  // map states its own emptiness rather than being filled.
  const nodes = [node('W', 'workspace', 'W'), node('P9', 'project', 'Empty', null, { day: 1 })];
  assert.equal(sectorsOf({ nodes, edges: [] })[0].count, 0);
});

test('sector focus lights one branch and dims every other', () => {
  const g = fixture();
  const index = buildIndex(g);
  const pos = layoutSectorTree(g, index);

  const lit = sectorFocusSet(index, pos, 'P1');
  // The project, its own context, and the hub the branch hangs from.
  assert.ok(lit.has('P1'));
  assert.ok(lit.has('N1') && lit.has('N2'));
  assert.ok(lit.has('W'), 'the root of the tree is not an unrelated branch');
  // N3 is lit ONLY because a real `references` edge runs N1 → N3. The
  // relationship is in the payload; nothing was added because it looked near.
  assert.ok(lit.has('N3'), 'a genuinely related object stays visible');
  assert.ok(!lit.has('N4'), 'an unrelated object in another branch is dimmed');

  // Focusing the other branch is symmetric.
  const other = sectorFocusSet(index, pos, 'P2');
  assert.ok(other.has('P2') && other.has('N3') && other.has('N4'));
  assert.ok(!other.has('N2'));

  // No focus ⇒ nothing is dimmed at all.
  assert.equal(sectorFocusSet(index, pos, null).size, 0);
  // An unknown sector dims nothing rather than dimming everything.
  assert.equal(sectorFocusSet(index, pos, 'nope').size, 0);
});

test('focus is emphasis, not filtering: every node is still in the layout', () => {
  const g = fixture();
  const index = buildIndex(g);
  const pos = layoutSectorTree(g, index);
  sectorFocusSet(index, pos, 'P1');
  assert.deepEqual([...pos.keys()].sort(), g.nodes.map((n) => n.id).sort());
  // And the sector index accounts for every placed node except the hub.
  const bySector = sectorIndexOf(pos);
  const placed = [...bySector.values()].reduce((n, set) => n + set.size, 0);
  assert.equal(placed, g.nodes.length - 1);
});

test('the same object keeps one identity across both projections', () => {
  const g = fixture();
  const wedge = layoutGraph(g);
  const tree = layoutSectorTree(g);
  assert.deepEqual([...wedge.keys()].sort(), [...tree.keys()].sort());
});

test('the layout is deterministic — the same payload never reshuffles', () => {
  const g = fixture();
  const a = layoutSectorTree(g);
  const b = layoutSectorTree(g);
  for (const [id, at] of a) {
    assert.deepEqual(at, b.get(id), `${id} keeps its place`);
  }
});
