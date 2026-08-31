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

/* ------------------------------------------------- why it matters (T3.2) --- */
//
// Reason-giving (blueprint §5.9, §2 item 5). The requirement is that a user can
// ask "why does this matter / why is it here?" and get a concrete answer — and
// that the system NEVER presents an inference as a plain fact.
//
// So this is deliberately NOT a generated explanation. Every clause below is
// derived from a field that already exists on the object or the edge, and each
// carries the evidence it was derived from. Nothing is invented, nothing is
// scored, and no model is called: an LLM-written rationale would be exactly the
// "false certainty" P2.2 §4 forbids. The assistant (P3.4) remains the place
// where generated language lives, clearly labelled as such.

/** How a confidence state should be spoken about. Text, never colour alone. */
export const CONFIDENCE_LABEL = {
  known: 'Known',
  user_confirmed: 'Confirmed',
  inferred_high: 'Inferred',
  weak: 'Possible',
  structural: 'Structural',
};

/** True when a reason rests on inference rather than a recorded fact. */
const isInferred = (state) => state === 'inferred_high' || state === 'weak';

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
/** `2026-08-29T…` → `29 Aug 2026`. Deterministic, so the reason text is testable. */
function readableDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? ''));
  if (!m) return String(iso ?? '');
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
}

/**
 * Name the far end of a relationship **truthfully**, and keep three states that
 * the product must never conflate (§5.8 provenance, §8.3 data authenticity):
 *
 *   `titled`    — the object resolved and has a title. Use it.
 *   `untitled`  — the object resolved and IS visible; it simply carries no
 *                 title (a body-only capture is legitimate: "title optional if
 *                 body set"). We state the identity we actually hold — its
 *                 class and its real id — and never a name we invented, never
 *                 its body text passed off as a name, and never a claim about
 *                 visibility that is not true.
 *   `unresolved`— the server returned no object for this endpoint, so it is
 *                 genuinely outside what this principal may see. Only this case
 *                 may say so.
 *
 * One helper, used by both the "why this matters" derivation and the
 * relationship rows, so the two surfaces cannot describe the same edge
 * differently — which is exactly the defect this replaces.
 */
export function endpointIdentity(other) {
  if (!other) {
    return { text: 'An object outside your visibility', state: 'unresolved', resolved: false };
  }
  const title = typeof other.title === 'string' ? other.title.trim() : '';
  if (title) return { text: title, state: 'titled', resolved: true };
  const meta = TYPE_META[other.type];
  const cls = meta ? meta.label : 'Object';
  const ref = String(other.id ?? '').slice(0, 8);
  return {
    text: ref ? `Untitled ${cls.toLowerCase()} · ${ref}` : `Untitled ${cls.toLowerCase()}`,
    state: 'untitled',
    resolved: true,
  };
}

/**
 * Explain why the selected object is where it is and what it is connected to.
 *
 * Returns `{ summary, reasons }` where every reason is:
 *   { kind, text, evidence, inferred }
 * `evidence` names the real field or row the clause came from, so any statement
 * on screen can be traced back. `inferred` marks the ones that must be hedged.
 *
 * `detail` is the /api/objects/:id payload (object + edges + children). With no
 * detail this still explains what the graph payload alone supports.
 */
