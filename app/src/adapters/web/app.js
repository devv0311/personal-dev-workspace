// P3.2 — shell wiring for the interactive Context Graph.
//
// Every node, edge and inspector field below comes from the P2.7 API under the
// current principal: /api/graph, /api/objects/:id, /api/projects/:id/notes.
// There is no mock graph dataset. The same object id is the graph node id, the
// inspector subject, the capture target and the API path — one object, one id,
// end to end.

import { createGraphView } from './graph-view.js';
import { createCommandRing } from './command-ring.js';
import {
  filterChipsFor,
  searchNodes,
  metaFor,
  recentActivity,
  pulseLinkTarget,
  explainObject,
  endpointIdentity,
  CAPABILITIES,
} from './graph-model.js';

const KNOWN_PRINCIPALS = [
  { id: '00000000-0000-4000-8000-0000000000a1', label: 'Alice · owner' },
  { id: '00000000-0000-4000-8000-0000000000b0', label: 'Bob · no access' },
];
const principalLabel = (id) =>
  state.members.find((m) => m.id === id)?.displayName ??
  KNOWN_PRINCIPALS.find((p) => p.id === id)?.label ??
  'unknown principal';

/** The assistant service (Zone B). Separate origin: it holds no DB credential. */
const ASSISTANT_URL = localStorage.getItem('dc.assistantUrl') || 'http://localhost:4178';

const state = {
  /** Which PLACE the shell is in: the OS command centre, or the Second Brain.
   *  Both are the same session over the same objects — this is navigation
   *  between two surfaces, not two datasets (T3.2 §3, §21). */
  view: 'os',
  members: [],
  principalId: localStorage.getItem('dc.principalId') || KNOWN_PRINCIPALS[0].id,
  ask: { busy: false, result: null },
  graph: { nodes: [], edges: [], stats: { projects: 0, captures: 0 } },
  selected: null, // { node, detail }
  results: [],
  resultIndex: -1,
};
const $ = (id) => document.getElementById(id);

