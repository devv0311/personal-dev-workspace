// P3.2 — Context Graph model. PURE: no DOM, no fetch, no globals.
//
// Everything here is a deterministic function of the /api/graph payload plus
// view state, so the interaction logic (layout, neighbourhood, search, filter,
// focus) is testable without a browser. graph-view.js owns all DOM.
//
// The layout deliberately reproduces the ACCEPTED P3.1 geometry: a workspace
// core at the centre, projects on an inner ring, and each project's captured
// context fanning outward through the memory band inside that project's wedge.
// In P3.1 the wedge was a synthetic dot-cluster "sized by" the capture count.
// Here the lit dots ARE the captures.

export const GEO = {
  CX: 500,
  CY: 500,
  R_MEM: 338, // context band outer edge
  R_PROJ: 128, // project ring
  R_IN: 168, // first capture ring
  R_OUT: 324, // last capture ring
  WEDGE_HALF: 0.46, // ~26° half-width per project fan
  START: -Math.PI / 2 + 0.55, // first project at ~10 o'clock
};

export const ZOOM = { MIN: 0.35, MAX: 6, STEP: 1.22 };

/** Presentation metadata per real object type. `accent` is a neutral hook only
 *  — object class is carried by its name in text, never by hue (§4.13, §5.4).
 *  `layer` groups the three structural kinds (root / container / context) that
 *  the deterministic layout places; it is not a colour taxonomy.
 *  Extending the domain vocabulary is a one-line change here. */
export const TYPE_META = {
  workspace: { label: 'Workspace', plural: 'Workspace', layer: 'core', accent: 'core', r: 0 },
  project: { label: 'Project', plural: 'Projects', layer: 'context', accent: 'context', r: 8 },
  task: { label: 'Task', plural: 'Tasks', layer: 'context', accent: 'node', r: 5 },
  note: { label: 'Note', plural: 'Notes', layer: 'memory', accent: 'node', r: 4.2 },
  idea: { label: 'Idea', plural: 'Ideas', layer: 'memory', accent: 'node', r: 4.2 },
  decision: { label: 'Decision', plural: 'Decisions', layer: 'memory', accent: 'node', r: 4.6 },
  resource: { label: 'Resource', plural: 'Resources', layer: 'memory', accent: 'node', r: 4.2 },
  checkpoint: { label: 'Checkpoint', plural: 'Checkpoints', layer: 'memory', accent: 'node', r: 4.6 },
};

export const metaFor = (type) => TYPE_META[type] ?? TYPE_META.note;

/* ------------------------------------------------------------------ index -- */

/** Adjacency + incidence over the graph payload. Built once per data load. */
export function buildIndex(graph) {
  const nodes = new Map();
  for (const n of graph.nodes ?? []) nodes.set(n.id, n);

  const edges = (graph.edges ?? []).filter((e) => nodes.has(e.from) && nodes.has(e.to));
  const adjacency = new Map();
  const incident = new Map();
  const childrenOf = new Map();

  const link = (a, b, e) => {
    if (!adjacency.has(a)) adjacency.set(a, new Set());
    adjacency.get(a).add(b);
    if (!incident.has(a)) incident.set(a, []);
    incident.get(a).push(e);
  };
  for (const e of edges) {
    link(e.from, e.to, e);
    link(e.to, e.from, e);
  }

  // Structural parent: home project, else the workspace root.
  const rootId = (graph.nodes ?? []).find((n) => n.kind === 'workspace')?.id ?? null;
  const parentOf = new Map();
  for (const n of nodes.values()) {
    if (n.kind === 'workspace') continue;
    const parent = n.homeProjectId && nodes.has(n.homeProjectId) ? n.homeProjectId : rootId;
    parentOf.set(n.id, parent);
    if (parent) {
      if (!childrenOf.has(parent)) childrenOf.set(parent, []);
      childrenOf.get(parent).push(n.id);
    }
  }

  return { graph, nodes, edges, adjacency, incident, childrenOf, parentOf, rootId };
}

/** Nodes and edges within `depth` hops of `id` (id included). */
export function neighborhood(index, id, depth = 1) {
  const nodeIds = new Set();
  const edgeIds = new Set();
  if (!index.nodes.has(id)) return { nodeIds, edgeIds };
  let frontier = [id];
  nodeIds.add(id);
  for (let d = 0; d < depth; d++) {
    const next = [];
    for (const cur of frontier) {
      for (const e of index.incident.get(cur) ?? []) {
        edgeIds.add(e.id);
        const other = e.from === cur ? e.to : e.from;
        if (!nodeIds.has(other)) {
          nodeIds.add(other);
          next.push(other);
        }
      }
    }
    frontier = next;
  }
  return { nodeIds, edgeIds };
}

/* ----------------------------------------------------------------- layout -- */

// Deterministic hash → [0,1). Keeps the field organic without randomness that
// would move nodes between renders.
function hash01(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 100000) / 100000;
}