export function explainObject(node, detail = null, graph = null) {
  if (!node) return { summary: '', reasons: [] };
  const reasons = [];
  const add = (kind, text, evidence, inferred = false) =>
    reasons.push({ kind, text, evidence, inferred });

  const meta = metaFor(node.type);
  const nodes = graph?.nodes ?? [];
  const titleOf = (id) => nodes.find((n) => n.id === id)?.title ?? null;

  // --- what it is -----------------------------------------------------------
  if (node.kind === 'workspace') {
    const projects = nodes.filter((n) => n.type === 'project').length;
    const captures = nodes.filter((n) => n.layer === 'memory').length;
    add(
      'identity',
      `The root of your workspace: ${projects} project${projects === 1 ? '' : 's'} and ` +
        `${captures} captured item${captures === 1 ? '' : 's'} hang off it.`,
      'graph payload',
    );
    return { summary: 'Everything you can see is contained here.', reasons };
  }

  add('identity', `A ${meta.label.toLowerCase()} in your workspace.`, 'object.type');

  // --- where it sits --------------------------------------------------------
  if (node.type === 'project') {
    const kids = detail?.children?.length ?? nodes.filter((n) => n.homeProjectId === node.id).length;
    add(
      'containment',
      `A project holding ${kids} captured item${kids === 1 ? '' : 's'}.`,
      'object.home_project_id of its context',
    );
  } else if (node.homeProjectId) {
    const home = titleOf(node.homeProjectId) ?? detail?.object?.homeProjectId ?? 'its project';
    add('containment', `Captured into ${home}.`, 'object.home_project_id');
  } else {
    add(
      'containment',
      'Not filed into a project yet — it sits in the Inbox.',
      'object.home_project_id is null',
    );
  }

  // --- who and when ---------------------------------------------------------
  const created = detail?.object?.createdAt ?? node.createdAt;
  if (created) add('provenance', `Captured ${readableDate(created)}.`, 'object.created_at');
  const via = detail?.object?.attributes?.createdVia;
  if (via === 'assistant_proposal') {
    add(
      'provenance',
      'Created by you from an assistant proposal — the text was suggested, the decision to keep it was yours.',
      'object.attributes.createdVia',
    );
  }

  // --- what it connects to --------------------------------------------------
  // Individually, never as a count-only summary (§5.3).
  const edges = detail?.edges ?? [];
  for (const row of edges) {
    const state = row.edge?.synthesised ? 'structural' : row.edge?.confidenceState;
    if (state === 'weak') continue; // never in primary context (P2.2 §4)
    // Truthful identity for the far end — an untitled object is NOT an object
    // the reader cannot see, and must not be described as one (§8.3).
    const other = endpointIdentity(row.other).text;
    const dir = row.direction === 'out' ? '' : 'is the target of ';
    const label = CONFIDENCE_LABEL[state] ?? state;
    const inferred = isInferred(state);
    add(
      'relationship',
      inferred
        ? `Appears related: ${dir}${row.edge.verb} → ${other} (inferred — not confirmed).`
        : `${dir}${row.edge.verb} → ${other}. (${label})`,
      row.edge?.synthesised
        ? `computed from ${row.edge.provenance?.kind ?? 'a structural column'}`
        : `relationship row ${String(row.edge?.relationshipId ?? '').slice(0, 8)}`,
      inferred,
    );
  }

  const strong = reasons.filter((r) => r.kind === 'relationship' && !r.inferred).length;
  const summary = strong
    ? `Connected to ${strong} other ${strong === 1 ? 'object' : 'objects'} in your workspace.`
    : 'Nothing links to this yet.';

  return { summary, reasons };
}

/**
 * Group a selected node's revealed relationships by what a label on the field
 * would actually *say*: its verb and its direction relative to the selection.
 *
 * A project with ten captures reveals ten `belongs_to` edges pointing at it.
 * Drawing ten identical `← belongs_to` labels states one fact ten times and
 * — measured at 1600×900 — collapses into an unreadable pile that also covers
 * the project's own name. One group means one label.
 *
 * This is a **labelling** concern, not a data one: every edge stays in its
 * group and every relationship remains individually listed, with verb,
 * direction, confidence and provenance, in the inspector (§5.3 forbids
 * collapsing relationships into aggregate counts — no count is produced here).
 *
 * Ordered so the labels that carry the most information are placed first:
 * authored verbs before purely structural ones, then larger fans before
 * smaller, because a fan's label is the one covering the most edges.
 */
export function revealedLabelGroups(edges, selectedId) {
  const groups = new Map();
  for (const e of edges ?? []) {
    if (!e || (e.from !== selectedId && e.to !== selectedId)) continue;
    const outgoing = e.from === selectedId;
    const key = `${outgoing ? 'out' : 'in'}|${e.verb}`;
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { key, outgoing, verb: e.verb, structural: true, edges: [] }));
    if (!e.synthesised) g.structural = false;
    g.edges.push(e);
  }
  return [...groups.values()].sort(
    (p, q) => Number(p.structural) - Number(q.structural) || q.edges.length - p.edges.length,
  );
}

/** The words a group's label carries — direction arrow plus the real verb. */
export const labelTextFor = (group) => `${group.outgoing ? '→ ' : '← '}${group.verb}`;

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

/* ============================================================================
   T3.2 — RING SYSTEM (pure)

   Two ring compositions share this module so the OS command centre and the
   Second Brain cannot disagree about geometry or about what a ring means:

     • the COMMAND RING — the workspace's real, invocable capabilities laid on
       one track around the core;
     • the SECOND BRAIN — concentric rings over the SAME objects the graph,
       the inspector, search and the rails already hold.

   Nothing here invents an object. `CAPABILITIES` names capabilities the
   product actually has and each one points at a handler the shell already
   wires; the ring layouts only place real payload nodes.
   ========================================================================== */