/* ------------------------------------------------------------------- API -- */
async function api(path, opts = {}) {
  const res = await fetch(path, {
    ...opts,
    headers: {
      'content-type': 'application/json',
      authorization: `Dev ${state.principalId}`,
      ...(opts.headers || {}),
    },
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) {
    const e = new Error(data.error || `HTTP ${res.status}`);
    e.status = res.status;
    throw e;
  }
  return data;
}

/* ----------------------------------------------------------------- graph -- */

const view = createGraphView({
  svg: $('fsvg'),
  tip: $('node-tip'),
  // The Second Brain is a concentric-ring projection of the same payload the
  // rails and the inspector read (T3.2 §4).
  layout: 'brain',
  onCapability: (id) => runCapability(id),
  onSelect: (node) => {
    if (!node) closeInspector();
    else openInspector(node);
    setWorkspaceContext(node);
  },
  onState: (s) => {
    if (typeof s.zoom === 'number') $('g-zoom').textContent = `${Math.round(s.zoom * 100)}%`;
    if (typeof s.visible === 'number') $('ro-tr').textContent = `${s.visible} / ${s.total} NODES`;
  },
});

/* ------------------------------------------------------------- the places -- */
//
// OS COMMAND VIEW  ──click core──▶  SECOND BRAIN  ──back──▶  OS COMMAND VIEW
//
// Two surfaces, one session. Both are always in the DOM and laid out (the
// hidden one is made invisible, not display:none) so the map keeps its real
// dimensions and can be framed correctly the moment it is entered.

const ring = createCommandRing({
  svg: $('osvg'),
  tip: $('node-tip'),
  onAction: (id) => runCapability(id),
  onCore: () => enterBrain(),
});

function enterBrain() {
  if (state.view === 'brain') return;
  state.view = 'brain';
  document.body.dataset.view = 'brain';
  $('t-brain').setAttribute('aria-pressed', 'true');
  document.body.classList.remove('drawer-left', 'drawer-right');
  // Frame once the surface is actually on screen.
  requestAnimationFrame(() => view.fitContent(0));
}

function exitBrain() {
  if (state.view === 'os') return;
  state.view = 'os';
  document.body.dataset.view = 'os';
  $('t-brain').setAttribute('aria-pressed', 'false');
}

/** Navigate to a real object: enter the map, then reveal, select and focus it
 *  through the one selection path every surface already shares. */
function goTo(id) {
  enterBrain();
  requestAnimationFrame(() => view.revealAndFocus(id));
}

/**
 * Run a capability from the command ring, the Second Brain's inner ring or the
 * Skills Deck. Every branch delegates to something the shell already wires —
 * the capture form, the P3.4 assistant, the map's own relationship reveal, or
 * spatial search. Nothing here claims an executable the product lacks.
 */
function runCapability(id) {
  document.body.classList.remove('drawer-left', 'drawer-right');
  switch (id) {
    case 'capture':
      enterBrain();
      $('tool-capture').click();
      break;
    case 'ask':
      openAsk();
      break;
    case 'summarize':
      openAsk();
      $('ask-summarize').click();
      break;
    case 'extract':
      openAsk();
      $('ask-extract').click();
      break;
    case 'connect': {
      // "What does this touch?" — selection is what reveals a node's real,
      // typed, directional relationships, so Connect is that gesture by name.
      enterBrain();
      const target = state.selected?.node?.id ?? state.graph.nodes.find((n) => n.kind === 'workspace')?.id;
      if (target) requestAnimationFrame(() => view.revealAndFocus(target));
      break;
    }
    case 'search':
      openSpotlight();
      break;
    default:
      break;
  }
}

async function loadGraph({ keepSelection = true } = {}) {
  try {
    const graph = await api('/api/graph');
    state.graph = graph;
    // A fresh start (first load, or a principal switch) is a different graph —
    // re-frame it rather than inheriting the previous dataset's zoom.
    view.render(graph, { reframe: !keepSelection });
    // The core states the workspace's real size, from the same stats the rails
    // read — the centre can never disagree with the panels around it.
    ring.render(graph);
    renderFilters(graph);
    renderPulse(graph);

    $('field-empty').hidden = graph.stats.projects > 0 || graph.stats.captures > 0;
    $('ro-tl').textContent = `WORKSPACE · ${graph.workspaceId.slice(0, 8)}`;
    $('brand-id').textContent = `${principalLabel(state.principalId)} | Workspace`;
    $('os-tr').textContent =
      `${graph.stats.captures} CAPTURES · ${graph.stats.projects} PROJECTS · ${graph.stats.edges} LINKS`;
    $('brain-meta').textContent = `${graph.stats.nodes} NODES · ${graph.stats.edges} EDGES`;
    setWorkspaceContext();
    renderActivity(graph);

    const keep = keepSelection && state.selected ? state.selected.node.id : null;
    if (keep && graph.nodes.some((n) => n.id === keep)) view.select(keep);
    else closeInspector();
  } catch (err) {
    state.graph = { nodes: [], edges: [], stats: { nodes: 0, edges: 0, projects: 0, captures: 0 } };
    view.render(state.graph);
    ring.render(state.graph);
    $('os-tr').textContent = err.status === 401 ? 'NOT AUTHENTICATED' : 'WORKSPACE UNAVAILABLE';
    renderFilters(state.graph);
    renderPulse(state.graph);
    closeInspector();
    const empty = $('field-empty');
    empty.hidden = false;
    empty.querySelector('.big').textContent =
      err.status === 401 ? 'Not authenticated' : 'Could not load the context graph';
  }
}

/* --------------------------------------------------------------- filters -- */

function renderFilters(graph) {
  const host = $('g-filters');
  host.textContent = '';
  // Filters derive from the object types actually present — never a fixed list,
  // and never a colour-keyed layer taxonomy. Class is carried by its name.
  const chips = filterChipsFor(graph);
  for (const chip of chips) {
    const b = document.createElement('button');
    b.className = 'chip on';
    b.type = 'button';
    b.dataset.type = chip.key;
    b.setAttribute('aria-pressed', 'true');
    b.innerHTML = `<span class="sw"></span>${chip.label}<span class="n">${chip.count}</span>`;
    b.onclick = () => {
      const on = b.classList.toggle('on');
      b.setAttribute('aria-pressed', String(on));
      view.setTypeFilter(chip.key, on);
    };
    host.append(b);
  }
}

/* ------------------------------------------------------------- inspector -- */

const fmtDate = (iso) => {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString(undefined, {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
};

/** Header workspace/project readout + Workflows scope line — both are real,
 *  derived from the loaded graph and the current selection. Object count at
 *  rest; the selected object's project (and the object's own title as the
 *  action scope) when one is focused. */
function setWorkspaceContext(node = state.selected?.node ?? null) {
  const v = $('wsctx-v');
  if (v) {
    const proj =
      node &&
      (node.type === 'project'
        ? node
        : state.graph?.nodes.find((n) => n.id === node.homeProjectId));
    if (proj) {
      v.textContent = `▸ ${proj.title}`;
    } else {
      const n = state.graph?.nodes.length ?? 0;
      v.textContent = `${n} object${n === 1 ? '' : 's'}`;
    }
  }
  const scope = $('flow-scope');
  if (scope) {
    scope.textContent = node
      ? `Scope · ${node.title || '(untitled)'}`
      : 'Scope · whole workspace';
  }
}

/**
 * ACTIVITY strip (right rail) — the reference's compact schedule/timeline
 * treatment, populated only with REAL events: context captured into the
 * workspace, most recent first. `recentActivity` is the same P3.3 derivation
 * the Project Pulse grid uses, so every id here is one the server already
 * decided this principal may see. Each row opens the same object in the graph.
 */
function renderActivity(graph) {
  const body = $('act-rows');
  const empty = $('act-empty');
  const note = $('pulse-note');
  if (!body) return;
  body.textContent = '';

  const { items, total } = recentActivity(graph, null, null, 8);
  if (note) note.textContent = total ? `${total} captured` : 'nothing captured yet';
  empty.hidden = total > 0;

  const now = new Date();
  const stamp = (iso) => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    const sameDay = d.toDateString() === now.toDateString();
    return sameDay
      ? d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false })
      : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }).toUpperCase();
  };

  items.forEach((item, i) => {
    const tr = document.createElement('tr');
    tr.className = i === 0 ? 'latest' : 'past';
    tr.dataset.id = item.id;
    tr.setAttribute('role', 'button');
    tr.setAttribute('tabindex', '0');
    tr.setAttribute('aria-label', `Open ${item.title} in the graph`);

    const t = document.createElement('td');
    t.className = 't mono';
    t.textContent = stamp(item.createdAt);
    const c = document.createElement('td');
    c.className = 'cx';
    c.textContent = item.title;
    const s = document.createElement('td');
    s.className = 'st';
    s.textContent = i === 0 ? 'Latest' : 'Captured';

    tr.append(t, c, s);
    const go = () => goTo(item.id);
    tr.addEventListener('click', go);
    tr.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        go();
      }
    });
    body.append(tr);
  });
}

/**
 * The Skills cards show the assistant's REAL provider when it is reachable —
 * never a fabricated model/effort badge. One probe of its public /healthz;
 * `offline` if it does not answer.
 */
/**
 * How a Skills card describes the engine behind it.
 *
 * The T3.1 review rejected `FAKE · DETERMINISTIC-FAKE-1` on these cards, and
 * rightly: the assistant's development stub does report exactly that from its
 * own /healthz, but printing it in a model slot dresses a stub up as a model
 * and an effort tier. The fix is not to hide the state — it is to state it in
 * words. A stub says it is a stub; a real provider is named, with the model it
 * actually reports and nothing more. No effort tier is shown anywhere, because
 * the service exposes none (T3.2 §8, §23).
 */
function providerName(kind) {
  return kind === 'fake' ? 'dev stub' : String(kind ?? 'unknown');
}

function providerLabel(p) {
  if (!p) return 'assistant · ready';
  return `assistant · ${providerName(p.kind)}${p.model && p.kind !== 'fake' ? ` · ${p.model}` : ''}`;
}

async function probeAssistant() {
  const cells = document.querySelectorAll('.sk-meta[data-assistant]');
  if (!cells.length) return;
  try {
    const res = await fetch(`${ASSISTANT_URL}/healthz`, { method: 'GET' });
    const data = await res.json();
    const p = data?.provider;
    cells.forEach((c) => (c.textContent = providerLabel(p)));
  } catch {
    cells.forEach((c) => (c.textContent = 'assistant · offline'));
  }
}