/** Ring/slot ladder inside a wedge: ring r holds 3 + 2r slots. */
export function wedgeSlot(k) {
  let ring = 0;
  let used = 0;
  for (;;) {
    const cap = 3 + ring * 2;
    if (k < used + cap) return { ring, slot: k - used, capacity: cap };
    used += cap;
    ring++;
  }
}

/**
 * Deterministic orbital layout. Returns Map<nodeId, {x, y, r, angle, radius}>.
 * Same input ⇒ same positions, so pan/zoom/filter never reshuffle the field.
 */
export function layoutGraph(graph, index = buildIndex(graph)) {
  const pos = new Map();
  const { CX, CY, R_PROJ, R_IN, R_OUT, WEDGE_HALF, START } = GEO;

  const rootId = index.rootId;
  if (rootId) pos.set(rootId, { x: CX, y: CY, r: 26, angle: 0, radius: 0 });

  const projects = [...index.nodes.values()]
    .filter((n) => n.type === 'project')
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)) || a.id.localeCompare(b.id));

  const angleOf = new Map();
  projects.forEach((p, i) => {
    const angle = START + (i / Math.max(projects.length, 1)) * Math.PI * 2;
    angleOf.set(p.id, angle);
    pos.set(p.id, {
      x: CX + Math.cos(angle) * R_PROJ,
      y: CY + Math.sin(angle) * R_PROJ,
      r: metaFor('project').r,
      angle,
      radius: R_PROJ,
    });
  });

  // Children of each project fan out through the memory band in its wedge.
  const rings = Math.max(1, Math.round((R_OUT - R_IN) / 24));
  for (const p of projects) {
    const base = angleOf.get(p.id);
    const kids = (index.childrenOf.get(p.id) ?? [])
      .filter((id) => index.nodes.get(id)?.type !== 'project')
      .sort((a, b) => {
        const na = index.nodes.get(a);
        const nb = index.nodes.get(b);
        return String(na.createdAt).localeCompare(String(nb.createdAt)) || a.localeCompare(b);
      });
    kids.forEach((id, k) => {
      const { ring, slot, capacity } = wedgeSlot(k);
      const jitter = hash01(id);
      const step = (R_OUT - R_IN) / rings;
      const radius = Math.min(R_OUT, R_IN + ring * step) + (jitter - 0.5) * 7;
      const spread = WEDGE_HALF * 2 * 0.86;
      const angle = base + ((slot + 0.5) / capacity - 0.5) * spread + (jitter - 0.5) * 0.024;
      pos.set(id, {
        x: CX + Math.cos(angle) * radius,
        y: CY + Math.sin(angle) * radius,
        r: metaFor(index.nodes.get(id).type).r,
        angle,
        radius,
      });
    });
  }

  // Anything anchored straight to the root (Inbox objects) sits on a tight
  // inner ring, deterministically ordered.
  const orphans = (index.childrenOf.get(rootId) ?? []).filter(
    (id) => index.nodes.get(id)?.type !== 'project' && !pos.has(id),
  );
  orphans.forEach((id, i) => {
    const angle = START + ((i + 0.5) / Math.max(orphans.length, 1)) * Math.PI * 2;
    const radius = R_PROJ * 0.68;
    pos.set(id, {
      x: CX + Math.cos(angle) * radius,
      y: CY + Math.sin(angle) * radius,
      r: metaFor(index.nodes.get(id).type).r,
      angle,
      radius,
    });
  });

  return pos;
}

/* ----------------------------------------------------------------- filter -- */

/** Filter chips derived from the node types actually present (plus the core). */
export function filterChipsFor(graph) {
  const counts = new Map();
  for (const n of graph.nodes ?? []) counts.set(n.type, (counts.get(n.type) ?? 0) + 1);
  const order = ['workspace', 'project', 'task', 'decision', 'note', 'idea', 'resource', 'checkpoint'];
  const chips = [];
  for (const type of order) {
    if (!counts.has(type)) continue;
    const meta = metaFor(type);
    chips.push({ key: type, label: meta.plural, accent: meta.accent, count: counts.get(type) });
  }
  return chips;
}

/**
 * Node ids the view should draw. `disabledTypes` is a view filter only — the
 * server has already removed everything the principal may not see.
 */
export function visibleNodeIds(index, { disabledTypes = new Set(), collapsed = new Set() } = {}) {
  const out = new Set();
  for (const n of index.nodes.values()) {
    if (disabledTypes.has(n.type)) continue;
    // A node inside a collapsed project is hidden, but never removed from data.
    const parent = index.parentOf.get(n.id);
    if (parent && collapsed.has(parent) && n.type !== 'project') continue;
    out.add(n.id);
  }
  return out;
}

/** Projects that can be expanded/collapsed (they have context under them). */
export function collapsibleIds(index) {
  const ids = [];
  for (const n of index.nodes.values()) {
    if (n.type !== 'project') continue;
    const kids = index.childrenOf.get(n.id) ?? [];
    if (kids.length > 0) ids.push(n.id);
  }
  return ids;
}

/* ----------------------------------------------------------------- search -- */

