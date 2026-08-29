// P3.1 — Static Visual Shell wiring.
// Uses only the P2.7 API (/api/me, /api/projects, /api/projects/:id, POST notes).
// No graph engine: the central field is static SVG. No new application state —
// projects/captures come from the real endpoints; preview widgets are labelled.

const KNOWN_PRINCIPALS = [
  { id: '00000000-0000-4000-8000-0000000000a1', label: 'Alice · owner' },
  { id: '00000000-0000-4000-8000-0000000000b0', label: 'Bob · member (no access)' },
];

const NS = 'http://www.w3.org/2000/svg';
const CX = 500;
const CY = 500;
const R_OUTER = 432;
const R_MID = 312;
const R_CORE = 156;

const state = {
  principalId: localStorage.getItem('dc.principalId') || KNOWN_PRINCIPALS[0].id,
  projects: [],
  selectedId: null,
};

const $ = (id) => document.getElementById(id);

/* ---- API --------------------------------------------------------------- */
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
    const err = new Error(data.error || `HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

/* ---- deterministic PRNG for the static particle core ------------------ */
function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function el(name, attrs, parent) {
  const node = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  if (parent) parent.append(node);
  return node;
}

/* ---- central context field (static shell) --------------------------- */
function buildRings() {
  const g = $('field-rings');
  g.textContent = '';
  el('circle', { class: 'ring spin primary', cx: CX, cy: CY, r: R_OUTER }, g);
  el('circle', { class: 'ring', cx: CX, cy: CY, r: R_MID }, g);
  el('circle', { class: 'ring', cx: CX, cy: CY, r: R_CORE }, g);
}

function buildCore() {
  const g = $('field-core');
  g.textContent = '';
  // dense, organic, computational — but static (no physics this milestone)
  const rand = mulberry32(0x9e3779b9);
  for (let i = 0; i < 150; i++) {
    const ang = rand() * Math.PI * 2;
    const rad = Math.pow(rand(), 0.55) * (R_CORE - 10);
    el(
      'circle',
      {
        class: 'core-dot',
        cx: (CX + Math.cos(ang) * rad).toFixed(1),
        cy: (CY + Math.sin(ang) * rad).toFixed(1),
        r: (0.6 + rand() * 1.5).toFixed(2),
        opacity: (0.18 + rand() * 0.5).toFixed(2),
      },
      g,
    );
  }
  // a few faint inter-particle links — "network structure", still static
  const linkRand = mulberry32(0x1234abcd);
  for (let i = 0; i < 18; i++) {
    const a1 = linkRand() * Math.PI * 2;
    const a2 = a1 + (linkRand() - 0.5) * 1.2;
    const r1 = linkRand() * (R_CORE - 20);
    const r2 = linkRand() * (R_CORE - 20);
    el(
      'line',
      {
        class: 'core-link',
        x1: (CX + Math.cos(a1) * r1).toFixed(1),
        y1: (CY + Math.sin(a1) * r1).toFixed(1),
        x2: (CX + Math.cos(a2) * r2).toFixed(1),
        y2: (CY + Math.sin(a2) * r2).toFixed(1),
      },
      g,
    );
  }
}

function nodePoint(index, total) {
  const ang = -Math.PI / 2 + (index / Math.max(total, 1)) * Math.PI * 2;
  return { x: CX + Math.cos(ang) * R_OUTER, y: CY + Math.sin(ang) * R_OUTER, ang };
}

function renderField() {
  const nodesG = $('field-nodes');
  const radialsG = $('field-radials');
  nodesG.textContent = '';
  radialsG.textContent = '';

  const total = state.projects.length;
  $('field-count').textContent = `${total} node${total === 1 ? '' : 's'}`;
  $('field-empty').hidden = total > 0;

  state.projects.forEach((p, i) => {
    const { x, y } = nodePoint(i, total);
    const selected = p.id === state.selectedId;

    el(
      'line',
      { class: `radial${selected ? ' hot' : ''}`, x1: CX, y1: CY, x2: x, y2: y },
      radialsG,
    );

    const g = el('g', {
      class: `node${selected ? ' selected' : ''}`,
      tabindex: '0',
      role: 'button',
      'aria-label': `Project ${p.title}`,
      transform: `translate(${x.toFixed(1)} ${y.toFixed(1)})`,
    }, nodesG);
    el('circle', { class: 'disc', r: 25 }, g);
    const glyph = el('text', { class: 'glyph', y: 1 }, g);
    glyph.textContent = p.title.slice(0, 2).toUpperCase();
    const cap = el('text', { class: 'cap', y: 44 }, g);
    cap.textContent = p.title.length > 24 ? p.title.slice(0, 23) + '…' : p.title;

    const activate = () => selectProject(p.id);
    g.addEventListener('click', activate);
    g.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        activate();
      }
    });
  });
}

/* ---- inspector + pulse (real data) --------------------------------- */
function renderActivityGrid(count) {
  const grid = $('activity-grid');
  grid.textContent = '';
  const cells = 21;
  for (let i = 0; i < cells; i++) {
    const cell = document.createElement('i');
    // real signal: light up cells proportional to captured context
    if (i < Math.min(count, cells)) cell.className = 'on';
    grid.append(cell);
  }
}

async function selectProject(id) {
  state.selectedId = id;
  renderField();
  try {
    const view = await api(`/api/projects/${id}`);
    $('inspector-empty').hidden = true;
    $('inspector-body').hidden = false;
    $('insp-title').textContent = view.project.title;
    $('insp-id').textContent = view.project.id.slice(0, 8) + '…';
    const countText =
      view.captures.length === 1 ? '1 capture' : `${view.captures.length} captures`;
    $('insp-count').textContent = countText;
    $('insp-bar-count').textContent = countText;

    const list = $('context-list');
    list.textContent = '';
    $('context-empty').hidden = view.captures.length > 0;
    for (const { object, anchoredBy } of view.captures) {
      const li = document.createElement('li');
      const h = document.createElement('h3');
      h.textContent = object.title || '(untitled note)';
      li.append(h);
      if (object.body) {
        const p = document.createElement('p');
        p.textContent = object.body;
        li.append(p);
      }
      const edge = document.createElement('span');
      edge.className = 'edge';
      const code = document.createElement('code');
      code.textContent = anchoredBy.verb;
      edge.append(code, document.createTextNode(' → this project'));
      if (anchoredBy.synthesised) {
        edge.append(document.createTextNode('  (edge from home_project_id)'));
      }
      li.append(edge);
      list.append(li);
    }

    // Project Pulse — captures is real; open/blocked stay labelled Preview.
    $('pulse-name').textContent = view.project.title.toUpperCase();
    $('pulse-captures').textContent = String(view.captures.length);
    $('today-project').textContent = view.project.title;
    $('today-session').textContent = 'active';
    renderActivityGrid(view.captures.length);

    // enable capture
    $('capture-submit').disabled = false;
    $('capture-status').textContent = 'Ready.';
    $('capture-status').className = '';
  } catch (err) {
    $('inspector-empty').hidden = false;
    $('inspector-body').hidden = true;
    $('inspector-empty').textContent =
      err.status === 404 ? 'That project is not available to you.' : `Error: ${err.message}`;
    $('capture-submit').disabled = true;
  }
}

/* ---- boot ---------------------------------------------------------- */
async function loadProjects() {
  try {
    const me = await api('/api/me');
    $('ctx-workspace').textContent = me.workspaceId.slice(0, 8) + '…';
  } catch {
    $('ctx-workspace').textContent = '—';
  }
  try {
    const { projects } = await api('/api/projects');
    state.projects = projects;
    if (state.selectedId && !projects.some((p) => p.id === state.selectedId)) {
      state.selectedId = null;
      $('inspector-empty').hidden = false;
      $('inspector-body').hidden = true;
      $('inspector-empty').textContent = 'Select a context node to inspect its captured context.';
      $('insp-bar-count').textContent = '—';
      $('capture-submit').disabled = true;
      $('capture-status').textContent = 'Select a project first.';
      $('pulse-name').textContent = 'NO PROJECT SELECTED';
      $('pulse-captures').textContent = '0';
      $('today-project').textContent = '—';
      $('today-session').textContent = 'idle';
      renderActivityGrid(0);
    }
    renderField();
  } catch (err) {
    state.projects = [];
    renderField();
    $('field-empty').hidden = false;
    $('field-empty').querySelector('.big').textContent =
      err.status === 401 ? 'Not authenticated' : 'Could not load context';
  }
}

function wirePrincipalPicker() {
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
    loadProjects();
  };
}

function wireCapture() {
  const form = $('capture-form');
  const focusCapture = () => {
    $('note-title').focus();
    $('note-title').scrollIntoView({ block: 'center', behavior: 'smooth' });
  };
  $('tool-capture').addEventListener('click', focusCapture);
  $('tool-capture').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); focusCapture(); }
  });
  $('skill-capture').addEventListener('click', focusCapture);
  $('skill-capture').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); focusCapture(); }
  });

  form.onsubmit = async (e) => {
    e.preventDefault();
    if (!state.selectedId) return;
    const status = $('capture-status');
    const submit = $('capture-submit');
    const title = $('note-title').value.trim();
    const body = $('note-body').value.trim();
    if (!title && !body) {
      status.textContent = 'Enter a title or a body.';
      status.className = 'err';
      return;
    }
    submit.disabled = true;
    status.textContent = 'Persisting…';
    status.className = '';
    try {
      // success reported only after authoritative 201
      await api(`/api/projects/${state.selectedId}/notes`, {
        method: 'POST',
        body: JSON.stringify({ title, body }),
      });
      $('note-title').value = '';
      $('note-body').value = '';
      status.textContent = 'Captured and persisted.';
      status.className = 'ok';
      $('last-capture-time').textContent = new Date().toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      });
      await selectProject(state.selectedId);
    } catch (err) {
      status.textContent = `Not saved: ${err.message}`;
      status.className = 'err';
    } finally {
      submit.disabled = false;
    }
  };
}

function wireChrome() {
  // view-mode segmented control (GRID active; GRAPH is a preview placeholder)
  const grid = $('view-grid');
  const graph = $('view-graph');
  grid.onclick = () => {
    grid.setAttribute('aria-pressed', 'true');
    graph.setAttribute('aria-pressed', 'false');
  };
  graph.onclick = () => {
    graph.setAttribute('aria-pressed', 'true');
    grid.setAttribute('aria-pressed', 'false');
  };

  // laptop drawer toggles
  $('toggle-left').onclick = () => document.body.classList.toggle('drawer-left');
  $('toggle-right').onclick = () => document.body.classList.toggle('drawer-right');
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') document.body.classList.remove('drawer-left', 'drawer-right');
  });

  // '/' focuses the (placeholder) search trigger label — keeps the affordance honest
  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && !/input|textarea/i.test(document.activeElement?.tagName || '')) {
      e.preventDefault();
      document.querySelector('.search-trigger').focus();
    }
  });
}

function startClock() {
  const tick = () => {
    const now = new Date();
    $('clock').textContent = now.toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
  };
  tick();
  setInterval(tick, 30_000);
}

buildRings();
buildCore();
renderActivityGrid(0);
wirePrincipalPicker();
wireCapture();
wireChrome();
startClock();
loadProjects();