function closeInspector() {
  state.selected = null;
  if (!$('askp').hidden) $('ask-scope').textContent = 'Whole workspace';
  $('center').classList.remove('inspecting');

  // CLEAR, don't merely hide. The panel is only translated off-screen, so
  // content left behind stays in the DOM and the accessibility tree — and on a
  // principal switch that would be one user's context persisting into another
  // user's session. Deselecting must leave nothing of the previous object.
  $('ins-title').textContent = '—';
  $('ins-type').textContent = '—';
  $('ins-id').textContent = '—';
  $('ins-count').textContent = '—';
  $('ins-meta').textContent = '';
  $('ins-body').textContent = '';
  $('ins-body').hidden = true;
  $('why-sum').textContent = '';
  $('why-list').textContent = '';
  $('ctx-list').textContent = '';
  $('rel-list').textContent = '';
  $('ins-children-label').hidden = true;
  $('ctx-empty').hidden = true;
  $('rel-empty').hidden = true;
  $('note-title').value = '';
  $('note-body').value = '';

  $('cap-submit').disabled = true;
  $('cap-target').textContent = 'Select a project to capture into.';
  $('cap-status').textContent = 'Select a project first.';
  $('cap-status').className = '';
  renderPulse(state.graph);
}

/** Which real project a capture would be written into, given the selection. */
function captureTarget(node) {
  if (!node) return null;
  if (node.type === 'project') return { id: node.id, title: node.title };
  if (node.homeProjectId) {
    const p = state.graph.nodes.find((n) => n.id === node.homeProjectId);
    return p ? { id: p.id, title: p.title } : null;
  }
  return null;
}

async function openInspector(node) {
  const meta = metaFor(node.type);
  $('center').classList.add('inspecting');
  $('ins-title').textContent = node.title || '(untitled)';
  $('ins-type').textContent = meta.label;
  // Class is stated in the label beside it; the dot stays neutral (§4.13).
  $('ins-dot').className = 'dot';
  $('ins-id').textContent = `${node.id.slice(0, 8)}…`;
  $('ins-body').hidden = true;
  $('ctx-list').textContent = '';
  $('rel-list').textContent = '';
  $('ctx-empty').hidden = true;
  $('rel-empty').hidden = true;
  $('ins-children-label').hidden = true;

  if (!$('askp').hidden) $('ask-scope').textContent = `Scoped to: ${node.title || '(untitled)'}`;

  const target = captureTarget(node);
  $('cap-target').textContent = target ? `→ ${target.title}` : 'Capture needs a project.';
  $('cap-submit').disabled = !target;
  $('cap-status').textContent = target ? 'Ready.' : 'Select a project first.';
  $('cap-status').className = '';

  // The workspace root has no persisted object row — describe it from the
  // graph itself rather than inventing an object.
  if (node.kind === 'workspace') {
    state.selected = { node, detail: null };
    $('ins-meta').textContent = `WORKSPACE ${node.id}`;
    $('ins-count').textContent = `${state.graph.stats.projects} projects · ${state.graph.stats.captures} context`;
    $('ins-children-label').hidden = false;
    $('ins-children-label').textContent = 'Projects';
    for (const p of state.graph.nodes.filter((n) => n.type === 'project')) {
      $('ctx-list').append(contextRow(p.id, p.title, '', 'project'));
    }
    $('ctx-empty').hidden = state.graph.stats.projects > 0;
    $('rel-empty').hidden = false;
    $('rel-empty').textContent = 'Structural containment only.';
    renderWhy(node, null);
    renderPulse(state.graph, node);
    return;
  }

  try {
    const detail = await api(`/api/objects/${node.id}`);
    state.selected = { node, detail };

    const o = detail.object;
    $('ins-title').textContent = o.title || '(untitled note)';
    $('ins-meta').textContent = `CREATED ${fmtDate(o.createdAt)} · UPDATED ${fmtDate(o.updatedAt)}`;
    if (o.body) {
      $('ins-body').textContent = o.body;
      $('ins-body').hidden = false;
    }

    if (detail.children.length > 0 || o.type === 'project') {
      $('ins-children-label').hidden = false;
      $('ins-children-label').textContent = 'Captured context';
      for (const child of detail.children) {
        $('ctx-list').append(contextRow(child.id, child.title || '(untitled note)', child.body, child.type));
      }
      $('ctx-empty').hidden = detail.children.length > 0;
    }

    // Weak / possible relationships are not rendered in the primary context
    // view (§5.3); an on-demand "possibly related" affordance is deferred (Q6).
    const rels = detail.edges.filter((r) => r.edge?.confidenceState !== 'weak');
    for (const r of rels) {
      $('rel-list').append(relationshipRow(r));
    }
    $('rel-empty').hidden = rels.length > 0;

    renderWhy(node, detail);

    const n = detail.children.length;
    $('ins-count').textContent =
      o.type === 'project'
        ? `${n} capture${n === 1 ? '' : 's'} · ${rels.length} link${rels.length === 1 ? '' : 's'}`
        : `${rels.length} relationship${rels.length === 1 ? '' : 's'}`;

    renderPulse(state.graph, node, detail);
  } catch (err) {
    state.selected = { node, detail: null };
    $('ins-meta').textContent = '';
    $('why-sum').textContent = '';
    $('why-list').textContent = '';
    $('ctx-empty').hidden = false;
    $('ctx-empty').textContent =
      err.status === 404
        ? 'This object is not visible to the current principal.'
        : err.message;
    $('cap-submit').disabled = true;
  }
}

/**
 * Reason-giving: why the selected object matters and how it got here.
 * Every line comes from `explainObject`, which derives only from real fields —
 * an inferred line is marked "inferred" and hedged, never stated as fact
 * (blueprint §5.9, P2.2 §4 "no false certainty").
 */
function renderWhy(node, detail) {
  const { summary, reasons } = explainObject(node, detail, state.graph);
  $('why-sum').textContent = summary;
  const host = $('why-list');
  host.textContent = '';
  for (const r of reasons) {
    const li = document.createElement('li');
    if (r.inferred) li.className = 'inferred';
    const t = document.createElement('span');
    t.className = 'wt';
    t.textContent = r.text;
    const ev = document.createElement('span');
    ev.className = 'wev mono';
    ev.textContent = r.evidence;
    li.append(t, ev);
    host.append(li);
  }
}

/** A row that traverses to another REAL object in the graph. */
function contextRow(id, title, body, type) {
  const li = document.createElement('li');
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'ctx-row';
  const h = document.createElement('h3');
  h.textContent = title;
  btn.append(h);
  if (body) {
    const p = document.createElement('p');
    p.textContent = body;
    btn.append(p);
  }
  const tag = document.createElement('span');
  tag.className = 'edge';
  const code = document.createElement('code');
  code.textContent = metaFor(type).label.toLowerCase();
  tag.append(code, document.createTextNode(' · open in graph'));
  btn.append(tag);
  btn.onclick = () => goTo(id);
  li.append(btn);
  return li;
}

