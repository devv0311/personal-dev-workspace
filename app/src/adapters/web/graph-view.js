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
  revealedLabelGroups,
  labelTextFor,
  layoutSecondBrain,
  brainRings,
  semanticClassOf,
  ringPoints,
  BRAIN_GEO,
  CAPABILITIES,
} from './graph-model.js';

const NS = 'http://www.w3.org/2000/svg';
const { CX, CY } = GEO;

function el(name, attrs, parent) {
  const n = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
  if (parent) parent.append(n);
  return n;
}
const setClass = (node, value) => {
  if (node.getAttribute('class') !== value) node.setAttribute('class', value);
};
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export function createGraphView(opts) {
  const svg = opts.svg;
  const tip = opts.tip;
  const onSelect = opts.onSelect ?? (() => {});
  const onState = opts.onState ?? (() => {});
  // The docked control panel floats over the field. Its footprint is excluded
  // from the fittable area (see reservedUserRect / clearFrame) so it can never
  // cover a node or a search match.
  const panel = opts.panel ?? svg.ownerDocument.getElementById('gctl');

  // 'brain' is the Second Brain's concentric ring projection of the same
  // payload; 'wedge' is the P3.1/P3.2 per-project fan. One dataset, two
  // projections — the node ids, the edges and every downstream surface are
  // identical (T3.2 §4, §21).
  const layoutMode = opts.layout ?? 'wedge';
  const onCapability = opts.onCapability ?? (() => {});

  const layers = {
    atmosphere: svg.querySelector('#g-atmosphere'),
    caps: svg.querySelector('#g-caps'),
    edges: svg.querySelector('#g-edges'),
    edgeLabels: svg.querySelector('#g-edgelabels'),
    nodes: svg.querySelector('#g-nodes'),
  };
  const viewport = svg.querySelector('#viewport');
  const bloom = svg.querySelector('#core-bloom');

  const state = {
    graph: { nodes: [], edges: [] },
    index: buildIndex({ nodes: [], edges: [] }),
    pos: new Map(),
    selectedId: null,
    hoverId: null,
    disabledTypes: new Set(),
    collapsed: new Set(),
    matches: new Set(),
    transform: { k: 1, tx: 0, ty: 0 },
  };

  const nodeEls = new Map(); // id -> { g, disc, label }
  const edgeEls = new Map(); // edge id -> line
  let anim = null;
  let framed = false;
  // The scale at which the whole graph fits. Above it, the user has explicitly
  // zoomed in — see the touch model note by the pointer handlers.
  let fitK = 1;

  /* ------------------------------------------------------ coordinate space */

  /** Visible user-space rect at identity, given viewBox 1000×1000 / meet. */
  function viewRect() {
    const r = svg.getBoundingClientRect();
    const s = Math.min(r.width / 1000, r.height / 1000) || 1;
    const w = r.width / s;
    const h = r.height / s;
    return { x: -(w - 1000) / 2, y: -(h - 1000) / 2, w, h };
  }
  /** Client px → user units, for the current viewBox/meet fit. */
  function userScale() {
    const r = svg.getBoundingClientRect();
    return Math.min(r.width / 1000, r.height / 1000) || 1;
  }

  /**
   * The control panel's footprint, in the same user coordinates as the layout —
   * or null when it does not overlap the field at all (at ≤720px it is a static
   * block below the graph, so there is nothing to exclude).
   *
   * The reserved height is the panel's **fully expanded** footprint, not its
   * current one: the search-result list opens, changes row count and closes as
   * the reader types, and the graph must not slide around underneath them while
   * that happens (matches keep the positions they already occupy — §5.7). So we
   * add the headroom the list can still grow into, and keep the largest
   * footprint seen at this viewport, which also means folding the panel never
   * re-frames the graph either. `resetReserve()` clears it when the viewport
   * itself changes.
   */
  let reservedClientH = 0;
  const resetReserve = () => { reservedClientH = 0; };

  function reservedUserRect() {
    if (!panel || panel.hidden) return null;
    const p = panel.getBoundingClientRect();
    const f = svg.getBoundingClientRect();
    if (!p.width || !p.height || !f.width || !f.height) return null;
    // No overlap with the field → nothing to reserve.
    if (p.right <= f.left || p.left >= f.right || p.bottom <= f.top || p.top >= f.bottom) {
      return null;
    }
    // A folded panel is just its header row: the results list lives in the
    // hidden body, so it reserves no growth headroom.
    const list = panel.classList.contains('folded') ? null : panel.querySelector('#g-results');
    let headroom = 0;
    if (list) {
      const max = Number.parseFloat(getComputedStyle(list).maxHeight);
      const now = list.hidden ? 0 : list.getBoundingClientRect().height;
      if (Number.isFinite(max)) {
        headroom = Math.max(0, max - now);
        // An appearing list costs its own height *and* the column gap above it.
        if (!now) {
          const gap = Number.parseFloat(getComputedStyle(list.parentElement ?? panel).rowGap);
          if (Number.isFinite(gap)) headroom += gap;
        }
      }
    }
    // Quantised so a few pixels of layout wobble cannot re-frame the graph.
    const STEP = 24;
    reservedClientH = Math.max(reservedClientH, Math.ceil((p.height + headroom) / STEP) * STEP);

    const s = userScale();
    const v = viewRect();
    return {
      x: v.x + (p.left - f.left) / s,
      y: v.y + (p.top - f.top) / s,
      w: p.width / s,
      h: reservedClientH / s,
    };
  }

  /**
   * The largest sub-rectangle of `field` that does not intersect `res`, chosen
   * by which one frames `box` at the biggest scale. Content is fitted into that
   * rectangle, so no node — and therefore no search match — can come to rest
   * under the panel. The layout itself is untouched: this is camera framing, not
   * node placement, so nothing moves relative to anything else.
   */
  function clearFrame(field, res, box) {
    if (!res) return field;
    const fx2 = field.x + field.w;
    const fy2 = field.y + field.h;
    const rx2 = res.x + res.w;
    const ry2 = res.y + res.h;
    if (rx2 <= field.x || res.x >= fx2 || ry2 <= field.y || res.y >= fy2) return field;

    const candidates = [
      { x: field.x, y: ry2, w: field.w, h: fy2 - ry2 }, // below the panel
      { x: field.x, y: field.y, w: res.x - field.x, h: field.h }, // beside it
      { x: field.x, y: field.y, w: field.w, h: res.y - field.y }, // above it
      { x: rx2, y: field.y, w: fx2 - rx2, h: field.h }, // past it
    ].filter((c) => c.w > 60 && c.h > 60);
    if (!candidates.length) return field;

    const score = (c) => Math.min(c.w / Math.max(box.w, 1), c.h / Math.max(box.h, 1));
    return candidates.reduce((best, c) => (score(c) > score(best) ? c : best));
  }

  /** Client point → untransformed SVG user coordinates. */
  function toSvg(clientX, clientY) {
    const ctm = svg.getScreenCTM();
    if (!ctm) return { x: 0, y: 0 };
    const p = new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse());
    return { x: p.x, y: p.y };
  }

  const isEngaged = () => state.transform.k > fitK * 1.02;

  function applyTransform() {
    const { k, tx, ty } = state.transform;
    viewport.setAttribute('transform', `translate(${tx.toFixed(2)} ${ty.toFixed(2)}) scale(${k.toFixed(4)})`);
    svg.style.setProperty('--zoom', k.toFixed(4));
    // Drives touch-action on small screens only (see the CSS media query).
    svg.classList.toggle('engaged', isEngaged());
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

  /* ---------------------------------------------------------- data render */
  //
  // T3.1: no offline scaffold and no fabricated density. The field draws only
  // real objects — the Workspace root, its projects, their captured context —
  // and real or genuinely computed edges. A sparse workspace looks sparse (§5).

  /* --------------------------------------------- ambient spatial atmosphere */
  //
  // NON-DATA texture, built once. Reproduces the reference centrepiece — a
  // faceted wireframe enclosure with concentric orbital structure holding a
  // dense particle mass — so the central field reads with the reference's
  // spatial density. Nothing here is a workspace object: no id, no pointer
  // target, no selection state. It is deterministic (fixed seed / fixed
  // rotation) so it never shifts between renders, and it is static — the
  // motion budget (§7) is spent only on state transitions.

  const AT = { C: 500, R: 322, RINGS: [128, 210, 300] };
  let atmosphereBuilt = false;

  /** Orthographic-projected icosahedron edges, at a fixed 3/4 rotation, with a
   *  per-edge depth in −1..1 for a faint front-to-back opacity gradient. */
  function icosaEdges() {
    const t = (1 + Math.sqrt(5)) / 2;
    const V = [
      [-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0],
      [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t],
      [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1],
    ];
    const E = [
      [0, 11], [0, 5], [0, 1], [0, 7], [0, 10], [1, 5], [5, 11], [11, 10], [10, 7], [7, 1],
      [1, 9], [5, 4], [11, 2], [10, 6], [7, 8], [3, 9], [3, 4], [3, 2], [3, 6], [3, 8],
      [4, 9], [2, 4], [6, 2], [8, 6], [9, 8], [5, 9], [11, 4], [10, 2], [7, 6], [1, 8],
    ];
    const norm = Math.hypot(t, 1);
    const project = (ax, ay, scale) =>
      V.map(([x, y, z]) => {
        const y1 = y * Math.cos(ax) - z * Math.sin(ax);
        const z1 = y * Math.sin(ax) + z * Math.cos(ax);
        const x2 = x * Math.cos(ay) + z1 * Math.sin(ay);
        const z2 = -x * Math.sin(ay) + z1 * Math.cos(ay);
        return [(x2 / norm) * AT.R * scale, (y1 / norm) * AT.R * scale, z2 / norm];
      });
    // Two shells at different rotations read as a faceted geodesic sphere
    // rather than a single hard polygon silhouette.
    const shells = [project(0.52, 0.92, 1), project(-0.9, 0.34, 0.84)];
    const out = [];
    for (const P of shells) {
      for (const [a, b] of E) {
        out.push({
          x1: AT.C + P[a][0], y1: AT.C + P[a][1],
          x2: AT.C + P[b][0], y2: AT.C + P[b][1],
          depth: (P[a][2] + P[b][2]) / 2,
        });
      }
    }
    return out;
  }

  /** Deterministic particle mass: radial density biased inward, low-saturation
   *  tone buckets, per-particle opacity. Not data — a volume of accumulation. */
  function particleField(n) {
    let s = 0x9e3779b9;
    const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
    const out = [];
    for (let i = 0; i < n; i++) {
      // Steep inward bias so the mass concentrates into a bright core and
      // thins toward the enclosure — the reference's "volume of accumulation".
      // A quarter of the field is pulled into a tight inner cluster.
      const inner = i % 4 === 0;
      const rr = Math.pow(rnd(), inner ? 3.4 : 2.1) * (AT.R - 18) * (inner ? 0.42 : 1);
      const a = rnd() * Math.PI * 2;
      const g = rnd();
      const near = 1 - rr / AT.R;
      out.push({
        cx: AT.C + Math.cos(a) * rr,
        cy: AT.C + Math.sin(a) * rr,
        r: 0.5 + near * 1.3 + rnd() * 1.5,
        o: Math.min(0.8, (0.09 + near * 0.62) * (0.42 + rnd() * 0.58)),
        tone: g < 0.5 ? 'n' : g < 0.68 ? 'w' : g < 0.86 ? 'c' : 'v',
      });
    }
    return out;
  }

  function buildAtmosphere() {
    if (atmosphereBuilt || !layers.atmosphere) return;
    atmosphereBuilt = true;
    const host = layers.atmosphere;

    for (let i = 0; i < 12; i++) {
      const ang = (i / 12) * Math.PI * 2;
      el('line', {
        class: 'atmo-spoke',
        x1: AT.C + Math.cos(ang) * 34, y1: AT.C + Math.sin(ang) * 34,
        x2: AT.C + Math.cos(ang) * AT.R, y2: AT.C + Math.sin(ang) * AT.R,
      }, host);
    }
    for (const r of AT.RINGS) {
      el('circle', { class: 'atmo-ring', cx: AT.C, cy: AT.C, r }, host);
    }
    for (const e of icosaEdges()) {
      const line = el('line', {
        class: 'atmo-edge',
        x1: e.x1.toFixed(1), y1: e.y1.toFixed(1), x2: e.x2.toFixed(1), y2: e.y2.toFixed(1),
      }, host);
      line.setAttribute('opacity', (0.024 + (e.depth + 1) / 2 * 0.05).toFixed(3));
    }
    for (const p of particleField(420)) {
      const c = el('circle', {
        class: `atmo-p ${p.tone}`,
        cx: p.cx.toFixed(1), cy: p.cy.toFixed(1), r: p.r.toFixed(2),
      }, host);
      c.setAttribute('opacity', Math.min(0.5, p.o).toFixed(3));
    }
  }

  /* ------------------------------------------------ SECOND BRAIN structure */
  //
  // The ring system (T3.2 §4, §5): circular tracks, radial spokes, a dense
  // central memory field, a fine outer system boundary and sparse technical
  // annotations. The tracks and the boundary are STRUCTURE — they say where a
  // class of object lives — and the annotations state each ring's real name
  // and its real count, taken from the payload. A ring the workspace has
  // nothing on is drawn and labelled `0`: the map states its own emptiness
  // rather than being filled.
  //
  // Rebuilt per render because the ring counts are live; it is a few hundred
  // inert elements and no pointer target among them.

  function buildBrainStructure(graph) {
    const host = layers.atmosphere;
    host.textContent = '';
    const { CX, CY, R_BOUND, START } = BRAIN_GEO;
    const rings = brainRings(graph, state.index);

    // outer system boundary + fine tick ring
    el('circle', { class: 'br-bound', cx: CX, cy: CY, r: R_BOUND }, host);
    for (let i = 0; i < 96; i++) {
      const a = (i / 96) * Math.PI * 2;
      const long = i % 8 === 0;
      const r0 = R_BOUND - 20 - (long ? 8 : 3);
      el('line', {
        class: `br-tick${long ? ' long' : ''}`,
        x1: (CX + Math.cos(a) * r0).toFixed(1),
        y1: (CY + Math.sin(a) * r0).toFixed(1),
        x2: (CX + Math.cos(a) * (R_BOUND - 20)).toFixed(1),
        y2: (CY + Math.sin(a) * (R_BOUND - 20)).toFixed(1),
      }, host);
    }

    // circular tracks, one per ring in the system
    for (const r of rings) {
      if (r.key === 'boundary') continue;
      el('circle', {
        class: `br-track sem-${r.semantic}`,
        cx: CX, cy: CY, r: r.radius,
      }, host);
    }

    // radial spokes on the project sector boundaries — the structure that makes
    // "this context belongs to that project" readable without drawing edges.
    const projects = [...state.index.nodes.values()].filter((n) => n.type === 'project');
    const n = Math.max(projects.length, 1);
    for (let i = 0; i < n; i++) {
      const a = START + i * ((Math.PI * 2) / n);
      el('line', {
        class: 'br-spoke',
        x1: (CX + Math.cos(a) * BRAIN_GEO.R_DOMAIN).toFixed(1),
        y1: (CY + Math.sin(a) * BRAIN_GEO.R_DOMAIN).toFixed(1),
        x2: (CX + Math.cos(a) * (R_BOUND - 22)).toFixed(1),
        y2: (CY + Math.sin(a) * (R_BOUND - 22)).toFixed(1),
      }, host);
    }
    // and a short spoke out to each project, tying it to the core
    for (const p of projects) {
      const at = state.pos.get(p.id);
      if (!at) continue;
      el('line', {
        class: 'br-radial',
        x1: CX, y1: CY, x2: at.x.toFixed(1), y2: at.y.toFixed(1),
      }, host);
    }

    // central memory field — mass, not measurement
    for (const q of particleField(300)) {
      const c = el('circle', {
        class: `atmo-p ${q.tone}`,
        cx: (CX + (q.cx - AT.C) * 0.42).toFixed(1),
        cy: (CY + (q.cy - AT.C) * 0.42).toFixed(1),
        r: q.r.toFixed(2),
      }, host);
      c.setAttribute('opacity', Math.min(0.45, q.o).toFixed(3));
    }

    // Sparse technical annotations: each ring's real name and its real count,
    // stacked up the 12 o'clock gutter that the half-sector offset keeps clear
    // of projects and of their context.
    //
    // The capability ring is the one exception. Its badges sit half a step off
    // the gutter and carry their own names underneath, so an annotation on
    // that track would land on one of them. It is stated once, on a single
    // line, in the clear band between the core and the capability badges.
    for (const r of rings) {
      const g = el('g', { class: `br-anno sem-${r.semantic}` }, host);
      if (r.key === 'capability') {
        el('text', { class: 'rl', x: CX, y: (CY - 62).toFixed(1), 'text-anchor': 'middle' }, g)
          .textContent = `${r.label.toUpperCase()} · ${r.count}`;
        continue;
      }
      const y = CY - r.radius;
      el('text', { class: 'rl', x: CX + 10, y: (y - 6).toFixed(1) }, g).textContent =
        (r.label || '').toUpperCase();
      if (r.label) {
        el('text', { class: 'rn', x: CX + 10, y: (y + 8).toFixed(1) }, g).textContent = String(r.count);
      }
    }
  }

  /**
   * The Second Brain's INNER RING: the workspace's real capabilities.
   *
   * They are drawn in the ring system because that is what the innermost band
   * means — what this workspace can DO — but they are deliberately NOT graph
   * nodes: they carry no object id, never enter the index, never appear in
   * search results and never open the inspector. Activating one runs the real
   * capability. Nothing about them can be mistaken for a stored object (§23).
   */
  function buildCapabilityRing() {
    const host = layers.caps;
    if (!host) return;
    host.textContent = '';
    if (layoutMode !== 'brain') return;
    // Half a step off 12 o'clock, so the annotation gutter stays clear here too.
    const pts = ringPoints(CAPABILITIES.length, BRAIN_GEO.R_CAP, {
      start: BRAIN_GEO.START + Math.PI / CAPABILITIES.length,
    });
    pts.forEach((p, i) => {
      const cap = CAPABILITIES[i];
      const g = el('g', {
        class: 'br-cap',
        'data-cap': cap.id,
        role: 'button',
        tabindex: '0',
        'aria-label': `${cap.label} capability — ${cap.description}`,
        transform: `translate(${p.x.toFixed(1)} ${p.y.toFixed(1)})`,
      }, host);
      el('circle', { class: 'hit', r: 22, fill: 'transparent' }, g);
      el('circle', { class: 'bg', r: 15 }, g);
      el('circle', { class: 'rim', r: 15, 'vector-effect': 'non-scaling-stroke' }, g);
      el('text', { class: 'gl', y: 4 }, g).textContent = cap.glyph;
      const lbl = el('text', { class: 'cl', y: 30 }, g);
      lbl.textContent = cap.label.toUpperCase();
      const fire = () => onCapability(cap.id);
      g.addEventListener('click', (ev) => {
        ev.stopPropagation();
        fire();
      });
      g.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' || ev.key === ' ') {
          ev.preventDefault();
          fire();
        }
      });
    });
  }

  /** Project identity hue index (mod the bounded palette), by deterministic
   *  project order. A structural placeholder — the assignment rule and >N
   *  overflow behaviour are deferred (blueprint Q1). */
  function projectHueIndex(index) {
    const order = [...index.nodes.values()]
      .filter((n) => n.type === 'project')
      .sort(
        (a, b) =>
          String(a.createdAt).localeCompare(String(b.createdAt)) || a.id.localeCompare(b.id),
      );
    return new Map(order.map((p, i) => [p.id, (i % 8) + 1]));
  }

  /**
   * @param {object} graph  the /api/graph payload
   * @param {{reframe?: boolean}} [opts]  `reframe` re-fits the view to the new
   *   content. Used when the graph is a genuinely different one — a principal
   *   switch — where keeping the previous dataset's zoom would frame the new
   *   workspace at a scale chosen for the old one.
   */
  function renderGraph(graph, opts = {}) {
    state.graph = graph;
    state.index = buildIndex(graph);
    state.pos =
      layoutMode === 'brain'
        ? layoutSecondBrain(graph, state.index)
        : layoutGraph(graph, state.index);
    // Collapsed/selected state that no longer refers to a real node is dropped.
    for (const id of [...state.collapsed]) if (!state.index.nodes.has(id)) state.collapsed.delete(id);
    if (state.selectedId && !state.index.nodes.has(state.selectedId)) state.selectedId = null;

    if (layoutMode === 'brain') {
      buildBrainStructure(graph);
      buildCapabilityRing();
    } else {
      buildAtmosphere();
    }

    const projHue = projectHueIndex(state.index);
    state.projHue = projHue;

    layers.edges.textContent = '';
    layers.edgeLabels.textContent = '';
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
          'data-sem': semanticClassOf(n),
          role: n.type === 'project' || n.kind === 'workspace' ? 'button' : 'presentation',
          'aria-label': `${meta.label}: ${n.title || 'untitled'}`,
        },
        layers.nodes,
      );
      if (n.type === 'project' || n.kind === 'workspace') g.setAttribute('tabindex', '0');
      // Project identity hue, applied additively (§5.4); the CSS falls back to
      // neutral where --proj is unset (every non-project node).
      if (n.type === 'project' && projHue.has(n.id)) {
        g.style.setProperty('--proj', `var(--proj-${projHue.get(n.id)})`);
      }

      el('circle', { class: 'hit', r: Math.max(14, meta.r * 2.6), fill: 'transparent' }, g);

      if (n.kind === 'workspace') {
        el('circle', { class: 'coremark', r: 24, 'vector-effect': 'non-scaling-stroke' }, g);
        el('circle', { class: 'coremark dotc', r: 5 }, g);
        const t = el('text', { class: 'core-label', y: 42 }, g);
        // The root's name comes from the read model, not a client constant, so
        // the field, the inspector and the API cannot disagree about it.
        t.textContent = (n.title || 'Workspace').toUpperCase();
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

    // Frame the real content once on first load, and again whenever the graph
    // is replaced wholesale. With no decorative orbits to fill the field, the
    // content is what sizes it — at every viewport.
    if (state.pos.size > 1 && (!framed || opts.reframe)) {
      const first = !framed;
      framed = true;
      fitContent(first ? 0 : 420);
    }
  }

  /** Frame the real graph — workspace, projects and their context — so it is the
   *  dominant surface of the central field, with room to breathe and clear of
   *  the docked control panel. Pure view framing: the deterministic layout, the
   *  graph data and the geometry constants are untouched. */
  function fitContent(ms = 420) {
    const pts = [...state.pos.values()];
    if (!pts.length) return;
    const v = viewRect();
    const wide = window.innerWidth > 1200;
    // Frame the whole COMPOSITION — the ambient enclosure plus the real nodes —
    // not just a tight crop of the nodes. The enclosure fixes the visual mass
    // at a stable size and keeps it centred, so the central field reads as the
    // reference's dominant round volume rather than collapsing to whatever
    // rectangle the current object set happens to occupy.
    const nb = boundsOf(pts, wide ? 30 : 66);
    const ER = layoutMode === 'brain' ? BRAIN_GEO.R_BOUND : AT.R;
    const encl = { x: AT.C - ER - 4, y: AT.C - ER - 4, w: (ER + 4) * 2, h: (ER + 4) * 2 };
    const minX = Math.min(nb.x, encl.x);
    const minY = Math.min(nb.y, encl.y);
    const box = {
      x: minX,
      y: minY,
      w: Math.max(nb.x + nb.w, encl.x + encl.w) - minX,
      h: Math.max(nb.y + nb.h, encl.y + encl.h) - minY,
    };
    const maxScale = wide ? 2.75 : 1.75;
    // The Second Brain is a place of its own: it gets nearly the whole canvas,
    // where the OS view's field shares its width with two rails.
    const tight = layoutMode === 'brain';
    const padX = v.w * (tight ? 0.02 : wide ? 0.06 : 0.02);
    const padY = v.h * (tight ? 0.018 : wide ? 0.05 : 0.02);
    const field = { x: v.x + padX, y: v.y + padY, w: v.w - padX * 2, h: v.h - padY * 2 };
    const res = reservedUserRect();
    const target = focusTransform(box, clearFrame(field, res, box), maxScale);
    rememberFrame(res);
    fitK = target.k;
    animateTo(target, ms);
  }

  /** Re-frame when the panel's reserved footprint or the field itself changes
   *  size — a viewport resize, or the control panel growing. Only while the
   *  reader has not taken the camera themselves: past the fitted scale the view
   *  belongs to them and must not be pulled back (see the touch model). */
  let lastFieldKey = '';
  let lastFrameKey = '';
  const fieldKey = () => {
    const f = svg.getBoundingClientRect();
    return `${Math.round(f.width)}x${Math.round(f.height)}`;
  };
  const frameKey = (res) =>
    `${fieldKey()}|${
      res
        ? `${Math.round(res.x)},${Math.round(res.y)},${Math.round(res.w)},${Math.round(res.h)}`
        : 'none'
    }`;
  function rememberFrame(res) {
    lastFieldKey = fieldKey();
    lastFrameKey = frameKey(res);
  }

  function reframeIfStale() {
    if (!framed || isEngaged()) return;
    // A different field is a different composition: the panel's reserved
    // footprint is measured afresh rather than carried across viewports.
    if (fieldKey() !== lastFieldKey) resetReserve();
    if (frameKey(reservedUserRect()) === lastFrameKey) return;
    fitContent(420);
  }

  if (typeof ResizeObserver === 'function') {
    const ro = new ResizeObserver(() => reframeIfStale());
    ro.observe(svg);
    if (panel) ro.observe(panel);
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

    // Relationships are a QUERY RESULT, not permanent decoration: at rest the
    // field is quiet, and selecting a node is what reveals — and names — the
    // edges incident to it (blueprint §5.6).
    const revealed = [];

    for (const e of state.index.edges) {
      const line = edgeEls.get(e.id);
      if (!line) continue;
      const shown = visible.has(e.from) && visible.has(e.to);
      const cls = ['edge-line'];
      cls.push(e.origin === 'structural' ? 'structural' : e.synthesised ? 'anchor' : 'authored');
      if (!shown) cls.push('off');
      else if (near && near.edgeIds.has(e.id)) {
        cls.push('hot');
        if (state.selectedId) revealed.push(e);
      } else if (near) cls.push('mute');
      setClass(line, cls.join(' '));
    }

    paintEdgeLabels(revealed);

    onState({
      zoom: state.transform.k,
      visible: visible.size,
      total: state.index.nodes.size,
      collapsed: state.collapsed.size,
      selectedId: state.selectedId,
    });
  }

  /* --------------------------------------------- revealed relationship labels */

  const boxesOverlap = (a, b) =>
    a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

  /** A rendered element's box in viewport user units, or null. `getBBox` is in
   *  the element's own system, which for a node `<g>` is translated to `at`. */
  function bboxAt(node, at) {
    if (!node) return null;
    try {
      const b = node.getBBox();
      if (!b || (!b.width && !b.height)) return null;
      return { x: at.x + b.x, y: at.y + b.y, w: b.width, h: b.height };
    } catch {
      return null;
    }
  }

  /** What a label must not cover: the selected node's own mark and its identity
   *  label — the selection must never be made anonymous by its own reveal. */
  function selectionObstacles(anchor) {
    const out = [];
    const g = nodeEls.get(state.selectedId);
    const n = state.index.nodes.get(state.selectedId);
    if (!g || !n) return out;
    const r = (metaFor(n.type).r || 8) + 12;
    out.push({ x: anchor.x - r, y: anchor.y - r, w: r * 2, h: r * 2 });
    for (const sel of ['.lbl', '.core-label', '.count']) {
      const box = bboxAt(g.querySelector(sel), anchor);
      if (box) out.push(box);
    }
    return out;
  }

  /**
   * Name the revealed relationships — the verb, and an arrow oriented along the
   * stored direction — so "what does this touch, and which way does it run?" is
   * answered in words rather than by an edge colour (§4.13: state is stated in
   * text, colour only reinforces).
   *
   * Two rules keep that legible on a hub, where a project may reveal a dozen
   * edges at once:
   *
   *  1. **One label per (verb, direction), not one per edge.** Ten sibling
   *     captures all reading `← belongs_to` is *one* fact stated ten times; the
   *     fan gets a single label on its bisector. Nothing is aggregated away and
   *     no count is invented — every relationship stays individually listed,
   *     with its own provenance and confidence, in the inspector (§5.3). The
   *     graph names the kind of tie; the inspector holds the ties.
   *  2. **Collision-aware placement.** Each label is tried at a ladder of
   *     positions along its edge (or its fan's bisector) and rejected where it
   *     would cover the selected node, that node's own identity label, or a
   *     label already placed. Authored verbs are placed first, because they
   *     carry what containment geometry cannot already show. A label that finds
   *     no clear position is dropped rather than stacked — the relationship
   *     itself is untouched and still reads in the inspector.
   *
   * Nothing here is drawn at rest: the host is emptied unless there is a
   * selection, so the field stays quiet and becomes interrogable on selection.
   *
   * Rebuilt rather than diffed because the set is small by construction: it is
   * one node's incident edges, never the whole graph.
   */
  function paintEdgeLabels(revealed) {
    const host = layers.edgeLabels;
    host.textContent = '';
    if (!state.selectedId || revealed.length === 0) return;
    const anchor = state.pos.get(state.selectedId);
    if (!anchor) return;

    const fu = 8 / Math.max(state.transform.k, 0.01); // label font size, user units
    const placed = selectionObstacles(anchor);

    for (const g of revealedLabelGroups(revealed, state.selectedId)) {
      // The far endpoint of each edge in the group, in layout coordinates.
      const fars = [];
      for (const e of g.edges) {
        const far = state.pos.get(e.from === state.selectedId ? e.to : e.from);
        if (far) fars.push(far);
      }
      if (!fars.length) continue;

      const text = labelTextFor(g);
      const w = text.length * fu * 0.62;
      const h = fu * 1.9;

      // Where the label wants to sit: on its own edge when it names one, on the
      // fan's bisector when it names several.
      let sx = 0;
      let sy = 0;
      let sum = 0;
      for (const far of fars) {
        const dx = far.x - anchor.x;
        const dy = far.y - anchor.y;
        const d = Math.hypot(dx, dy) || 1;
        sx += dx / d;
        sy += dy / d;
        sum += d;
      }
      const dir = { x: sx, y: sy };
      const reach = sum / fars.length;
      const len = Math.hypot(dir.x, dir.y) || 1;
      const ux = dir.x / len;
      const uy = dir.y / len;
      const px = -uy; // unit normal, for sideways nudges
      const py = ux;

      let spot = null;
      outer: for (const t of [0.55, 0.68, 0.42, 0.8, 0.3, 0.9]) {
        for (const side of [0, 1, -1, 2, -2]) {
          const cx = anchor.x + ux * reach * t + px * side * h * 1.15;
          const cy = anchor.y + uy * reach * t + py * side * h * 1.15;
          const box = { x: cx - w / 2, y: cy - h / 2, w, h };
          if (!placed.some((o) => boxesOverlap(box, o))) {
            spot = { cx, cy, box };
            break outer;
          }
        }
      }
      if (!spot) continue; // no clear position — the inspector still has it

      placed.push(spot.box);
      const node = el(
        'g',
        {
          class: `edge-label${g.outgoing ? ' out' : ' in'}${g.edges.length > 1 ? ' fan' : ''}`,
          transform: `translate(${spot.cx.toFixed(1)} ${spot.cy.toFixed(1)})`,
          'aria-hidden': 'true',
        },
        host,
      );
      el('text', { class: 'et' }, node).textContent = text;
    }
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
    kind.className = 'tk'; // class is the label's text, not a colour
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
  // TOUCH MODEL (small screens). The graph must not be a dead-scroll region,
  // but it must still pan with one finger. Two states, driven by whether the
  // reader has zoomed past the fitted view:
  //   • not engaged (the state you scroll past in) — touch-action: pan-y, so a
  //     vertical swipe scrolls the page. A horizontal-first drag is ours, and
  //     once owned it pans freely in both axes.
  //   • engaged (zoomed in) — touch-action: none, so one finger pans in 2D.
  // Pinch always belongs to the graph (pan-y grants the browser no pinch-zoom),
  // and pinching in is what engages; Reset returns to the page-scroll state.
  let gestureAxis = null; // null = undecided, 'x' = ours, 'y' = the page's

  svg.addEventListener('pointerdown', (ev) => {
    if (ev.button !== undefined && ev.button > 1) return;
    stopAnim();
    pointers.set(ev.pointerId, {
      x: ev.clientX,
      y: ev.clientY,
      ox: ev.clientX,
      oy: ev.clientY,
      svg: toSvg(ev.clientX, ev.clientY),
    });
    dragged = false;
    gestureAxis = null;
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
        gestureAxis = 'x'; // a pinch is always the graph's
        pointers.set(ev.pointerId, { ...prev, x: ev.clientX, y: ev.clientY });
        const [a, b] = [...pointers.values()];
        const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
        setTransform(zoomAbout(pinchStart.t, dist / pinchStart.dist, pinchStart.anchor));
        dragged = true;
        hideTip();
        return;
      }

      // One finger, not engaged: decide once, past the slop, who owns the
      // gesture. A vertical-first swipe is the page's — stay out of its way.
      if (ev.pointerType === 'touch' && !isEngaged()) {
        const gx = ev.clientX - prev.ox;
        const gy = ev.clientY - prev.oy;
        if (gestureAxis === null && Math.abs(gx) + Math.abs(gy) > 6) {
          gestureAxis = Math.abs(gx) >= Math.abs(gy) ? 'x' : 'y';
        }
        if (gestureAxis !== 'x') {
          pointers.set(ev.pointerId, { ...prev, x: ev.clientX, y: ev.clientY });
          return;
        }
      }

      // Pan: the outer translate is in SVG user units, so the delta is exact.
      // Measured against the previous move, not the press, or it compounds.
      const now = toSvg(ev.clientX, ev.clientY);
      const dx = now.x - prev.svg.x;
      const dy = now.y - prev.svg.y;
      pointers.set(ev.pointerId, { ...prev, x: ev.clientX, y: ev.clientY, svg: now });
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

  /** The ambient bloom adopts the focused Project's identity hue, so even
   *  peripherally the field is "lit by what you are holding" (reference §2.6).
   *  Neutral-warm when nothing is selected. CSS resolves the nested var(). */
  function tintBloom(id) {
    const n = id ? state.index.nodes.get(id) : null;
    const pid = n ? (n.type === 'project' ? n.id : n.homeProjectId ?? null) : null;
    const idx = pid && state.projHue ? state.projHue.get(pid) : null;
    svg.style.setProperty('--bloom', idx ? `var(--proj-${idx})` : '#ff7a1a');
  }

  function select(id) {
    if (id !== null && !state.index.nodes.has(id)) return;
    state.selectedId = id;
    state.matches.clear();
    tintBloom(id);
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
    // The real content frames the field — there is no meaningful identity view
    // now that the decorative orbits are gone.
    fitContent();
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
    tintBloom(id);
    paint();
    onSelect(node);
    focus(id);
  }

  /** Highlight a set of nodes. `spotlight` attenuates the rest of the field in
   *  place (§5.7) — search sets it; a single post-capture highlight does not. */
  function setMatches(ids, { spotlight = false } = {}) {
    state.matches = new Set(ids);
    svg.classList.toggle('searching', spotlight && state.matches.size > 0);
    paint();
  }

  const resize = () => applyTransform();
  window.addEventListener('resize', resize);

  applyTransform();

  return {
    render: renderGraph,
    select,
    focus,
    resetView,
    zoomBy,
    setTypeFilter,
    toggleCollapse,
    expandAll,
    collapseAll,
    revealAndFocus,
    setMatches,
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