/**
 * Local, lexical search over the loaded graph. Deliberately NOT semantic search
 * — that is a later milestone. Ranked: title prefix > title match > body match.
 */
export function searchNodes(graph, query, limit = 8) {
  const q = String(query ?? '').trim().toLowerCase();
  if (q.length < 1) return [];
  const hits = [];
  for (const n of graph.nodes ?? []) {
    const title = (n.title ?? '').toLowerCase();
    const body = (n.snippet ?? '').toLowerCase();
    let score = -1;
    if (title.startsWith(q)) score = 0;
    else if (title.includes(q)) score = 1;
    else if (body.includes(q)) score = 2;
    else if (n.id.toLowerCase().startsWith(q)) score = 3;
    if (score >= 0) hits.push({ node: n, score });
  }
  hits.sort(
    (a, b) =>
      a.score - b.score ||
      a.node.title.length - b.node.title.length ||
      a.node.id.localeCompare(b.node.id),
  );
  return hits.slice(0, limit).map((h) => h.node);
}

/* ---------------------------------------------------------- dashboard (P3.3) */
//
// The dashboard rails (Project Pulse's "Context activity", the pulse header)
// are projections of the SAME graph payload and the SAME selection the centre
// panel already holds — never a second dataset. These two pure functions are
// the single place that derivation happens, so every rail widget reads it the
// same way the graph does, and a click handler that feeds an id back into
// revealAndFocus() can never resolve to an object the caller could not
// already see: every id returned here was already present in `graph.nodes`
// (whole-graph payload) or in a project's own already-visibility-filtered
// `children` (P3.2's inspectObject) — both scoped by the same VisibilityPolicy.

/**
 * The real project a dashboard element's identity is currently tied to, or
 * null when the current selection isn't scoped to one project (nothing
 * selected, or the workspace root). Used to link Project Pulse's header back
 * to the same node the graph and inspector are showing.
 */
export function pulseLinkTarget(node) {
  if (!node) return null;
  if (node.type === 'project') return node.id;
  return node.homeProjectId ?? null;
}

/**
 * "Developer Activity" / Project Pulse's context-activity feed: the most
 * recently captured real objects relevant to the current selection, most
 * recent first.
 *
 *   • a Project selected      → that project's own captures (`detail.children`,
 *                                already visibility-filtered by inspectObject)
 *   • another object selected → its home project's siblings, if it has one
 *   • nothing selected, or no home project → every capture visible in the
 *     graph (global recent activity)
 *
 * Returns `{ items, total }`: `items` is capped to `limit` for the fixed-size
 * dot grid; `total` is the full, uncapped count for the numeric metric next
 * to it, so a project with more captures than the grid can show still reports
 * its true count.
 */
export function recentActivity(graph, node = null, detail = null, limit = 20) {
  let pool;
  if (node && node.type === 'project' && detail) {
    pool = detail.children.map((c) => ({
      id: c.id,
      title: c.title || c.body || '(untitled)',
      createdAt: c.createdAt,
    }));
  } else {
    const projectId = pulseLinkTarget(node);
    pool = (graph.nodes ?? [])
      .filter((n) => n.layer === 'memory' && (projectId ? n.homeProjectId === projectId : true))
      .map((n) => ({ id: n.id, title: n.title || n.snippet || '(untitled)', createdAt: n.createdAt }));
  }
  const sorted = pool.slice().sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  return { items: sorted.slice(0, limit), total: sorted.length };
}

/* ------------------------------------------------------------------ focus -- */

export const clampZoom = (k) => Math.min(ZOOM.MAX, Math.max(ZOOM.MIN, k));

/** Bounding box of a set of laid-out points, padded in user units. */
export function boundsOf(points, pad = 60) {
  const list = [...points];
  if (list.length === 0) return { x: 0, y: 0, w: 1000, h: 1000 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of list) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return { x: minX - pad, y: minY - pad, w: maxX - minX + pad * 2, h: maxY - minY + pad * 2 };
}

/**
 * Transform that fits `box` into the visible user-space rect `view`.
 * The view applies it as `translate(tx, ty) scale(k)`, so a user point p maps
 * to k·p + t.
 */
export function focusTransform(box, view, maxScale = 2.6) {
  const k = clampZoom(
    Math.min(view.w / Math.max(box.w, 1), view.h / Math.max(box.h, 1), maxScale),
  );
  const bcx = box.x + box.w / 2;
  const bcy = box.y + box.h / 2;
  const vcx = view.x + view.w / 2;
  const vcy = view.y + view.h / 2;
  return { k, tx: vcx - k * bcx, ty: vcy - k * bcy };
}

/** Zoom about a fixed user-space anchor, so the point under the cursor stays put. */
export function zoomAbout(transform, factor, anchor) {
  const k = clampZoom(transform.k * factor);
  const scale = k / transform.k;
  return {
    k,
    tx: anchor.x - (anchor.x - transform.tx) * scale,
    ty: anchor.y - (anchor.y - transform.ty) * scale,
  };
}