const CONFIDENCE_LABEL = {
  known: 'Known',
  user_confirmed: 'Confirmed',
  inferred_high: 'Inferred',
  structural: 'Structural',
};

/**
 * One real relationship edge. Individually listed — never an aggregate count —
 * carrying its verb, direction and confidence state as text, an expandable slot
 * for provenance and (later) contributing signals, and traversal to the far
 * object (§5.3, §6.4, Q7).
 */
function relationshipRow(r) {
  const li = document.createElement('li');
  const arrow = r.direction === 'out' ? '→' : '←';

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'rel-row';
  btn.disabled = !r.other;

  const verb = document.createElement('code');
  verb.textContent = r.edge.verb;
  const dir = document.createElement('span');
  dir.className = 'ar';
  dir.textContent = arrow;
  // The same truthful-identity rule the "why this matters" derivation uses, from
  // the same helper, so the two columns can never describe one edge differently.
  const far = endpointIdentity(r.other);
  const other = document.createElement('span');
  other.className = far.resolved ? 'ot' : 'ot unresolved';
  other.textContent = far.text;

  const state = r.edge.synthesised ? 'structural' : r.edge.confidenceState;
  const conf = document.createElement('span');
  conf.className = 'conf' + (state === 'inferred_high' ? ' inferred' : '');
  conf.textContent = CONFIDENCE_LABEL[state] || state || 'known';

  btn.append(verb, dir, other, conf);
  if (r.other) btn.onclick = () => goTo(r.other.id);
  li.append(btn);

  // Expandable provenance slot — populated with what the edge already carries;
  // the layout does not preclude contributing signals being added later.
  const detail = document.createElement('div');
  detail.className = 'rel-detail';
  detail.hidden = true;
  const line = (t) => {
    const d = document.createElement('div');
    d.textContent = t;
    detail.append(d);
  };
  line(`origin · ${r.edge.origin ?? '—'}`);
  if (r.edge.authorId) line(`author · ${String(r.edge.authorId).slice(0, 8)}…`);
  if (r.edge.createdAt) line(`created · ${fmtDate(r.edge.createdAt)}`);
  if (r.edge.provenance?.kind) line(`provenance · ${r.edge.provenance.kind}`);
  line(`visibility · ${r.edge.visibilityScope ?? 'shared'}`);

  const disclose = document.createElement('button');
  disclose.type = 'button';
  disclose.className = 'disclose';
  disclose.setAttribute('aria-expanded', 'false');
  disclose.textContent = '＋ Provenance';
  disclose.onclick = () => {
    const open = detail.hidden;
    detail.hidden = !open;
    disclose.setAttribute('aria-expanded', String(open));
    disclose.textContent = open ? '－ Provenance' : '＋ Provenance';
  };

  li.append(disclose, detail);
  return li;
}

/* ------------------------------------------------------------ left rail -- */

// Project Pulse and its "Context activity" grid are projections of the same
// graph payload and the same selection the centre panel holds — derived at
// render time, never a second dataset (P3.3 §2). `recentActivity` and
// `pulseLinkTarget` are the one place that derivation happens; every id they
// return already passed through the server's VisibilityPolicy (it came from
// `state.graph.nodes` or a project's own already-filtered `children`), so
// feeding one back into `view.revealAndFocus` can never surface an object the
// current principal could not already see.
function renderPulse(graph, node = null, detail = null) {
  const globalCaptures = graph.stats?.captures ?? 0;
  const linkId = pulseLinkTarget(node);
  const { items, total } = recentActivity(graph, node, detail);

  if (node && node.type === 'project') {
    $('pulse-name').textContent = node.title.toUpperCase();
    $('pulse-captures').textContent = String(total);
  } else if (node) {
    $('pulse-name').textContent = (node.title || 'WORKSPACE').toUpperCase();
    $('pulse-captures').textContent = String(linkId ? total : globalCaptures);
  } else {
    const n = graph.stats?.projects ?? 0;
    $('pulse-name').textContent = n
      ? `${n} PROJECT${n === 1 ? '' : 'S'} IN VIEW`
      : 'No project selected';
    $('pulse-captures').textContent = String(globalCaptures);
  }

  // "What exists / what is active / what has changed", every figure real:
  // the project count is the workspace's own, and Links is the selection's
  // real relationship count when one is held, the graph's otherwise. Nothing
  // is shown for which there is no backing object (no invented backlog).
  $('pulse-projects').textContent = String(graph.stats?.projects ?? 0);
  const links = detail
    ? detail.edges.filter((r) => r.edge?.confidenceState !== 'weak').length
    : (graph.stats?.edges ?? 0);
  $('pulse-links').textContent = String(links);

  // Only make the header clickable when that project is actually a node the
  // current principal can see right now — a note can, in principle, remain
  // visible by ownership after its project stops being shared; the click
  // target must never be offered for an id the graph cannot resolve.
  const validLinkId =
    linkId && graph.nodes.some((n) => n.id === linkId && n.type === 'project') ? linkId : null;
  setPulseLink(validLinkId);
  renderActGrid(items);
}

/** Project Pulse → Graph: its header links back to the real project node the
 *  current selection belongs to, so it can re-focus the graph on it. */
function setPulseLink(projectId) {
  const el = $('pulse-name');
  if (projectId) {
    el.dataset.projectId = projectId;
    el.classList.add('linked');
    el.setAttribute('role', 'button');
    el.setAttribute('tabindex', '0');
    el.setAttribute('aria-label', `Focus ${el.textContent} in the graph`);
  } else {
    delete el.dataset.projectId;
    el.classList.remove('linked');
    el.removeAttribute('role');
    el.removeAttribute('tabindex');
    el.removeAttribute('aria-label');
  }
}

/** Developer Activity → Context: each lit dot is one real captured object;
 *  clicking or activating it selects and focuses that same object in the
 *  graph, through the one selection path every other surface uses. */
function renderActGrid(items) {
  const g = $('actgrid');
  g.textContent = '';
  for (let i = 0; i < 20; i++) {
    const item = items[i];
    const c = document.createElement('i');
    if (item) {
      c.className = 'on';
      c.dataset.id = item.id;
      c.title = item.title;
      c.setAttribute('role', 'button');
      c.setAttribute('tabindex', '0');
      c.setAttribute('aria-label', `Open ${item.title} in the graph`);
      const go = () => goTo(item.id);
      c.addEventListener('click', go);
      c.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          go();
        }
      });
    } else {
      c.setAttribute('aria-hidden', 'true');
    }
    g.append(c);
  }
}


