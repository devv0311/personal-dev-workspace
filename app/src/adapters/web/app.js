// P3.2 — shell wiring for the interactive Context Graph.
//
// Every node, edge and inspector field below comes from the P2.7 API under the
// current principal: /api/graph, /api/objects/:id, /api/projects/:id/notes.
// There is no mock graph dataset. The same object id is the graph node id, the
// inspector subject, the capture target and the API path — one object, one id,
// end to end.

import { createGraphView } from './graph-view.js';
import {
  filterChipsFor,
  searchNodes,
  metaFor,
  recentActivity,
  pulseLinkTarget,
} from './graph-model.js';

const KNOWN_PRINCIPALS = [
  { id: '00000000-0000-4000-8000-0000000000a1', label: 'Alice · owner' },
  { id: '00000000-0000-4000-8000-0000000000b0', label: 'Bob · no access' },
];

/** The assistant service (Zone B). Separate origin: it holds no DB credential. */
const ASSISTANT_URL = localStorage.getItem('dc.assistantUrl') || 'http://localhost:4178';

const state = {
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
  onSelect: (node) => {
    if (!node) closeInspector();
    else openInspector(node);
  },
  onState: (s) => {
    if (typeof s.zoom === 'number') $('g-zoom').textContent = `${Math.round(s.zoom * 100)}%`;
    if (typeof s.visible === 'number') $('ro-tr').textContent = `${s.visible} / ${s.total} NODES`;
  },
});

async function loadGraph({ keepSelection = true } = {}) {
  try {
    const graph = await api('/api/graph');
    state.graph = graph;
    view.render(graph);
    renderFilters(graph);
    renderPulse(graph);

    $('field-empty').hidden = graph.stats.projects > 0 || graph.stats.captures > 0;
    $('ro-tl').textContent = `WORKSPACE · ${graph.workspaceId.slice(0, 8)}`;

    const keep = keepSelection && state.selected ? state.selected.node.id : null;
    if (keep && graph.nodes.some((n) => n.id === keep)) view.select(keep);
    else closeInspector();
  } catch (err) {
    state.graph = { nodes: [], edges: [], stats: { projects: 0, captures: 0 } };
    view.render(state.graph);
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

function closeInspector() {
  state.selected = null;
  if (!$('askp').hidden) $('ask-scope').textContent = 'Whole workspace';
  $('center').classList.remove('inspecting');
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

    const n = detail.children.length;
    $('ins-count').textContent =
      o.type === 'project'
        ? `${n} capture${n === 1 ? '' : 's'} · ${rels.length} link${rels.length === 1 ? '' : 's'}`
        : `${rels.length} relationship${rels.length === 1 ? '' : 's'}`;

    renderPulse(state.graph, node, detail);
  } catch (err) {
    state.selected = { node, detail: null };
    $('ins-meta').textContent = '';
    $('ctx-empty').hidden = false;
    $('ctx-empty').textContent =
      err.status === 404
        ? 'This object is not visible to the current principal.'
        : err.message;
    $('cap-submit').disabled = true;
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
  btn.onclick = () => view.revealAndFocus(id);
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
  const other = document.createElement('span');
  other.className = 'ot';
  other.textContent = r.other ? r.other.title || '(untitled)' : 'not visible';

  const state = r.edge.synthesised ? 'structural' : r.edge.confidenceState;
  const conf = document.createElement('span');
  conf.className = 'conf' + (state === 'inferred_high' ? ' inferred' : '');
  conf.textContent = CONFIDENCE_LABEL[state] || state || 'known';

  btn.append(verb, dir, other, conf);
  if (r.other) btn.onclick = () => view.revealAndFocus(r.other.id);
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
      const go = () => view.revealAndFocus(item.id);
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
function renderQGrid() {
  const g = $('qgrid');
  g.textContent = '';
  const now = new Date();
  const cell = Math.floor((now.getHours() * 60 + now.getMinutes()) / (1440 / 52));
  for (let i = 0; i < 52; i++) {
    const c = document.createElement('i');
    if (i === cell % 52) c.className = 'now';
    else if (i < cell % 52) c.className = 'done';
    g.append(c);
  }
}

/* ---------------------------------------------------------------- search -- */

function renderResults() {
  const host = $('g-results');
  host.textContent = '';
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
  view.revealAndFocus(node.id);
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

    btn.onclick = () => view.revealAndFocus(c.objectId);
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
  open.onclick = () => proposal.sourceObjectId && view.revealAndFocus(proposal.sourceObjectId);

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
      openTask.onclick = () => view.revealAndFocus(task.id);
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
    setAskStatus(`${data.intent} · ${data.provider}`, 'ok');
    $('ask-provider').textContent = `${data.provider.toUpperCase()} · ${data.weightSetVersion}`;
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
  $('p-graph').onclick = () => view.resetView();
  $('g-in').onclick = () => view.zoomBy(1.3);
  $('g-out').onclick = () => view.zoomBy(1 / 1.3);
  $('g-expand').onclick = () => view.expandAll();
  $('g-collapse').onclick = () => view.collapseAll();
  $('ins-focus').onclick = () => view.focus();
  $('gctl-toggle').onclick = () => {
    const panel = $('gctl');
    const open = !panel.classList.toggle('folded');
    $('gctl-toggle').setAttribute('aria-expanded', String(open));
    $('gctl-toggle').textContent = open ? '▾' : '▸';
  };

  // Project Pulse → Graph: re-focus the same project the header names.
  // `setPulseLink` only ever puts a real, already-visible project id on
  // `dataset.projectId`, so this is the same revealAndFocus path everything
  // else uses, not a second navigation mechanism.
  const pulseGo = () => {
    const id = $('pulse-name').dataset.projectId;
    if (id) view.revealAndFocus(id);
  };
  $('pulse-name').addEventListener('click', pulseGo);
  $('pulse-name').addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && $('pulse-name').dataset.projectId) {
      e.preventDefault();
      pulseGo();
    }
  });
}

