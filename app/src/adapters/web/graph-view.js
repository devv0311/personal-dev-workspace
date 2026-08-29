// P3.2 — Context Graph view. Owns all SVG/DOM for the centre field.
//
// Rendering model: hand-built SVG, no graph library. Chosen because the P3.1
// visual system is already SVG and is LOCKED — a force/flowchart library would
// impose its own aesthetic and its own layout, and would have to be fought back
// to this one. Interaction stays cheap because:
//   • layout is deterministic and computed once per data load;
//   • pan/zoom mutate ONE transform on a single <g> (no re-render, no reflow of
//     node DOM), and strokes/labels use non-scaling units so they stay legible;
//   • hover/selection/filter only rewrite class attributes on existing nodes.
// The seam for a different renderer is graph-model.js: it produces positions and
// state; anything able to draw points and lines could consume it.

import {
  GEO,
  ZOOM,
  buildIndex,
  layoutGraph,
  neighborhood,
  visibleNodeIds,
  collapsibleIds,
  boundsOf,
  focusTransform,
  zoomAbout,
  clampZoom,
  metaFor,
} from './graph-model.js';

const NS = 'http://www.w3.org/2000/svg';
const { CX, CY, R_APPS, R_RT, R_MEM, R_CORE } = GEO;

function el(name, attrs, parent) {
  const n = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
  if (parent) parent.append(n);
  return n;
}
function rng(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hexPath(cx, cy, r) {
  let d = '';
  for (let i = 0; i < 6; i++) {
    const a = -Math.PI / 2 + i * (Math.PI / 3);
    d += (i ? 'L' : 'M') + (cx + Math.cos(a) * r).toFixed(1) + ' ' + (cy + Math.sin(a) * r).toFixed(1) + ' ';
  }
  return d + 'Z';
}
const setClass = (node, value) => {
  if (node.getAttribute('class') !== value) node.setAttribute('class', value);
};
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

const APP_GLYPHS = ['◆', '●', '▲', '■', '✦', '◇', '◈', '▸', '✕', '◎'];

export function createGraphView(opts) {
  const svg = opts.svg;
  const tip = opts.tip;
  const onSelect = opts.onSelect ?? (() => {});
  const onState = opts.onState ?? (() => {});

  const layers = {
    rings: svg.querySelector('#f-rings'),
    mem: svg.querySelector('#f-mem'),
    core: svg.querySelector('#f-core'),
    apps: svg.querySelector('#f-apps'),
    rt: svg.querySelector('#f-rt'),
    labels: svg.querySelector('#f-labels'),
    edges: svg.querySelector('#g-edges'),
    nodes: svg.querySelector('#g-nodes'),
  };
  const viewport = svg.querySelector('#viewport');

  const state = {
    graph: { nodes: [], edges: [] },
    index: buildIndex({ nodes: [], edges: [] }),
    pos: new Map(),
    selectedId: null,
    hoverId: null,
    disabledTypes: new Set(),
    scaffold: { apps: true, routines: true },
    collapsed: new Set(),
    matches: new Set(),
    transform: { k: 1, tx: 0, ty: 0 },
  };

  const nodeEls = new Map(); // id -> { g, disc, label }
  const edgeEls = new Map(); // edge id -> line
  let anim = null;
  let framed = false;

  /* ------------------------------------------------------ coordinate space */

  /** Visible user-space rect at identity, given viewBox 1000×1000 / meet. */
  function viewRect() {
    const r = svg.getBoundingClientRect();
    const s = Math.min(r.width / 1000, r.height / 1000) || 1;
    const w = r.width / s;
    const h = r.height / s;
    return { x: -(w - 1000) / 2, y: -(h - 1000) / 2, w, h };
  }
  /** Client point → untransformed SVG user coordinates. */
  function toSvg(clientX, clientY) {
    const ctm = svg.getScreenCTM();
    if (!ctm) return { x: 0, y: 0 };
    const p = new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse());
    return { x: p.x, y: p.y };
  }

  function applyTransform() {
    const { k, tx, ty } = state.transform;
    viewport.setAttribute('transform', `translate(${tx.toFixed(2)} ${ty.toFixed(2)}) scale(${k.toFixed(4)})`);
    svg.style.setProperty('--zoom', k.toFixed(4));
    onState({ zoom: k });
  }
  function setTransform(t) {
    state.transform = { k: clampZoom(t.k), tx: t.tx, ty: t.ty };
    applyTransform();
  }
  function animateTo(target, ms = 420) {
    if (anim) cancelAnimationFrame(anim);
    if (matchMedia('(prefers-reduced-motion: reduce)').matches || ms === 0) {
      setTransform(target);
      return;
    }
    const from = { ...state.transform };
    const t0 = performance.now();
    const step = (now) => {
      const p = Math.min(1, (now - t0) / ms);
      const e = ease(p);
      setTransform({
        k: from.k + (target.k - from.k) * e,
        tx: from.tx + (target.tx - from.tx) * e,
        ty: from.ty + (target.ty - from.ty) * e,
      });
      anim = p < 1 ? requestAnimationFrame(step) : null;
    };
    anim = requestAnimationFrame(step);
  }
  const stopAnim = () => {
    if (anim) cancelAnimationFrame(anim);
    anim = null;
  };

  /* ------------------------------------------------------------- scaffold */
  // The APPLICATIONS and ROUTINES orbits carry no domain data — no integration
  // is connected and no routine engine exists. They are drawn as an explicitly
  // offline scaffold (dimmed, unlabelled, non-interactive) so the semantic
  // layers of the accepted P3.1 composition survive without fabricating data.

  function buildScaffold() {
    const dense = window.innerWidth > 760;

    const rg = layers.rings;
    rg.textContent = '';
    el('circle', { class: 'ring apps spin', cx: CX, cy: CY, r: R_APPS }, rg);
    el('circle', { class: 'ring routines', cx: CX, cy: CY, r: R_RT }, rg);
    el('circle', { class: 'ring memory', cx: CX, cy: CY, r: R_MEM }, rg);

    const lg = layers.labels;
    lg.textContent = '';
    const lbl = (r, cls, txt) => {
      const t = el('text', { class: `ring-label ${cls}`, x: CX, y: CY - r + 22 }, lg);
      t.textContent = txt;
    };
    lbl(R_APPS, 'apps', 'Applications');
    lbl(R_RT, 'routines', 'Routines');
    lbl(R_MEM, 'memory', 'Memory');

    const ag = layers.apps;
    ag.textContent = '';
    const nApps = 16;
    for (let i = 0; i < nApps; i++) {
      const a = -Math.PI / 2 + 0.19 + (i / nApps) * Math.PI * 2;
      const g = el(
        'g',
        {
          class: 'app-badge dim',
          transform: `translate(${(CX + Math.cos(a) * R_APPS).toFixed(1)} ${(CY + Math.sin(a) * R_APPS).toFixed(1)})`,
          'aria-hidden': 'true',
        },
        ag,
      );
      el('path', { class: 'hex', d: hexPath(0, 0, 15) }, g);
      const t = el('text', { class: 'g', y: 0.5 }, g);
      t.textContent = APP_GLYPHS[i % APP_GLYPHS.length];
    }

    const rt = layers.rt;
    rt.textContent = '';
    const nRt = 30;
    for (let i = 0; i < nRt; i++) {
      const a = -Math.PI / 2 + 0.11 + (i / nRt) * Math.PI * 2;
      el(
        'circle',
        {
          class: 'rt-node',
          cx: (CX + Math.cos(a) * R_RT).toFixed(1),
          cy: (CY + Math.sin(a) * R_RT).toFixed(1),
          r: 3.4,
        },
        rt,
      );
    }

    // Particle core — accumulated context (blueprint §9.4).
    const cg = layers.core;
    cg.textContent = '';
    const r1 = rng(0x9e3779b9);
    const grains = dense ? 320 : 150;
    for (let i = 0; i < grains; i++) {
      const ang = r1() * Math.PI * 2;
      const rad = Math.pow(r1(), 0.85) * (R_CORE - 10);
      const roll = r1();
      const fill = roll > 0.92 ? 'var(--action)' : roll > 0.85 ? 'var(--apps)' : 'var(--memory)';
      el(
        'circle',
        {
          class: 'core-dot',
          cx: (CX + Math.cos(ang) * rad).toFixed(1),
          cy: (CY + Math.sin(ang) * rad).toFixed(1),
          r: (0.5 + r1() * 1.4).toFixed(2),
          fill,
          opacity: (0.24 + r1() * 0.45).toFixed(2),
        },
        cg,
      );
    }
    const r2 = rng(0x1234abcd);
    for (let i = 0; i < 22; i++) {
      const a1 = r2() * Math.PI * 2;
      const a2 = a1 + (r2() - 0.5) * 1.1;
      const rr1 = r2() * (R_CORE - 16);
      const rr2 = r2() * (R_CORE - 16);
      el(
        'line',
        {
          class: 'core-link',
          x1: (CX + Math.cos(a1) * rr1).toFixed(1),
          y1: (CY + Math.sin(a1) * rr1).toFixed(1),
          x2: (CX + Math.cos(a2) * rr2).toFixed(1),
          y2: (CY + Math.sin(a2) * rr2).toFixed(1),
        },
        cg,
      );
    }
  }

  /**
   * Ambient memory field — the accepted P3.1 dot lattice, kept at its original
   * density. Each project brightens a wedge whose lit depth tracks its REAL
   * capture count; the real capture nodes are then drawn on top of that wedge,
   * so the accepted visual and the live data are the same statement.
   *
   * ~6.5k dots would be 6.5k SVG elements, which makes every pan re-raster an
   * enormous layer. They are batched into three <path> elements — one per
   * opacity tier — so the field costs three nodes instead of thousands.
   */
  function buildMemoryField(clusters) {
    const memG = layers.mem;
    memG.textContent = '';
    const dense = window.innerWidth > 760;
    const rr = rng(0xbeef1);
    const ARCS = dense ? 22 : 12;
    const SPACING = dense ? 5 : 9;
    const rIn = R_CORE + 12;
    const rOut = R_MEM - 12;
    const HALF = GEO.WEDGE_HALF;
    const tiers = ['', '', ''];
    // A circle as a path: two half-arcs. Reliable across renderers.
    const dot = (x, y, r) =>
      `M${(x - r).toFixed(1)} ${y.toFixed(1)}` +
      `a${r} ${r} 0 1 0 ${(r * 2).toFixed(2)} 0` +
      `a${r} ${r} 0 1 0 ${(-r * 2).toFixed(2)} 0Z`;

    for (let a = 0; a < ARCS; a++) {
      const radius = rIn + (a / (ARCS - 1)) * (rOut - rIn);
      const step = SPACING / radius;
      for (let ang = 0; ang < Math.PI * 2 - 1e-6; ang += step) {
        let boost = 0;
        for (const c of clusters) {
          const d = Math.abs(((ang - c.angle + Math.PI) % (Math.PI * 2)) - Math.PI);
          if (d < HALF && a < c.lit) boost = Math.max(boost, 1 - d / HALF);
        }
        const R = radius + (rr() - 0.5) * 2.4;
        const x = CX + Math.cos(ang) * R;
        const y = CY + Math.sin(ang) * R;
        const jitter = rr();
        const tier = boost > 0.05 ? (boost > 0.5 ? 2 : 1) : jitter > 0.55 ? 1 : 0;
        tiers[tier] += dot(x, y, boost > 0.05 ? 1.5 + boost * 0.7 : 1);
      }
    }
    [0.2, 0.32, 0.62].forEach((opacity, i) => {
      if (tiers[i]) el('path', { class: 'mem-dot', d: tiers[i], opacity }, memG);
    });
  }

  /* ---------------------------------------------------------- data render */

  function renderGraph(graph) {
    state.graph = graph;
    state.index = buildIndex(graph);
    state.pos = layoutGraph(graph, state.index);
    // Collapsed/selected state that no longer refers to a real node is dropped.
    for (const id of [...state.collapsed]) if (!state.index.nodes.has(id)) state.collapsed.delete(id);
    if (state.selectedId && !state.index.nodes.has(state.selectedId)) state.selectedId = null;

    const clusters = [];
    for (const n of state.index.nodes.values()) {
      if (n.type !== 'project') continue;
      const p = state.pos.get(n.id);
      if (!p) continue;
      clusters.push({ angle: p.angle, lit: (state.index.childrenOf.get(n.id) ?? []).length });
    }
    buildMemoryField(clusters);

    layers.edges.textContent = '';
    layers.nodes.textContent = '';
    nodeEls.clear();
    edgeEls.clear();

    for (const e of state.index.edges) {
      const a = state.pos.get(e.from);
      const b = state.pos.get(e.to);
      if (!a || !b) continue;
      const line = el(
        'line',
        {
          class: 'edge-line',
          x1: a.x.toFixed(1),
          y1: a.y.toFixed(1),
          x2: b.x.toFixed(1),
          y2: b.y.toFixed(1),
          'data-edge': e.id,
          'vector-effect': 'non-scaling-stroke',
        },
        layers.edges,
      );
      edgeEls.set(e.id, line);
    }

    // Nodes: root first (bottom), then captures, then projects on top.
    const ordered = [...state.index.nodes.values()].sort((a, b) => rank(a) - rank(b));
    for (const n of ordered) {
      const p = state.pos.get(n.id);
      if (!p) continue;
      const meta = metaFor(n.type);
      const kids = (state.index.childrenOf.get(n.id) ?? []).length;
      const g = el(
        'g',
        {
          class: 'gnode',
          transform: `translate(${p.x.toFixed(1)} ${p.y.toFixed(1)})`,
          'data-id': n.id,
          'data-type': n.type,
          'data-accent': meta.accent,
          role: n.type === 'project' || n.kind === 'workspace' ? 'button' : 'presentation',
          'aria-label': `${meta.label}: ${n.title || 'untitled'}`,
        },
        layers.nodes,
      );
      if (n.type === 'project' || n.kind === 'workspace') g.setAttribute('tabindex', '0');

      el('circle', { class: 'hit', r: Math.max(14, meta.r * 2.6), fill: 'transparent' }, g);

      if (n.kind === 'workspace') {
        el('path', { class: 'corehex', d: hexPath(0, 0, 26), 'vector-effect': 'non-scaling-stroke' }, g);
        const t = el('text', { class: 'core-label', y: 44 }, g);
        t.textContent = 'CONTEXT.CORE';
      } else if (n.type === 'project') {
        el('circle', { class: 'disc', r: meta.r, 'vector-effect': 'non-scaling-stroke' }, g);
        el('circle', { class: 'halo', r: meta.r + 7, 'vector-effect': 'non-scaling-stroke' }, g);
        const below = Math.sin(p.angle) > 0;
        const t = el('text', { class: 'lbl', y: below ? 21 : -15 }, g);
        t.textContent = truncate(n.title, 22).toUpperCase();
        if (kids > 0) {
          const badge = el('text', { class: 'count', y: below ? -12 : 16 }, g);
          badge.textContent = String(kids);
        }
      } else {
        el('circle', { class: 'dot', r: meta.r, 'vector-effect': 'non-scaling-stroke' }, g);
        el('circle', { class: 'halo', r: meta.r + 5, 'vector-effect': 'non-scaling-stroke' }, g);
        const t = el('text', { class: 'lbl mem', y: -10 }, g);
        t.textContent = truncate(n.title || n.snippet || 'untitled', 26);
      }
      nodeEls.set(n.id, g);
    }

    paint();

    // On a narrow viewport the outer decorative orbits would otherwise fill the
    // frame and leave the real graph a miniature in the middle. Frame the
    // context itself once, on first load.
    if (!framed && state.pos.size > 1) {
      framed = true;
      if (window.innerWidth <= 720) fitContent(0);
    }
  }

  /** Frame the real graph (core + projects + memory band), not the scaffold. */
  function fitContent(ms = 420) {
    const pts = [...state.pos.values()];
    if (!pts.length) return;
    animateTo(focusTransform(boundsOf(pts, 46), viewRect(), 3.2), ms);
  }

  const rank = (n) => (n.kind === 'workspace' ? 0 : n.type === 'project' ? 2 : 1);
  const truncate = (s, n) => {
    const v = String(s ?? '');
    return v.length > n ? `${v.slice(0, n - 1)}…` : v;
  };

  /* ------------------------------------------------------------ emphasis */

  /** Rewrites only class attributes — no layout, no DOM churn. */
  function paint() {
    const visible = visibleNodeIds(state.index, {
      disabledTypes: state.disabledTypes,
      collapsed: state.collapsed,
    });
    const focusId = state.selectedId ?? state.hoverId;
    const near = focusId ? neighborhood(state.index, focusId, 1) : null;

    for (const [id, g] of nodeEls) {
      const cls = ['gnode'];
      if (!visible.has(id)) cls.push('off');
      if (id === state.selectedId) cls.push('sel');
      else if (near && near.nodeIds.has(id)) cls.push('rel');
      else if (near) cls.push('mute');
      if (id === state.hoverId) cls.push('hov');
      if (state.matches.has(id)) cls.push('match');
      if (state.collapsed.has(id)) cls.push('collapsed');
      setClass(g, cls.join(' '));
    }

    for (const e of state.index.edges) {
      const line = edgeEls.get(e.id);
      if (!line) continue;
      const shown = visible.has(e.from) && visible.has(e.to);
      const cls = ['edge-line'];
      cls.push(e.origin === 'structural' ? 'structural' : e.synthesised ? 'anchor' : 'authored');
      if (!shown) cls.push('off');
      else if (near && near.edgeIds.has(e.id)) cls.push('hot');
      else if (near) cls.push('mute');
      setClass(line, cls.join(' '));
    }

    onState({
      zoom: state.transform.k,
      visible: visible.size,
      total: state.index.nodes.size,
      collapsed: state.collapsed.size,
      selectedId: state.selectedId,
    });
  }

  /* ------------------------------------------------------------ tooltip */

  function showTip(id, clientX, clientY) {
    const n = state.index.nodes.get(id);
    if (!n || !tip) return;
    const meta = metaFor(n.type);
    const kids = (state.index.childrenOf.get(n.id) ?? []).length;
    const links = (state.index.incident.get(n.id) ?? []).length;
    const parent = state.index.parentOf.get(n.id);
    const parentNode = parent ? state.index.nodes.get(parent) : null;

    const rows = [];
    if (n.kind === 'workspace') rows.push(`${state.index.nodes.size - 1} context objects`);
    else if (n.type === 'project') rows.push(`${kids} captured · ${links} links`);
    else {
      if (parentNode) rows.push(parentNode.title);
      rows.push(`${links} relationship${links === 1 ? '' : 's'}`);
    }
    if (n.createdAt) rows.push(new Date(n.createdAt).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' }));

    tip.innerHTML = '';
    const kind = document.createElement('span');
    kind.className = `tk ${meta.accent}`;
    kind.textContent = meta.label;
    const title = document.createElement('strong');
    title.textContent = n.title || truncate(n.snippet, 40) || 'untitled';
    const metaLine = document.createElement('span');
    metaLine.className = 'tm';
    metaLine.textContent = rows.join(' · ');
    tip.append(kind, title, metaLine);
    if (n.snippet && n.kind !== 'workspace' && n.type !== 'project') {
      const s = document.createElement('span');
      s.className = 'ts';
      s.textContent = truncate(n.snippet, 120);
      tip.append(s);
    }

    tip.hidden = false;
    const host = svg.parentElement.getBoundingClientRect();
    const w = tip.offsetWidth;
    const h = tip.offsetHeight;
    let x = clientX - host.left + 16;
    let y = clientY - host.top + 16;
    if (x + w > host.width - 8) x = clientX - host.left - w - 16;
    if (y + h > host.height - 8) y = clientY - host.top - h - 16;
    tip.style.transform = `translate(${Math.max(6, x)}px, ${Math.max(6, y)}px)`;
  }
  function hideTip() {
    if (tip) tip.hidden = true;
  }

  /* -------------------------------------------------------- interactions */

  const pointers = new Map();
  let dragged = false;
  let pinchStart = null;
  // The element under the press. setPointerCapture retargets the click that
  // follows to the <svg>, so the click handler cannot ask what was clicked.
  let pressedId = null;

  svg.addEventListener('pointerdown', (ev) => {
    if (ev.button !== undefined && ev.button > 1) return;
    stopAnim();
    pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY, svg: toSvg(ev.clientX, ev.clientY) });
    dragged = false;
    pressedId = ev.target.closest?.('[data-id]')?.getAttribute('data-id') ?? null;
    try {
      svg.setPointerCapture(ev.pointerId);
    } catch {
      // the pointer may already be gone; panning still works without capture
    }
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinchStart = {
        dist: Math.hypot(a.x - b.x, a.y - b.y) || 1,
        k: state.transform.k,
        anchor: toSvg((a.x + b.x) / 2, (a.y + b.y) / 2),
        t: { ...state.transform },
      };
    }
    svg.classList.add('grabbing');
  });

  svg.addEventListener('pointermove', (ev) => {
    if (pointers.has(ev.pointerId)) {
      const prev = pointers.get(ev.pointerId);

      if (pointers.size === 2 && pinchStart) {
        pointers.set(ev.pointerId, { ...prev, x: ev.clientX, y: ev.clientY });
        const [a, b] = [...pointers.values()];
        const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
        setTransform(zoomAbout(pinchStart.t, dist / pinchStart.dist, pinchStart.anchor));
        dragged = true;
        hideTip();
        return;
      }

      // Pan: the outer translate is in SVG user units, so the delta is exact.
      // Measured against the previous move, not the press, or it compounds.
      const now = toSvg(ev.clientX, ev.clientY);
      const dx = now.x - prev.svg.x;
      const dy = now.y - prev.svg.y;
      pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY, svg: now });
      if (Math.abs(dx) + Math.abs(dy) > 0.6) dragged = true;
      setTransform({ k: state.transform.k, tx: state.transform.tx + dx, ty: state.transform.ty + dy });
      hideTip();
      return;
    }

    const target = ev.target.closest?.('[data-id]');
    const id = target?.getAttribute('data-id') ?? null;
    if (id !== state.hoverId) {
      state.hoverId = id;
      paint();
    }
    if (id) showTip(id, ev.clientX, ev.clientY);
    else hideTip();
  });

  const endPointer = (ev) => {
    pointers.delete(ev.pointerId);
    if (pointers.size < 2) pinchStart = null;
    if (pointers.size === 0) svg.classList.remove('grabbing');
  };
  svg.addEventListener('pointerup', endPointer);
  svg.addEventListener('pointercancel', endPointer);
  svg.addEventListener('pointerleave', () => {
    if (state.hoverId) {
      state.hoverId = null;
      paint();
    }
    hideTip();
  });

  svg.addEventListener(
    'wheel',
    (ev) => {
      ev.preventDefault();
      stopAnim();
      const factor = Math.pow(ZOOM.STEP, -Math.sign(ev.deltaY) * Math.min(3, Math.abs(ev.deltaY) / 50 + 0.6));
      setTransform(zoomAbout(state.transform, factor, toSvg(ev.clientX, ev.clientY)));
      hideTip();
    },
    { passive: false },
  );

  svg.addEventListener('click', (ev) => {
    const id = pressedId;
    pressedId = null;
    if (dragged) return;
    if (!id) {
      select(null);
      return;
    }
    // Double click on a project expands/collapses its context and refocuses.
    if (ev.detail >= 2) {
      toggleCollapse(id);
      select(id);
      focus(id);
      return;
    }
    select(id);
  });

  svg.addEventListener('keydown', (ev) => {
    const target = ev.target.closest?.('[data-id]');
    if (!target) return;
    if (ev.key === 'Enter' || ev.key === ' ') {
      ev.preventDefault();
      select(target.getAttribute('data-id'));
    }
  });

  /* ------------------------------------------------------------- commands */

  function select(id) {
    if (id !== null && !state.index.nodes.has(id)) return;
    state.selectedId = id;
    state.matches.clear();
    paint();
    onSelect(id ? state.index.nodes.get(id) : null);
  }

  function focus(id = state.selectedId, depth = 1) {
    if (!id || !state.pos.has(id)) {
      resetView();
      return;
    }
    const near = neighborhood(state.index, id, depth);
    const visible = visibleNodeIds(state.index, {
      disabledTypes: state.disabledTypes,
      collapsed: state.collapsed,
    });
    const pts = [];
    for (const nid of near.nodeIds) {
      if (nid !== id && !visible.has(nid)) continue;
      const p = state.pos.get(nid);
      if (p) pts.push(p);
    }
    const box = boundsOf(pts, 90);
    animateTo(focusTransform(box, viewRect()));
  }

  function resetView() {
    if (window.innerWidth <= 720) fitContent();
    else animateTo({ k: 1, tx: 0, ty: 0 });
  }

  function zoomBy(factor) {
    stopAnim();
    const v = viewRect();
    setTransform(zoomAbout(state.transform, factor, { x: v.x + v.w / 2, y: v.y + v.h / 2 }));
  }

  function setTypeFilter(type, enabled) {
    if (enabled) state.disabledTypes.delete(type);
    else state.disabledTypes.add(type);
    if (state.selectedId && state.disabledTypes.has(state.index.nodes.get(state.selectedId)?.type)) {
      select(null);
    } else {
      paint();
    }
  }

  function setScaffold(layer, enabled) {
    state.scaffold[layer] = enabled;
    const group = layer === 'apps' ? layers.apps : layers.rt;
    const ring = layers.rings.querySelector(layer === 'apps' ? '.ring.apps' : '.ring.routines');
    const label = layers.labels.querySelector(layer === 'apps' ? '.ring-label.apps' : '.ring-label.routines');
    for (const node of [group, ring, label]) if (node) node.classList.toggle('off', !enabled);
  }

  function toggleCollapse(id) {
    const kids = state.index.childrenOf.get(id) ?? [];
    if (!kids.length) return;
    if (state.collapsed.has(id)) state.collapsed.delete(id);
    else state.collapsed.add(id);
    paint();
  }
  function expandAll() {
    state.collapsed.clear();
    paint();
  }
  function collapseAll() {
    for (const id of collapsibleIds(state.index)) state.collapsed.add(id);
    paint();
  }

  /** Search result → reveal, select and focus. Reveals a collapsed parent. */
  function revealAndFocus(id) {
    const node = state.index.nodes.get(id);
    if (!node) return;
    state.disabledTypes.delete(node.type);
    const parent = state.index.parentOf.get(id);
    if (parent) state.collapsed.delete(parent);
    state.matches = new Set([id]);
    state.selectedId = id;
    paint();
    onSelect(node);
    focus(id);
  }

  function setMatches(ids) {
    state.matches = new Set(ids);
    paint();
  }

  const resize = () => applyTransform();
  window.addEventListener('resize', resize);

  buildScaffold();
  buildMemoryField([]);
  applyTransform();

  return {
    render: renderGraph,
    select,
    focus,
    resetView,
    zoomBy,
    setTypeFilter,
    setScaffold,
    toggleCollapse,
    expandAll,
    collapseAll,
    revealAndFocus,
    setMatches,
    rebuildScaffold: buildScaffold,
    fitContent,
    get selectedId() {
      return state.selectedId;
    },
    get index() {
      return state.index;
    },
    get graph() {
      return state.graph;
    },
    get collapsedCount() {
      return state.collapsed.size;
    },
  };
}