/* ---------------------------------------------------------------- search -- */

function renderResults() {
  const host = $('g-results');
  host.textContent = '';
  const querying = $('g-search').value.trim().length > 0;
  document.body.classList.toggle('searching', querying);
  if (state.results.length === 0) {
    host.hidden = true;
    view.setMatches([]); // clears the spotlight
    return;
  }
  state.results.forEach((n, i) => {
    const li = document.createElement('li');
    li.setAttribute('role', 'option');
    li.setAttribute('aria-selected', String(i === state.resultIndex));
    if (i === state.resultIndex) li.className = 'cur';
    const meta = metaFor(n.type);
    const sw = document.createElement('span');
    sw.className = `sw ${meta.accent}`;
    const t = document.createElement('span');
    t.className = 'rt';
    t.textContent = n.title || n.snippet || '(untitled)';
    const k = document.createElement('span');
    k.className = 'rk';
    k.textContent = meta.label;
    li.append(sw, t, k);
    li.onclick = () => pickResult(i);
    host.append(li);
  });
  host.hidden = false;
  // Search attenuates the field and lights matches in place — they never
  // reflow (§5.7). The results list is a keyboard affordance over the same set.
  view.setMatches(state.results.map((n) => n.id), { spotlight: true });
}

function pickResult(i) {
  const node = state.results[i];
  if (!node) return;
  state.resultIndex = i;
  goTo(node.id);
  renderResults();
}

function wireSearch() {
  const input = $('g-search');
  input.oninput = () => {
    state.results = searchNodes(state.graph, input.value, 8);
    state.resultIndex = state.results.length ? 0 : -1;
    renderResults();
  };
  input.onkeydown = (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!state.results.length) return;
      const d = e.key === 'ArrowDown' ? 1 : -1;
      state.resultIndex = (state.resultIndex + d + state.results.length) % state.results.length;
      renderResults();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      pickResult(state.resultIndex < 0 ? 0 : state.resultIndex);
    } else if (e.key === 'Escape') {
      input.value = '';
      state.results = [];
      state.resultIndex = -1;
      renderResults();
    }
  };
}

/* ------------------------------------------------------ spatial search ---- */
//
// The reference's search-as-spotlight (§5.7): a compact centred field whose
// input attenuates the whole command centre (body.searching) and lights
// matching objects IN PLACE — they never reflow into a list. The list below is
// only a keyboard affordance over the same match set; picking one focuses the
// object and opens its inspector, the same revealAndFocus path every surface
// uses. It shares searchNodes / setMatches with the graph-control search.
const sl = { results: [], index: -1 };

function openSpotlight() {
  document.body.classList.remove('drawer-left', 'drawer-right');
  $('spotlight').hidden = false;
  const input = $('sl-input');
  input.focus();
  input.select();
}

function closeSpotlight() {
  $('spotlight').hidden = true;
  ring.setMatches('');
  $('sl-input').value = '';
  sl.results = [];
  sl.index = -1;
  $('sl-results').hidden = true;
  $('sl-results').textContent = '';
  document.body.classList.remove('searching');
  view.setMatches([]);
}

function renderSpotlight() {
  const host = $('sl-results');
  host.textContent = '';
  const query = $('sl-input').value.trim();
  const querying = query.length > 0;
  document.body.classList.toggle('searching', querying);
  view.setMatches(querying ? sl.results.map((n) => n.id) : [], { spotlight: querying });
  // The command ring attenuates too, and lights the capabilities that match —
  // search subtracts from whichever surface you are standing on (§19).
  ring.setMatches(query);
  // Objects live on the map. When the query reaches them, the map is the place
  // that must be visible, so the matches can light IN PLACE rather than being
  // replaced by a list.
  if (querying && sl.results.length > 0) enterBrain();

  if (!querying) {
    host.hidden = true;
    return;
  }
  if (sl.results.length === 0) {
    const li = document.createElement('li');
    li.className = 'none';
    li.textContent = 'No matches in view';
    host.append(li);
    host.hidden = false;
    return;
  }
  sl.results.forEach((n, i) => {
    const li = document.createElement('li');
    li.setAttribute('role', 'option');
    li.setAttribute('aria-selected', String(i === sl.index));
    if (i === sl.index) li.className = 'cur';
    const meta = metaFor(n.type);
    const sw = document.createElement('span');
    sw.className = 'sw';
    const t = document.createElement('span');
    t.className = 'rt';
    t.textContent = n.title || n.snippet || '(untitled)';
    const k = document.createElement('span');
    k.className = 'rk';
    k.textContent = meta.label;
    li.append(sw, t, k);
    li.onclick = () => pickSpotlight(i);
    host.append(li);
  });
  host.hidden = false;
}

function pickSpotlight(i) {
  const n = sl.results[i];
  if (!n) return;
  goTo(n.id);
  closeSpotlight();
}

function wireSpotlight() {
  const input = $('sl-input');
  input.oninput = () => {
    sl.results = searchNodes(state.graph, input.value, 8);
    sl.index = sl.results.length ? 0 : -1;
    renderSpotlight();
  };
  input.onkeydown = (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!sl.results.length) return;
      const d = e.key === 'ArrowDown' ? 1 : -1;
      sl.index = (sl.index + d + sl.results.length) % sl.results.length;
      renderSpotlight();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      pickSpotlight(sl.index < 0 ? 0 : sl.index);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      closeSpotlight();
    }
  };
  $('sl-close').onclick = closeSpotlight;
}

/* --------------------------------------------------------- assistant (P3.4) */
//
// The panel is a view over the assistant's response. It renders NOTHING the
// pipeline did not validate: every evidence row is a real object id that the
// core confirmed this principal can see, so clicking one is the same
// revealAndFocus every other surface uses — the answer navigates back into the
// graph rather than being a dead end.

function askScopeLabel() {
  const node = state.selected?.node;
  if (!node) return 'Whole workspace';
  return `Scoped to: ${node.title || '(untitled)'}`;
}

function setAskStatus(text, cls = '') {
  const el = $('ask-status');
  el.textContent = text;
  el.className = cls;
}

function openAsk() {
  // Opened from the left rail, which is a DRAWER at <=1200px — leaving it up
  // would cover the panel the user just asked for.
  document.body.classList.remove('drawer-left', 'drawer-right');
  $('askp').hidden = false;
  $('ask-scope').textContent = askScopeLabel();
  $('ask-input').focus();
}