function wirePrincipal() {
  const sel = $('principal');
  sel.innerHTML = '';
  for (const p of KNOWN_PRINCIPALS) {
    const o = document.createElement('option');
    o.value = p.id;
    o.textContent = p.label;
    if (p.id === state.principalId) o.selected = true;
    sel.append(o);
  }
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
        if (first) view.revealAndFocus(first.id);
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
  $('t-search').onclick = () => $('g-search').focus();
  document.addEventListener('keydown', (e) => {
    const typing = /input|textarea|select/i.test(document.activeElement?.tagName || '');
    if (e.key === 'Escape') {
      document.body.classList.remove('drawer-left', 'drawer-right');
      if ($('center').classList.contains('inspecting')) view.select(null);
    }
    if (typing) return;
    if (e.key === '/') {
      e.preventDefault();
      $('g-search').focus();
    }
    if (e.key === 'f') view.focus();
    if (e.key === '0') view.resetView();
    if (e.key === '+' || e.key === '=') view.zoomBy(1.3);
    if (e.key === '-') view.zoomBy(1 / 1.3);
  });
}

function startClock() {
  const fmt = (d, tz) =>
    d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: tz, hour12: false });
  const tick = () => {
    const now = new Date();
    $('clock').textContent = now.toLocaleTimeString('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
    try {
      $('tz-pt').textContent = fmt(now, 'America/Los_Angeles');
      $('tz-et').textContent = fmt(now, 'America/New_York');
      $('tz-ln').textContent = fmt(now, 'Europe/London');
    } catch {
      /* older engines */
    }
    renderQGrid();
  };
  tick();
  setInterval(tick, 20_000);
}

wirePrincipal();
wireGraphControls();
wireAsk();
wireSearch();
wireCapture();
wireChrome();
startClock();
closeInspector();
loadGraph({ keepSelection: false });
