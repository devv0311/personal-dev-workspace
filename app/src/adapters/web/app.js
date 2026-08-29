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

const state = {
  principalId: localStorage.getItem('dc.principalId') || KNOWN_PRINCIPALS[0].id,
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
    $('ro-tl').textContent = `CONTEXT GRAPH · LIVE · ${graph.workspaceId.slice(0, 8)}`;

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
  const chips = filterChipsFor(graph);
  for (const chip of chips) {
    const b = document.createElement('button');
    b.className = `chip on ${chip.accent}`;
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
  // Scaffold layers: no integration is connected and no routine engine exists,
  // so these are toggles over the offline orbit scaffold, labelled as such.
  for (const [key, label] of [
    ['apps', 'Apps'],
    ['routines', 'Routines'],
  ]) {
    const b = document.createElement('button');
    b.className = `chip on ${key} scaffold`;
    b.type = 'button';
    b.setAttribute('aria-pressed', 'true');
    b.title = 'Orbit scaffold — no integration connected yet';
    b.innerHTML = `<span class="sw"></span>${label}`;
    b.onclick = () => {
      const on = b.classList.toggle('on');
      b.setAttribute('aria-pressed', String(on));
      view.setScaffold(key, on);
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
  $('ins-dot').className = `dot ${meta.accent === 'context' ? 'action' : meta.accent}`;
  $('ins-id').textContent = `${node.id.slice(0, 8)}…`;
  $('ins-body').hidden = true;
  $('ctx-list').textContent = '';
  $('rel-list').textContent = '';
  $('ctx-empty').hidden = true;
  $('rel-empty').hidden = true;
  $('ins-children-label').hidden = true;

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

    const rels = detail.edges;
    for (const r of rels) {
      $('rel-list').append(relationshipRow(r, o.id));
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

/** One real relationship edge, traversable to the object at its far end. */
function relationshipRow(r, selfId) {
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

  const prov = document.createElement('span');
  prov.className = 'pv';
  prov.textContent = r.edge.synthesised
    ? r.edge.provenance.kind
    : `${r.edge.origin} · ${r.edge.confidenceState}`;

  btn.append(verb, dir, other, prov);
  if (r.other) btn.onclick = () => view.revealAndFocus(r.other.id);
  li.append(btn);
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
    $('pulse-name').textContent = (node.title || 'CONTEXT CORE').toUpperCase();
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
    view.setMatches([]);
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
  view.setMatches(state.results.map((n) => n.id));
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
  for (const id of ['tool-capture', 'skill-capture']) {
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
wireSearch();
wireCapture();
wireChrome();
startClock();
closeInspector();
loadGraph({ keepSelection: false });