function renderAsk(result) {
  const out = $('ask-out');
  out.hidden = false;

  const grounding = $('ask-grounding');
  if (result.evidenceCount === 0) {
    grounding.className = 'askgrounding ungrounded';
    grounding.textContent = 'No context found · nothing to ground an answer on';
  } else if (result.grounded) {
    grounding.className = 'askgrounding grounded';
    grounding.textContent = `Grounded in ${result.citations.length} of ${result.evidenceCount} context items`;
  } else {
    grounding.className = 'askgrounding ungrounded';
    grounding.textContent = `Ungrounded · ${result.evidenceCount} items in scope, none cited`;
  }
  $('ask-answer').textContent = result.answer;

  // --- evidence: real objects, navigable ---------------------------------
  const evHost = $('ask-evidence');
  evHost.textContent = '';
  $('ask-ev-label').hidden = result.citations.length === 0;
  for (const c of result.citations) {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'ev';
    const meta = metaFor(c.type);

    const sw = document.createElement('span');
    sw.className = `sw ${meta.accent}`;
    const t = document.createElement('span');
    t.className = 'et';
    t.textContent = c.title || '(untitled)';
    const k = document.createElement('span');
    k.className = 'ek';
    k.textContent = meta.label;
    btn.append(sw, t, k);

    // Why this object was in scope — provenance the user can read.
    const why = c.why?.length
      ? c.why.map((w) => `${w.verb} · ${w.confidenceState}`).join(' · ')
      : `${c.layer} · rank ${c.rank}`;
    const w = document.createElement('span');
    w.className = 'ewhy';
    w.textContent = why;
    btn.append(w);

    btn.onclick = () => goTo(c.objectId);
    li.append(btn);
    evHost.append(li);
  }

  // --- proposed tasks: inert until the user confirms ----------------------
  const taskHost = $('ask-tasks');
  taskHost.textContent = '';
  $('ask-task-label').hidden = result.proposedTasks.length === 0;
  for (const proposal of result.proposedTasks) {
    taskHost.append(taskProposalRow(proposal, result.projectId));
  }
}

/** One inert proposal. Nothing exists until Create is pressed. */
function taskProposalRow(proposal, fallbackProjectId) {
  const li = document.createElement('li');
  const title = document.createElement('span');
  title.className = 'tt';
  title.textContent = proposal.title;
  li.append(title);

  if (proposal.sourceTitle) {
    const src = document.createElement('span');
    src.className = 'tsrc';
    src.textContent = `from: ${proposal.sourceTitle}`;
    li.append(src);
  }

  const row = document.createElement('div');
  row.className = 'trow';
  const create = document.createElement('button');
  create.type = 'button';
  create.className = 'btn-run';
  create.textContent = 'Create';
  const open = document.createElement('button');
  open.type = 'button';
  open.className = 'pill ghost sm';
  open.textContent = 'Source';
  open.disabled = !proposal.sourceObjectId;
  open.onclick = () => proposal.sourceObjectId && goTo(proposal.sourceObjectId);

  const projectId = proposal.projectId || fallbackProjectId;
  create.disabled = !projectId;
  create.onclick = async () => {
    create.disabled = true;
    try {
      // Creation goes to the CORE, as the USER, through the ordinary
      // authenticated write path. The assistant never writes (INV-8).
      const { task } = await api(`/api/projects/${projectId}/tasks`, {
        method: 'POST',
        body: JSON.stringify({
          title: proposal.title,
          body: proposal.body,
          sourceObjectId: proposal.sourceObjectId,
          assistantAssisted: true,
        }),
      });
      row.textContent = '';
      const done = document.createElement('span');
      done.className = 'created';
      done.textContent = 'Created';
      const openTask = document.createElement('button');
      openTask.type = 'button';
      openTask.className = 'pill ghost sm';
      openTask.textContent = 'Open in graph';
      openTask.onclick = () => goTo(task.id);
      row.append(done, openTask);
      await loadGraph();
      view.setMatches([task.id]);
    } catch (err) {
      create.disabled = false;
      setAskStatus(`Not created: ${err.message}`, 'err');
    }
  };
  row.append(create, open);
  li.append(row);
  return li;
}

async function runAsk(question) {
  if (state.ask.busy) return;
  const q = String(question ?? '').trim();
  if (!q) {
    setAskStatus('Ask a question.', 'err');
    return;
  }
  state.ask.busy = true;
  $('ask-submit').disabled = true;
  setAskStatus('Retrieving context…');

  try {
    const res = await fetch(`${ASSISTANT_URL}/ask`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        // The user's own credential. The assistant relays it; the CORE
        // validates it and derives the principal (INV-4a).
        authorization: `Dev ${state.principalId}`,
      },
      body: JSON.stringify({ question: q, targetId: state.selected?.node?.id ?? null }),
    });
    const data = await res.json();
    if (!data.ok) {
      $('ask-out').hidden = true;
      setAskStatus(
        data.stage === 'context'
          ? `Context unavailable: ${data.detail}`
          : `Model unavailable: ${data.detail}`,
        'err',
      );
      return;
    }
    state.ask.result = data;
    renderAsk(data);
    // Same naming as the Skills cards: a development stub is called a
    // development stub, never dressed up as a model (T3.2 §8).
    setAskStatus(`${data.intent} · ${providerName(data.provider)}`, 'ok');
    $('ask-provider').textContent =
      `${providerName(data.provider).toUpperCase()} · ${data.weightSetVersion}`;
  } catch (err) {
    $('ask-out').hidden = true;
    setAskStatus(`Assistant unreachable: ${err.message}`, 'err');
  } finally {
    state.ask.busy = false;
    $('ask-submit').disabled = false;
  }
}

function wireAsk() {
  const openers = ['tool-ask'];
  for (const id of openers) {
    const e = $(id);
    if (!e) continue;
    e.addEventListener('click', openAsk);
    e.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault();
        openAsk();
      }
    });
  }
  $('ins-ask').onclick = () => {
    openAsk();
    $('ask-scope').textContent = askScopeLabel();
  };
  $('ask-close').onclick = () => {
    $('askp').hidden = true;
  };
  $('ask-form').onsubmit = (e) => {
    e.preventDefault();
    runAsk($('ask-input').value);
  };
  $('ask-summarize').onclick = () => {
    $('ask-input').value = 'Summarize this';
    runAsk('Summarize this');
  };
  $('ask-extract').onclick = () => {
    $('ask-input').value = 'Extract tasks from this';
    runAsk('Extract tasks from this');
  };
  $('ask-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      runAsk($('ask-input').value);
    }
  });
}

