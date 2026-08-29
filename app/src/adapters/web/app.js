// P3.1 static visual shell — wiring.
// Real data via the P2.7 API only (/api/me, /api/projects, /api/projects/:id,
// POST notes). The centre is a STATIC SVG built to read as the RUBRIC
// reference: concentric Applications / Routines / Memory layers, project
// nodes near the core, a particle core. No graph engine, no physics.

const KNOWN_PRINCIPALS = [
  { id: '00000000-0000-4000-8000-0000000000a1', label: 'Alice · owner' },
  { id: '00000000-0000-4000-8000-0000000000b0', label: 'Bob · no access' },
];

const NS = 'http://www.w3.org/2000/svg';
const CX = 500, CY = 500;
const R_APPS = 478, R_RT = 410, R_MEM = 338, R_CORE = 150, R_PROJ = 128;

const state = {
  principalId: localStorage.getItem('dc.principalId') || KNOWN_PRINCIPALS[0].id,
  projects: [],
  selectedId: null,
};
const $ = (id) => document.getElementById(id);

/* ---- API ---- */
async function api(path, opts = {}) {
  const res = await fetch(path, {
    ...opts,
    headers: { 'content-type': 'application/json', authorization: `Dev ${state.principalId}`, ...(opts.headers || {}) },
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) { const e = new Error(data.error || `HTTP ${res.status}`); e.status = res.status; throw e; }
  return data;
}

/* ---- deterministic PRNG ---- */
function rng(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function el(name, attrs, parent) {
  const n = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
  if (parent) parent.append(n);
  return n;
}
function hexPath(cx, cy, r) {
  let d = '';
  for (let i = 0; i < 6; i++) {
    const a = -Math.PI / 2 + i * Math.PI / 3;
    d += (i ? 'L' : 'M') + (cx + Math.cos(a) * r).toFixed(1) + ' ' + (cy + Math.sin(a) * r).toFixed(1) + ' ';
  }
  return d + 'Z';
}

/* ---- static scaffold: rings, layer labels, apps + routines nodes, core ---- */
const APP_GLYPHS = ['◆', '●', '▲', '■', '✦', '◇', '◈', '▸', '✕', '◎'];

function buildScaffold() {
  const rg = $('f-rings'); rg.textContent = '';
  el('circle', { class: 'ring apps spin', cx: CX, cy: CY, r: R_APPS }, rg);
  el('circle', { class: 'ring routines', cx: CX, cy: CY, r: R_RT }, rg);
  el('circle', { class: 'ring memory', cx: CX, cy: CY, r: R_MEM }, rg);

  const lg = $('f-labels'); lg.textContent = '';
  const lbl = (r, cls, txt) => { const t = el('text', { class: `ring-label ${cls}`, x: CX, y: CY - r + 22 }, lg); t.textContent = txt; };
  lbl(R_APPS, 'apps', 'Applications');
  lbl(R_RT, 'routines', 'Routines');
  lbl(R_MEM, 'memory', 'Memory');

  // applications ring — hex icon badges (representative / offline)
  const ag = $('f-apps'); ag.textContent = '';
  const nApps = 16;
  for (let i = 0; i < nApps; i++) {
    const a = -Math.PI / 2 + 0.19 + (i / nApps) * Math.PI * 2;
    const x = CX + Math.cos(a) * R_APPS, y = CY + Math.sin(a) * R_APPS;
    const g = el('g', { class: 'app-badge dim', transform: `translate(${x.toFixed(1)} ${y.toFixed(1)})`, 'aria-hidden': 'true' }, ag);
    el('path', { class: 'hex', d: hexPath(0, 0, 15) }, g);
    const t = el('text', { class: 'g', y: 0.5 }, g);
    t.textContent = APP_GLYPHS[i % APP_GLYPHS.length];
  }

  // routines ring — small nodes
  const rt = $('f-rt'); rt.textContent = '';
  const nRt = 30;
  for (let i = 0; i < nRt; i++) {
    const a = -Math.PI / 2 + 0.11 + (i / nRt) * Math.PI * 2;
    el('circle', { class: 'rt-node', cx: (CX + Math.cos(a) * R_RT).toFixed(1), cy: (CY + Math.sin(a) * R_RT).toFixed(1), r: 3.4 }, rt);
  }

  // particle core — a tight dense cloud, mostly memory-purple with accent specks
  const cg = $('f-core'); cg.textContent = '';
  const r1 = rng(0x9e3779b9);
  for (let i = 0; i < 340; i++) {
    const ang = r1() * Math.PI * 2;
    const rad = Math.pow(r1(), 0.85) * (R_CORE - 10);
    const roll = r1();
    const fill = roll > 0.92 ? 'var(--action)' : roll > 0.85 ? 'var(--apps)' : 'var(--memory)';
    el('circle', {
      class: 'core-dot',
      cx: (CX + Math.cos(ang) * rad).toFixed(1), cy: (CY + Math.sin(ang) * rad).toFixed(1),
      r: (0.5 + r1() * 1.4).toFixed(2), fill, opacity: (0.28 + r1() * 0.5).toFixed(2),
    }, cg);
  }
  const r2 = rng(0x1234abcd);
  for (let i = 0; i < 22; i++) {
    const a1 = r2() * Math.PI * 2, a2 = a1 + (r2() - 0.5) * 1.1;
    const rr1 = r2() * (R_CORE - 16), rr2 = r2() * (R_CORE - 16);
    el('line', { class: 'core-link',
      x1: (CX + Math.cos(a1) * rr1).toFixed(1), y1: (CY + Math.sin(a1) * rr1).toFixed(1),
      x2: (CX + Math.cos(a2) * rr2).toFixed(1), y2: (CY + Math.sin(a2) * rr2).toFixed(1) }, cg);
  }

  // centre hex node
  const ce = $('f-centre'); ce.textContent = '';
  el('path', { class: 'corehex', d: hexPath(CX, CY, 26) }, ce);
  const ct = el('text', { class: 'core-label', x: CX, y: CY + 44 }, ce);
  ct.textContent = 'CONTEXT.CORE';
}

/* ---- data-driven layer: memory dot-arcs + project nodes + edges ---- */
function renderField() {
  const memG = $('f-mem'), edgeG = $('f-edges'), projG = $('f-projects');
  memG.textContent = ''; edgeG.textContent = ''; projG.textContent = '';

  const projects = state.projects;
  const nProj = projects.length;
  const totalCtx = projects.reduce((n, p) => n + (p.captures?.length || 0), 0);
  $('ro-tr').textContent = `${nProj} PROJ · ${totalCtx} CTX`;
  $('field-empty').hidden = nProj > 0;

  // MEMORY FIELD — a full 360° field of dense concentric dot-rings, always
  // visible as a faint scaffold. Each project forms a bright "cluster" wedge
  // centred on its node angle; the number of inner rings lit in that wedge
  // tracks its real capture count (reference B: BUSINESS / CONTENT / … wedges).
  const ARCS = 22;
  const rr = rng(0xbeef1);
  const startAngle = -Math.PI / 2 + 0.55; // first project at ~10 o'clock
  const clusters = projects.map((p, i) => ({
    ang: startAngle + (i / Math.max(nProj, 1)) * Math.PI * 2,
    lit: Math.min(p.captures?.length || 0, ARCS),
    selected: p.id === state.selectedId,
  }));
  const HALF = 0.46; // ~26° half-width wedge
  const R_IN = R_CORE + 12, R_OUT = R_MEM - 12;
  for (let a = 0; a < ARCS; a++) {
    const radius = R_IN + (a / (ARCS - 1)) * (R_OUT - R_IN);
    const step = 5.0 / radius;
    for (let ang = 0; ang < Math.PI * 2 - 1e-6; ang += step) {
      // strongest cluster influence at this angle
      let boost = 0, sel = false;
      for (const c of clusters) {
        let d = Math.abs(((ang - c.ang + Math.PI) % (Math.PI * 2)) - Math.PI);
        if (d < HALF && a < c.lit) {
          const w = 1 - d / HALF;
          if (w > boost) { boost = w; sel = c.selected; }
        }
      }
      const R = radius + (rr() - 0.5) * 2.4;
      const on = boost > 0.05;
      el('circle', {
        class: 'mem-dot',
        cx: (CX + Math.cos(ang) * R).toFixed(1),
        cy: (CY + Math.sin(ang) * R).toFixed(1),
        r: on ? (1.4 + boost * 0.9).toFixed(1) : 1.0,
        opacity: (on ? (sel ? 0.5 + boost * 0.45 : 0.4 + boost * 0.4) : 0.22 + rr() * 0.16).toFixed(2),
      }, memG);
    }
  }

  // PROJECT NODES — small labelled dots near the core (like reference B's
  // BUSINESS / CONTENT / … sub-clusters), one per real project; edge to centre.
  projects.forEach((p, i) => {
    const a = startAngle + (i / Math.max(nProj, 1)) * Math.PI * 2;
    const x = CX + Math.cos(a) * R_PROJ, y = CY + Math.sin(a) * R_PROJ;
    const selected = p.id === state.selectedId;
    el('line', { class: `edge-line${selected ? ' hot' : ''}`, x1: CX, y1: CY, x2: x.toFixed(1), y2: y.toFixed(1) }, edgeG);

    const g = el('g', {
      class: `pnode${selected ? ' selected' : ''}`, tabindex: '0', role: 'button',
      'aria-label': `Project ${p.title}, ${p.captures?.length || 0} captured context items`,
      transform: `translate(${x.toFixed(1)} ${y.toFixed(1)})`,
    }, projG);
    el('circle', { class: 'hit', r: 20, fill: 'transparent' }, g); // generous click target
    el('circle', { class: 'disc', r: 8 }, g);
    const below = Math.sin(a) > 0;
    const lbl = el('text', { class: 'lbl', y: below ? 21 : -15 }, g);
    lbl.textContent = (p.title.length > 22 ? p.title.slice(0, 21) + '…' : p.title).toUpperCase();
    const go = () => selectProject(p.id);
    g.addEventListener('click', go);
    g.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
  });
}

/* ---- inspector ---- */
function closeInspector() {
  state.selectedId = null;
  $('center').classList.remove('inspecting');
  renderField();
  $('pulse-name').textContent = 'No project selected';
  $('pulse-captures').textContent = '0';
  $('cap-submit').disabled = true;
  $('cap-status').textContent = 'Select a project first.';
  renderActGrid(0);
}

async function selectProject(id) {
  state.selectedId = id;
  renderField();
  try {
    const view = await api(`/api/projects/${id}`);
    const p = state.projects.find((x) => x.id === id);
    if (p) { p.captures = view.captures; renderField(); }

    $('center').classList.add('inspecting');
    $('ins-title').textContent = view.project.title;
    $('ins-id').textContent = view.project.id.slice(0, 8) + '…';
    const ct = view.captures.length === 1 ? '1 capture' : `${view.captures.length} captures`;
    $('ins-count').textContent = ct;

    const list = $('ctx-list'); list.textContent = '';
    $('ctx-empty').hidden = view.captures.length > 0;
    for (const { object, anchoredBy } of view.captures) {
      const li = document.createElement('li');
      const h = document.createElement('h3'); h.textContent = object.title || '(untitled note)'; li.append(h);
      if (object.body) { const pr = document.createElement('p'); pr.textContent = object.body; li.append(pr); }
      const edge = document.createElement('span'); edge.className = 'edge';
      const code = document.createElement('code'); code.textContent = anchoredBy.verb;
      edge.append(code, document.createTextNode(' → this project'));
      if (anchoredBy.synthesised) edge.append(document.createTextNode('  (home_project_id)'));
      li.append(edge); list.append(li);
    }

    $('pulse-name').textContent = view.project.title.toUpperCase();
    $('pulse-captures').textContent = String(view.captures.length);
    renderActGrid(view.captures.length);
    $('cap-submit').disabled = false;
    $('cap-status').textContent = 'Ready.'; $('cap-status').className = '';
  } catch (err) {
    $('center').classList.add('inspecting');
    $('ins-title').textContent = err.status === 404 ? 'Not available to you' : 'Error';
    $('ctx-list').textContent = ''; $('ctx-empty').hidden = false;
    $('ctx-empty').textContent = err.status === 404
      ? 'This project is not visible to the current principal.' : err.message;
    $('cap-submit').disabled = true;
  }
}

function renderActGrid(count) {
  const g = $('actgrid'); g.textContent = '';
  for (let i = 0; i < 20; i++) { const c = document.createElement('i'); if (i < Math.min(count, 20)) c.className = 'on'; g.append(c); }
}
function renderQGrid() {
  const g = $('qgrid'); g.textContent = '';
  const now = new Date();
  const cell = Math.floor((now.getHours() * 60 + now.getMinutes()) / (1440 / 52)); // 52 cells ≈ a work-year quarter grid
  for (let i = 0; i < 52; i++) {
    const c = document.createElement('i');
    if (i === cell % 52) c.className = 'now'; else if (i < cell % 52) c.className = 'done';
    g.append(c);
  }
}

/* ---- boot ---- */
async function loadProjects() {
  try { await api('/api/me'); } catch { /* auth handled per-request */ }
  try {
    const { projects } = await api('/api/projects');
    state.projects = await Promise.all(projects.map(async (p) => {
      try { const v = await api(`/api/projects/${p.id}`); return { ...p, captures: v.captures }; }
      catch { return { ...p, captures: [] }; }
    }));
    if (state.selectedId && !state.projects.some((p) => p.id === state.selectedId)) closeInspector();
    else renderField();
  } catch (err) {
    state.projects = []; renderField(); closeInspector();
    $('field-empty').hidden = false;
    $('field-empty').querySelector('.big').textContent = err.status === 401 ? 'Not authenticated' : 'Could not load context';
  }
}

function wirePrincipal() {
  const sel = $('principal'); sel.innerHTML = '';
  for (const p of KNOWN_PRINCIPALS) {
    const o = document.createElement('option'); o.value = p.id; o.textContent = p.label;
    if (p.id === state.principalId) o.selected = true; sel.append(o);
  }
  sel.onchange = () => { state.principalId = sel.value; localStorage.setItem('dc.principalId', state.principalId); loadProjects(); };
}

function wireCapture() {
  const focus = () => { $('note-title').focus(); $('note-title').scrollIntoView({ block: 'center', behavior: 'smooth' }); };
  for (const id of ['tool-capture', 'skill-capture']) {
    const e = $(id);
    e.addEventListener('click', () => { if (!state.selectedId && state.projects[0]) selectProject(state.projects[0].id); setTimeout(focus, 60); });
    e.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); e.click(); } });
  }
  $('ins-close').onclick = closeInspector;
  $('cap-form').onsubmit = async (e) => {
    e.preventDefault();
    if (!state.selectedId) return;
    const st = $('cap-status'), sb = $('cap-submit');
    const title = $('note-title').value.trim(), body = $('note-body').value.trim();
    if (!title && !body) { st.textContent = 'Enter a title or body.'; st.className = 'err'; return; }
    sb.disabled = true; st.textContent = 'Persisting…'; st.className = '';
    try {
      await api(`/api/projects/${state.selectedId}/notes`, { method: 'POST', body: JSON.stringify({ title, body }) });
      $('note-title').value = ''; $('note-body').value = '';
      st.textContent = 'Captured and persisted.'; st.className = 'ok';
      await selectProject(state.selectedId);
    } catch (err) { st.textContent = `Not saved: ${err.message}`; st.className = 'err'; }
    finally { sb.disabled = false; }
  };
}

function wireChrome() {
  $('toggle-left').onclick = () => document.body.classList.toggle('drawer-left');
  $('toggle-right').onclick = () => document.body.classList.toggle('drawer-right');
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { document.body.classList.remove('drawer-left', 'drawer-right'); if ($('center').classList.contains('inspecting')) closeInspector(); }
    if (e.key === '/' && !/input|textarea/i.test(document.activeElement?.tagName || '')) { e.preventDefault(); $('t-search').focus(); }
  });
}

function startClock() {
  const fmt = (d, tz) => d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: tz, hour12: false });
  const tick = () => {
    const now = new Date();
    $('clock').textContent = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
    try {
      $('tz-pt').textContent = fmt(now, 'America/Los_Angeles');
      $('tz-et').textContent = fmt(now, 'America/New_York');
      $('tz-ln').textContent = fmt(now, 'Europe/London');
    } catch { /* older engines */ }
    renderQGrid();
  };
  tick();
  setInterval(tick, 20_000);
}

buildScaffold();
renderField();
renderActGrid(0);
wirePrincipal();
wireCapture();
wireChrome();
startClock();
loadProjects();