/**
 * The workspace's real capabilities. Each entry maps to a handler that already
 * exists in the shell — the capture form, the P3.4 assistant and its summarize
 * / extract actions, the graph's own relationship reveal, and spatial search.
 * Nothing is listed here that the product cannot do; the ring is sized by this
 * list, never padded to match the reference's badge count.
 */
export const CAPABILITIES = [
  {
    id: 'capture',
    command: '/capture',
    label: 'Capture',
    glyph: '＋',
    description: 'Save a note into the focused project',
    kind: 'core',
  },
  {
    id: 'ask',
    command: '/ask',
    label: 'Ask',
    glyph: '✧',
    description: 'Answer from your context, grounded in real objects',
    kind: 'assistant',
  },
  {
    id: 'summarize',
    command: '/summarize',
    label: 'Summarize',
    glyph: '≡',
    description: 'Condense the current scope',
    kind: 'assistant',
  },
  {
    id: 'extract',
    command: '/extract-tasks',
    label: 'Extract Tasks',
    glyph: '☑',
    description: 'Pull action items from the current scope',
    kind: 'assistant',
  },
  {
    id: 'connect',
    command: 'connect',
    label: 'Connect',
    glyph: '⁘',
    description: 'Reveal what the selected object touches',
    kind: 'core',
  },
  {
    id: 'search',
    command: 'search',
    label: 'Search',
    glyph: '⌕',
    description: 'Find any object without losing its place',
    kind: 'core',
  },
];

/**
 * Semantic ring colour classes (T3.2 §6). Colour REINFORCES a class that is
 * always also stated in words — the node's own label, the ring annotation and
 * the inspector all name it — so nothing depends on hue alone (§4.13).
 *
 *   action   → the core and its capabilities      (orange)
 *   domain   → projects: the workspace's domains  (cyan)
 *   temporal → tasks: dated, actionable work      (amber)
 *   memory   → captured context                   (purple)
 */
export const SEMANTIC_BY_TYPE = {
  workspace: 'action',
  project: 'domain',
  task: 'temporal',
  note: 'memory',
  idea: 'memory',
  decision: 'memory',
  resource: 'memory',
  checkpoint: 'memory',
};

export const semanticClassOf = (node) =>
  node?.kind === 'workspace' ? 'action' : (SEMANTIC_BY_TYPE[node?.type] ?? 'memory');

/**
 * Second Brain geometry. Radii are in the same 1000×1000 user space the graph
 * already uses, so the two views share one coordinate system.
 */
export const BRAIN_GEO = {
  CX: 500,
  CY: 500,
  R_CAP: 140, // capability ring (drawn by the view, not a payload node)
  R_INBOX: 196, // objects with no home project
  R_DOMAIN: 252, // projects — the context / domain ring
  R_MEM: 320, // first memory ring
  MEM_STEP: 40,
  MEM_RINGS: 3,
  R_BOUND: 436, // outer system boundary
  START: -Math.PI / 2,
  SECTOR: 0.86, // fraction of a project's angular share its context may use
};

/** Evenly spaced points on one ring. Shared by both ring compositions. */
export function ringPoints(count, radius, { cx = 500, cy = 500, start = -Math.PI / 2 } = {}) {
  const out = [];
  for (let i = 0; i < count; i++) {
    const angle = start + (i / Math.max(count, 1)) * Math.PI * 2;
    out.push({
      index: i,
      angle,
      radius,
      x: cx + Math.cos(angle) * radius,
      y: cy + Math.sin(angle) * radius,
    });
  }
  return out;
}

/**
 * Concentric-ring projection of the SAME graph payload the wedge layout draws.
 *
 *   CORE          the workspace root
 *   DOMAIN RING   projects, evenly spaced
 *   MEMORY RINGS  each project's captured context, filling outward inside that
 *                 project's own angular sector, ring by ring
 *   INBOX RING    context with no home project, on a tight inner ring
 *
 * Deterministic: same payload ⇒ same positions, so nothing reshuffles between
 * renders, and a node keeps its place while search attenuates around it.
 */