/* ------------------------------------------------------------ chrome ---- */

function wireGraphControls() {
  $('g-focus').onclick = () => view.focus();
  $('g-reset').onclick = () => {
    view.resetView();
    view.select(null);
  };
  $('t-reset').onclick = () => {
    view.resetView();
    view.select(null);
  };
  $('g-in').onclick = () => view.zoomBy(1.3);
  $('g-out').onclick = () => view.zoomBy(1 / 1.3);
  $('g-expand').onclick = () => view.expandAll();
  $('g-collapse').onclick = () => view.collapseAll();
  $('ins-focus').onclick = () => view.focus();
  $('gctl-toggle').onclick = () => {
    const panel = $('gctl');
    const open = !panel.classList.toggle('folded');
    $('gctl-toggle').setAttribute('aria-expanded', String(open));
    $('gctl-toggle').setAttribute(
      'aria-label',
      open ? 'Collapse graph controls' : 'Expand graph controls',
    );
    $('gctl-toggle').textContent = open ? '▾' : '▸';
  };

  // Project Pulse → Graph: re-focus the same project the header names.
  // `setPulseLink` only ever puts a real, already-visible project id on
  // `dataset.projectId`, so this is the same revealAndFocus path everything
  // else uses, not a second navigation mechanism.
  const pulseGo = () => {
    const id = $('pulse-name').dataset.projectId;
    if (id) goTo(id);
  };
  $('pulse-name').addEventListener('click', pulseGo);
  $('pulse-name').addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && $('pulse-name').dataset.projectId) {
      e.preventDefault();
      pulseGo();
    }
  });
}

/** Options are the workspace's REAL members once they have loaded; until then,
 *  the two dev-auth principals the boundary demo is built around. */
function renderPrincipalOptions() {
  const sel = $('principal');
  const options = state.members.length
    ? state.members.map((m) => ({ id: m.id, label: m.displayName }))
    : KNOWN_PRINCIPALS;
  sel.innerHTML = '';
  for (const p of options) {
    const o = document.createElement('option');
    o.value = p.id;
    o.textContent = p.label;
    if (p.id === state.principalId) o.selected = true;
    sel.append(o);
  }
}

function wirePrincipal() {
  const sel = $('principal');
  renderPrincipalOptions();
  sel.onchange = () => {
    state.principalId = sel.value;
    localStorage.setItem('dc.principalId', state.principalId);
    state.selected = null;
    view.select(null);
    loadGraph({ keepSelection: false });
  };
}

function wireCapture() {
  const focusForm = () => {
    $('note-title').focus();
    $('note-title').scrollIntoView({ block: 'center', behavior: 'smooth' });
  };
  for (const id of ['tool-capture']) {
    const e = $(id);
    e.addEventListener('click', () => {
      if (!state.selected) {
        const first = state.graph.nodes.find((n) => n.type === 'project');
        if (first) goTo(first.id);
      }
      setTimeout(focusForm, 80);
    });
    e.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault();
        e.click();
      }
    });
  }
  $('ins-close').onclick = () => view.select(null);

  $('cap-form').onsubmit = async (e) => {
    e.preventDefault();
    const target = captureTarget(state.selected?.node);
    if (!target) return;
    const st = $('cap-status');
    const sb = $('cap-submit');
    const title = $('note-title').value.trim();
    const body = $('note-body').value.trim();
    if (!title && !body) {
      st.textContent = 'Enter a title or body.';
      st.className = 'err';
      return;
    }
    sb.disabled = true;
    st.textContent = 'Persisting…';
    st.className = '';
    try {
      const { note } = await api(`/api/projects/${target.id}/notes`, {
        method: 'POST',
        body: JSON.stringify({ title, body }),
      });
      $('note-title').value = '';
      $('note-body').value = '';
      await loadGraph();
      // CAPTURE → CONNECT: the new object appears in the graph, already anchored.
      // Reported after the reload, which repaints the inspector.
      if (note?.id) view.setMatches([note.id]);
      st.textContent = 'Captured, persisted and connected.';
      st.className = 'ok';
    } catch (err) {
      st.textContent = `Not saved: ${err.message}`;
      st.className = 'err';
    } finally {
      sb.disabled = false;
    }
  };
}

function wireChrome() {
  $('toggle-left').onclick = () => document.body.classList.toggle('drawer-left');
  $('toggle-right').onclick = () => document.body.classList.toggle('drawer-right');
  $('t-search').onclick = openSpotlight;
  $('t-brain').onclick = () => (state.view === 'brain' ? exitBrain() : enterBrain());
  $('brain-back').onclick = exitBrain;
  $('t-help').onclick = () => {
    const hidden = $('center').querySelector('.field-wrap').classList.toggle('hud-hidden');
    $('t-help').setAttribute('aria-pressed', String(!hidden));
  };

  // Micro Apps that are pure navigation. Capture and Ask are wired by their
  // own flows; these two open a place and a mode that already exist.
  for (const [id, go] of [
    ['tool-brain', () => enterBrain()],
    ['tool-search', () => openSpotlight()],
  ]) {
    const e = $(id);
    if (!e) continue;
    e.addEventListener('click', () => {
      document.body.classList.remove('drawer-left', 'drawer-right');
      go();
    });
    e.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault();
        e.click();
      }
    });
  }

  document.addEventListener('keydown', (e) => {
    const typing = /input|textarea|select/i.test(document.activeElement?.tagName || '');
    if (e.key === 'Escape') {
      if (!$('spotlight').hidden) {
        closeSpotlight();
        return;
      }
      document.body.classList.remove('drawer-left', 'drawer-right');
      if ($('center').classList.contains('inspecting')) {
        view.select(null);
        return;
      }
      // Escape from the Second Brain returns to the OS — the way back is
      // always available, and always named on screen as well.
      if (state.view === 'brain') exitBrain();
    }
    if (typing) return;
    if (e.key === '/') {
      e.preventDefault();
      openSpotlight();
    }
    if (e.key === 'f') view.focus();
    if (e.key === '0') view.resetView();
    if (e.key === '+' || e.key === '=') view.zoomBy(1.3);
    if (e.key === '-') view.zoomBy(1 / 1.3);
  });
}

/* ----------------------------------------------------------- time (IST) --- */
//
// The primary clock is the USER's own wall time: Asia/Kolkata, 12-hour with a
// meridiem, ticking every second without a reload (T3.2 §11). Nothing here is
// hardcoded — the date, the weekday, the ISO week, the month matrix and the
// year grid are all derived from the same instant, in the same zone, so they
// can never disagree with each other or drift apart across midnight.

const TZ = 'Asia/Kolkata';
const TZ_LABEL = 'IST · INDIA';

/** The wall-clock fields of `date` as they read in `TZ`. */
function zoned(date, tz = TZ) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false, weekday: 'short',
  }).formatToParts(date);
  const get = (t) => parts.find((p) => p.type === t)?.value ?? '';
  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    hour: Number(get('hour')) % 24,
    minute: Number(get('minute')),
    second: Number(get('second')),
    weekday: get('weekday'),
  };
}

const pad2 = (n) => String(n).padStart(2, '0');
const MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

/** ISO-8601 week number of a zoned Y/M/D. */
function isoWeek({ year, month, day }) {
  const d = Date.UTC(year, month - 1, day);
  const dow = (new Date(d).getUTCDay() + 6) % 7; // Mon = 0
  const thursday = d + (3 - dow) * 86400000;
  const jan1 = Date.UTC(new Date(thursday).getUTCFullYear(), 0, 1);
  return 1 + Math.round((thursday - jan1) / (7 * 86400000));
}

/** Compact month matrix for the zoned month, Monday-first, today accented. */
function renderCalMatrix(z) {
  const host = $('calmatrix');
  if (!host) return;
  const key = `${z.year}-${z.month}-${z.day}`;
  if (host.dataset.key === key) return; // repaint only when the day changes
  host.dataset.key = key;
  host.textContent = '';
  for (const d of ['M', 'T', 'W', 'T', 'F', 'S', 'S']) {
    const h = document.createElement('i');
    h.className = 'hd';
    h.textContent = d;
    host.append(h);
  }
  const first = (new Date(Date.UTC(z.year, z.month - 1, 1)).getUTCDay() + 6) % 7;
  const days = new Date(Date.UTC(z.year, z.month, 0)).getUTCDate();
  for (let i = 0; i < first; i++) host.append(document.createElement('i'));
  for (let d = 1; d <= days; d++) {
    const c = document.createElement('i');
    c.className = d === z.day ? 'd now' : d < z.day ? 'd past' : 'd';
    c.textContent = String(d);
    host.append(c);
  }
}

/** 52-cell year grid, four quarters of thirteen weeks; this week accented. */
function renderQGrid(z) {
  const host = $('qgrid');
  if (!host) return;
  const wk = Math.min(52, isoWeek(z));
  if (host.dataset.wk === String(wk)) return;
  host.dataset.wk = String(wk);
  host.textContent = '';
  for (let i = 1; i <= 52; i++) {
    const c = document.createElement('i');
    if (i === wk) c.className = 'now';
    else if (i < wk) c.className = 'done';
    host.append(c);
  }
}

function startClock() {
  const tick = () => {
    const now = new Date();
    const z = zoned(now);
    const h12 = z.hour % 12 === 0 ? 12 : z.hour % 12;
    const meridiem = z.hour < 12 ? 'AM' : 'PM';
    $('clock').textContent = `${pad2(h12)}:${pad2(z.minute)}:${pad2(z.second)} ${meridiem}`;
    $('wk').textContent =
      `WK${isoWeek(z)} | ${MONTHS_SHORT[z.month - 1]} ${z.day} ${z.year} (${z.weekday})`;
    $('clock-utc').textContent = 'UTC+05:30';
    $('cal-today').textContent = 'today';
    renderCalMatrix(z);
    renderQGrid(z);
  };
  tick();
  setInterval(tick, 1000);
}

/* ------------------------------------------------------ workspace members -- */
//
// Display name and workspace membership — the whole of what the model records
// about a person. No e-mail, avatar, role, external account, contribution or
// activity exists in the schema, so none is rendered and none is inferred
// (T3.2 §13, §23).

async function loadMembers() {
  const host = $('team-list');
  const note = $('team-note');
  if (!host) return;
  try {
    const { members } = await api('/api/workspace/members');
    state.members = members ?? [];
  } catch {
    state.members = [];
  }
  host.textContent = '';
  note.textContent = state.members.length ? `${state.members.length} members` : 'unavailable';
  for (const m of state.members) {
    const li = document.createElement('li');
    li.className = 'tm-row' + (m.id === state.principalId ? ' me' : '');
    const chip = document.createElement('span');
    chip.className = 'tm-chip';
    chip.textContent = (m.displayName || '?').trim().charAt(0).toUpperCase();
    const nm = document.createElement('span');
    nm.className = 'tm-name';
    nm.textContent = m.displayName;
    const you = document.createElement('span');
    you.className = 'tm-you label';
    you.textContent = m.id === state.principalId ? 'you' : '';
    li.append(chip, nm, you);
    host.append(li);
  }
  renderPrincipalOptions();
  if (state.graph?.stats) {
    $('brand-id').textContent = `${principalLabel(state.principalId)} | Workspace`;
  }
}

/* ----------------------------------------------------- workflows (right rail) */
//
// Named, one-press developer actions. Each delegates to a real, already-wired
// capability — the left-rail capture flow, or the P3.4 assistant panel and its
// summarize / extract actions — so nothing here claims an executable the
// backend does not have. They run against the current selection scope.
function wireWorkflows() {
  // One runner for all three invocation surfaces — the command ring, the
  // Second Brain's inner ring and these cards — so a capability cannot behave
  // differently depending on where it was pressed.
  const run = {
    'flow-capture': () => runCapability('capture'),
    'flow-ask': () => runCapability('ask'),
    'flow-summarize': () => runCapability('summarize'),
    'flow-extract': () => runCapability('extract'),
  };
  for (const [id, go] of Object.entries(run)) {
    const e = $(id);
    if (!e) continue;
    e.addEventListener('click', () => {
      document.body.classList.remove('drawer-left', 'drawer-right');
      go();
    });
    e.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault();
        e.click();
      }
    });
  }
}

document.body.dataset.view = 'os';
wirePrincipal();
wireGraphControls();
wireAsk();
wireSearch();
wireSpotlight();
wireCapture();
wireWorkflows();
wireChrome();
startClock();
probeAssistant();
closeInspector();
loadMembers();
loadGraph({ keepSelection: false });