export function layoutSecondBrain(graph, index = buildIndex(graph)) {
  const pos = new Map();
  const { CX, CY, R_INBOX, R_DOMAIN, R_MEM, MEM_STEP, MEM_RINGS, START, SECTOR } = BRAIN_GEO;

  if (index.rootId) pos.set(index.rootId, { x: CX, y: CY, r: 30, angle: 0, radius: 0, band: 'core' });

  const projects = [...index.nodes.values()]
    .filter((n) => n.type === 'project')
    .sort(
      (a, b) => String(a.createdAt).localeCompare(String(b.createdAt)) || a.id.localeCompare(b.id),
    );

  const share = (Math.PI * 2) / Math.max(projects.length, 1);
  projects.forEach((p, i) => {
    // Offset by half a sector so the 12 o'clock radial is a sector BOUNDARY,
    // never a project. That keeps one clear gutter for the ring annotations.
    const angle = START + (i + 0.5) * share;
    pos.set(p.id, {
      x: CX + Math.cos(angle) * R_DOMAIN,
      y: CY + Math.sin(angle) * R_DOMAIN,
      r: metaFor('project').r,
      angle,
      radius: R_DOMAIN,
      band: 'domain',
    });

    const kids = (index.childrenOf.get(p.id) ?? [])
      .filter((id) => index.nodes.get(id)?.type !== 'project')
      .sort((a, b) => {
        const na = index.nodes.get(a);
        const nb = index.nodes.get(b);
        return String(na.createdAt).localeCompare(String(nb.createdAt)) || a.localeCompare(b);
      });

    // Fill ring by ring, so an outer ring is only reached once the ones inside
    // it are full — the reference's "rings fill outward" reading.
    const perRing = Math.max(3, Math.ceil(kids.length / MEM_RINGS));
    kids.forEach((id, k) => {
      const ring = Math.floor(k / perRing);
      const slot = k % perRing;
      const inRing = Math.min(perRing, kids.length - ring * perRing);
      const spread = share * SECTOR;
      const a = angle + ((slot + 0.5) / inRing - 0.5) * spread;
      const radius = R_MEM + ring * MEM_STEP + (hash01(id) - 0.5) * 6;
      pos.set(id, {
        x: CX + Math.cos(a) * radius,
        y: CY + Math.sin(a) * radius,
        r: metaFor(index.nodes.get(id).type).r,
        angle: a,
        radius,
        band: 'memory',
      });
    });
  });

  const orphans = (index.childrenOf.get(index.rootId) ?? []).filter(
    (id) => index.nodes.get(id)?.type !== 'project' && !pos.has(id),
  );
  orphans.forEach((id, i) => {
    const a = START + ((i + 0.5) / Math.max(orphans.length, 1)) * Math.PI * 2;
    pos.set(id, {
      x: CX + Math.cos(a) * R_INBOX,
      y: CY + Math.sin(a) * R_INBOX,
      r: metaFor(index.nodes.get(id).type).r,
      angle: a,
      radius: R_INBOX,
      band: 'inbox',
    });
  });

  return pos;
}

/**
 * The ring structure to annotate, derived from what the payload actually
 * contains. A ring the workspace has nothing on is reported with a zero count
 * rather than being hidden or filled — the map states its own emptiness.
 */
export function brainRings(graph, index = buildIndex(graph)) {
  const { R_CAP, R_INBOX, R_DOMAIN, R_MEM, MEM_STEP, R_BOUND } = BRAIN_GEO;
  const nodes = [...index.nodes.values()];
  const count = (fn) => nodes.filter(fn).length;
  const memory = count((n) => n.layer === 'memory' && n.homeProjectId);
  const inbox = count((n) => n.kind !== 'workspace' && !n.homeProjectId && n.type !== 'project');
  const memRings = Math.max(
    1,
    Math.ceil(memory / Math.max(1, count((n) => n.type === 'project') * 3)),
  );
  return [
    { key: 'capability', label: 'Capabilities', radius: R_CAP, count: CAPABILITIES.length, semantic: 'action' },
    { key: 'inbox', label: 'Inbox', radius: R_INBOX, count: inbox, semantic: 'memory' },
    { key: 'domain', label: 'Projects', radius: R_DOMAIN, count: count((n) => n.type === 'project'), semantic: 'domain' },
    ...Array.from({ length: Math.min(BRAIN_GEO.MEM_RINGS, memRings) }, (_, i) => ({
      key: `memory-${i}`,
      label: i === 0 ? 'Context' : '',
      radius: R_MEM + i * MEM_STEP,
      count: i === 0 ? memory : 0,
      semantic: 'memory',
    })),
    { key: 'boundary', label: 'System boundary', radius: R_BOUND, count: nodes.length, semantic: 'boundary' },
  ];
}
