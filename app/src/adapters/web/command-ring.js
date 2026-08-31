// T3.2 — the OS command centre: RING + CORE.
//
// This is the resting state's central visual field. It is deliberately NOT the
// context graph: the graph is the Second Brain, one core-click away. What is
// drawn here is
//
//   • a CORE carrying the workspace's identity and its real size, and
//   • one RING of the workspace's real, invocable capabilities,
//
// inside a dense but restrained non-data atmosphere — a faceted wireframe
// enclosure, concentric orbital guides, a fine tick ring, an outer boundary and
// a particle mass. Every element in that atmosphere is texture: it carries no
// id, no count, no label and no pointer target, so visual density can be high
// without a single pixel of it claiming to be data (T3.2 §1, §23).
//
// Motion budget (§16): nothing here animates at rest. Orbital rotation is off.
// The only movement is a state transition — hover, focus, entering the Second
// Brain — and each is disabled under prefers-reduced-motion by the stylesheet.

import { CAPABILITIES, ringPoints } from './graph-model.js';

const NS = 'http://www.w3.org/2000/svg';

const GEO = {
  C: 500,
  R_BOUND: 496, // outer system boundary (dashed)
  R_TICK: 478, // fine tick ring
  R_RING: 418, // capability badge track
  R_BADGE: 38,
  R_LABEL: 336, // capability labels, on their own track inside the badges
  R_SHELL: 306, // faceted wireframe enclosure
  GUIDES: [152, 238, 306],
  R_CORE: 122, // core hexagon
  START: -Math.PI / 2,
};

function el(name, attrs, parent) {
  const n = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
  if (parent) parent.append(n);
  return n;
}

/** Regular polygon path, used for the core hexagon and the badge markers. */
function polygon(cx, cy, r, sides, rot = 0) {
  const pts = [];
  for (let i = 0; i < sides; i++) {
    const a = rot + (i / sides) * Math.PI * 2;
    pts.push(`${(cx + Math.cos(a) * r).toFixed(1)},${(cy + Math.sin(a) * r).toFixed(1)}`);
  }
  return `${pts.join(' ')}`;
}

/**
 * Orthographic icosahedron edges at a fixed 3/4 rotation, two shells, with a
 * per-edge depth for a faint front-to-back gradient. Deterministic — it never
 * shifts between renders, because it is furniture, not a reading.
 */
function shellEdges(R) {
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
      return [(x2 / norm) * R * scale, (y1 / norm) * R * scale, z2 / norm];
    });
  const out = [];
  for (const P of [project(0.52, 0.92, 1), project(-0.9, 0.34, 0.82)]) {
    for (const [a, b] of E) {
      out.push({
        x1: GEO.C + P[a][0], y1: GEO.C + P[a][1],
        x2: GEO.C + P[b][0], y2: GEO.C + P[b][1],
        depth: (P[a][2] + P[b][2]) / 2,
      });
    }
  }
  return out;
}

/** Deterministic particle mass — a volume of accumulation, not a measurement. */
function particles(n, R) {
  let s = 0x9e3779b9;
  const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
  const out = [];
  for (let i = 0; i < n; i++) {
    const inner = i % 3 === 0;
    const rr = Math.pow(rnd(), inner ? 2.6 : 1.7) * (R - 14) * (inner ? 0.66 : 1);
    const a = rnd() * Math.PI * 2;
    const g = rnd();
    const near = 1 - rr / R;
    out.push({
      cx: GEO.C + Math.cos(a) * rr,
      cy: GEO.C + Math.sin(a) * rr,
      r: 0.5 + near * 1.25 + rnd() * 1.4,
      o: Math.min(0.72, (0.08 + near * 0.6) * (0.4 + rnd() * 0.6)),
      tone: g < 0.52 ? 'n' : g < 0.7 ? 'w' : g < 0.87 ? 'c' : 'v',
    });
  }
  return out;
}

/**
 * @param {object} opts
 * @param {SVGSVGElement} opts.svg     host, viewBox 0 0 1000 1000
 * @param {(id:string)=>void} opts.onAction  a capability badge was invoked
 * @param {()=>void} opts.onCore             the core was activated
 * @param {HTMLElement} [opts.tip]           shared hover readout
 */
export function createCommandRing({ svg, onAction = () => {}, onCore = () => {}, tip = null }) {
  const layers = {
    atmo: svg.querySelector('#cr-atmo'),
    deco: svg.querySelector('#cr-deco'),
    ring: svg.querySelector('#cr-ring'),
    core: svg.querySelector('#cr-core'),
  };
  let built = false;

  /* ---------------------------------------------------- non-data atmosphere */
  function buildAtmosphere() {
    const host = layers.atmo;
    host.textContent = '';

    // outer system boundary + fine tick ring: geometry, never a gauge
    el('circle', { class: 'cr-bound', cx: GEO.C, cy: GEO.C, r: GEO.R_BOUND }, host);
    for (let i = 0; i < 72; i++) {
      const a = (i / 72) * Math.PI * 2;
      const long = i % 6 === 0;
      const r0 = GEO.R_TICK - (long ? 9 : 4);
      el('line', {
        class: `cr-tick${long ? ' long' : ''}`,
        x1: (GEO.C + Math.cos(a) * r0).toFixed(1),
        y1: (GEO.C + Math.sin(a) * r0).toFixed(1),
        x2: (GEO.C + Math.cos(a) * GEO.R_TICK).toFixed(1),
        y2: (GEO.C + Math.sin(a) * GEO.R_TICK).toFixed(1),
      }, host);
    }

    // concentric orbital guides + radial spokes
    for (const r of GEO.GUIDES) {
      el('circle', { class: 'cr-guide', cx: GEO.C, cy: GEO.C, r }, host);
    }
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      el('line', {
        class: 'cr-spoke',
        x1: (GEO.C + Math.cos(a) * 128).toFixed(1),
        y1: (GEO.C + Math.sin(a) * 128).toFixed(1),
        x2: (GEO.C + Math.cos(a) * GEO.R_SHELL).toFixed(1),
        y2: (GEO.C + Math.sin(a) * GEO.R_SHELL).toFixed(1),
      }, host);
    }

    // faceted wireframe enclosure
    for (const e of shellEdges(GEO.R_SHELL)) {
      const line = el('line', {
        class: 'cr-shell',
        x1: e.x1.toFixed(1), y1: e.y1.toFixed(1), x2: e.x2.toFixed(1), y2: e.y2.toFixed(1),
      }, host);
      line.setAttribute('opacity', (0.03 + ((e.depth + 1) / 2) * 0.055).toFixed(3));
    }

    // the particle mass
    for (const p of particles(720, GEO.R_SHELL)) {
      const c = el('circle', {
        class: `cr-p ${p.tone}`,
        cx: p.cx.toFixed(1), cy: p.cy.toFixed(1), r: p.r.toFixed(2),
      }, host);
      c.setAttribute('opacity', p.o.toFixed(3));
    }
  }

  /**
   * Decorative ring geometry BETWEEN the capability badges. Hollow markers and
   * hairlines only: no glyph, no label, no count, no handler — density without
   * a single fabricated artefact (§1).
   */
  function buildDecoration() {
    const host = layers.deco;
    host.textContent = '';
    const n = CAPABILITIES.length;
    const step = (Math.PI * 2) / n;
    for (let i = 0; i < n; i++) {
      for (const f of [0.25, 0.5, 0.75]) {
        const a = GEO.START + (i + f) * step;
        const x = GEO.C + Math.cos(a) * GEO.R_RING;
        const y = GEO.C + Math.sin(a) * GEO.R_RING;
        el('circle', {
          class: 'cr-marker',
          cx: x.toFixed(1), cy: y.toFixed(1), r: f === 0.5 ? 9 : 5.5,
        }, host);
        el('line', {
          class: 'cr-hair',
          x1: (GEO.C + Math.cos(a) * (GEO.R_RING + 16)).toFixed(1),
          y1: (GEO.C + Math.sin(a) * (GEO.R_RING + 16)).toFixed(1),
          x2: (GEO.C + Math.cos(a) * (GEO.R_TICK - 10)).toFixed(1),
          y2: (GEO.C + Math.sin(a) * (GEO.R_TICK - 10)).toFixed(1),
        }, host);
      }
    }
  }

  /* --------------------------------------------------- the capability ring */
  function buildRing() {
    const host = layers.ring;
    host.textContent = '';
    const points = ringPoints(CAPABILITIES.length, GEO.R_RING, { start: GEO.START });

    points.forEach((p, i) => {
      const cap = CAPABILITIES[i];
      const g = el('g', {
        class: 'cr-badge',
        'data-cap': cap.id,
        role: 'button',
        tabindex: '0',
        'aria-label': `${cap.label} — ${cap.description}`,
        transform: `translate(${p.x.toFixed(1)} ${p.y.toFixed(1)})`,
      }, host);

      el('circle', { class: 'hit', r: GEO.R_BADGE + 8, fill: 'transparent' }, g);
      el('circle', { class: 'bg', r: GEO.R_BADGE }, g);
      el('circle', { class: 'rim', r: GEO.R_BADGE }, g);
      el('polygon', { class: 'hex', points: polygon(0, 0, GEO.R_BADGE - 9, 6, Math.PI / 6) }, g);
      const glyph = el('text', { class: 'gl', y: 6 }, g);
      glyph.textContent = cap.glyph;

      // The label sits on its own track inside the badge ring, so the ring
      // reads as one band of names rather than a scatter of icons.
      const la = p.angle;
      const lx = GEO.C + Math.cos(la) * GEO.R_LABEL - p.x;
      const ly = GEO.C + Math.sin(la) * GEO.R_LABEL - p.y;
      const label = el('text', { class: 'cap-label', x: lx.toFixed(1), y: ly.toFixed(1) }, g);
      label.textContent = cap.label.toUpperCase();
      const cmd = el('text', {
        class: 'cap-cmd',
        x: lx.toFixed(1),
        y: (ly + 15).toFixed(1),
      }, g);
      cmd.textContent = cap.command.startsWith('/') ? cap.command : '';

      const fire = () => onAction(cap.id);
      g.addEventListener('click', fire);
      g.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' || ev.key === ' ') {
          ev.preventDefault();
          fire();
        }
      });
      if (tip) {
        g.addEventListener('pointerenter', (ev) => showTip(cap, ev));
        g.addEventListener('pointermove', (ev) => showTip(cap, ev));
        g.addEventListener('pointerleave', hideTip);
      }
    });
  }

  function showTip(cap, ev) {
    if (!tip) return;
    tip.textContent = '';
    const k = document.createElement('span');
    k.className = 'tk';
    k.textContent = 'Capability';
    const s = document.createElement('strong');
    s.textContent = cap.label;
    const m = document.createElement('span');
    m.className = 'tm';
    m.textContent = cap.command;
    const d = document.createElement('span');
    d.className = 'ts';
    d.textContent = cap.description;
    tip.append(k, s, m, d);
    tip.hidden = false;
    const host = svg.parentElement.getBoundingClientRect();
    const w = tip.offsetWidth;
    const h = tip.offsetHeight;
    let x = ev.clientX - host.left + 16;
    let y = ev.clientY - host.top + 16;
    if (x + w > host.width - 8) x = ev.clientX - host.left - w - 16;
    if (y + h > host.height - 8) y = ev.clientY - host.top - h - 16;
    tip.style.transform = `translate(${Math.max(6, x)}px, ${Math.max(6, y)}px)`;
  }
  const hideTip = () => {
    if (tip) tip.hidden = true;
  };

  /* ------------------------------------------------------------- the core */
  let coreTitle = null;
  let coreCount = null;

  function buildCore() {
    const host = layers.core;
    host.textContent = '';
    const g = el('g', {
      class: 'cr-core',
      role: 'button',
      tabindex: '0',
      transform: `translate(${GEO.C} ${GEO.C})`,
      'aria-label': 'Open the Second Brain — the whole workspace as one map',
    }, host);

    el('circle', { class: 'hit', r: GEO.R_CORE + 10, fill: 'transparent' }, g);
    el('polygon', { class: 'core-hex', points: polygon(0, 0, GEO.R_CORE, 6, Math.PI / 6) }, g);
    el('circle', { class: 'core-ring', r: GEO.R_CORE - 15 }, g);
    el('circle', { class: 'core-disc', r: 74 }, g);

    // The DEVWORKSPACE identity mark — the same two-node/one-link glyph the
    // header and the favicon carry, so the core is unmistakably the product.
    const mark = el('g', { class: 'core-mark', transform: 'translate(0 -26) scale(1.9)' }, g);
    el('line', { x1: -9, y1: 9, x2: 9, y2: -9 }, mark);
    el('circle', { class: 'f', cx: -9, cy: 9, r: 4.2 }, mark);
    el('circle', { class: 'o', cx: 9, cy: -9, r: 4.2 }, mark);

    coreTitle = el('text', { class: 'core-name', y: 22 }, g);
    coreTitle.textContent = 'DEVWORKSPACE';
    coreCount = el('text', { class: 'core-count', y: 42 }, g);
    coreCount.textContent = '—';

    g.addEventListener('click', onCore);
    g.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault();
        onCore();
      }
    });

    // The affordance: present, named, and visually secondary to the core.
    const hint = el('text', { class: 'core-hint', x: GEO.C, y: GEO.C + GEO.R_CORE + 44 }, host);
    hint.textContent = 'CLICK TO OPEN SECOND BRAIN';
    const rule = el('line', {
      class: 'core-hint-rule',
      x1: GEO.C - 96, y1: GEO.C + GEO.R_CORE + 22,
      x2: GEO.C + 96, y2: GEO.C + GEO.R_CORE + 22,
    }, host);
    rule.setAttribute('aria-hidden', 'true');
  }

  /**
   * The core states the workspace's real size. Both numbers come from the
   * graph payload's own stats — the same numbers the rails and the inspector
   * report — so the centre can never disagree with the panels around it.
   */
  function render(graph) {
    if (!built) {
      built = true;
      buildAtmosphere();
      buildDecoration();
      buildRing();
      buildCore();
    }
    const objects = Math.max(0, (graph?.nodes?.length ?? 0) - 1);
    const projects = graph?.stats?.projects ?? 0;
    if (coreCount) {
      coreCount.textContent = `${objects} OBJECT${objects === 1 ? '' : 'S'} · ${projects} PROJECT${projects === 1 ? '' : 'S'}`;
    }
  }

  /** Light the capabilities whose name or command matches — search attenuates
   *  the ring in place rather than replacing it with a list (§19). */
  function setMatches(query) {
    const q = String(query ?? '').trim().toLowerCase();
    svg.classList.toggle('searching', q.length > 0);
    for (const g of layers.ring.querySelectorAll('.cr-badge')) {
      const cap = CAPABILITIES.find((c) => c.id === g.dataset.cap);
      const hit =
        q.length > 0 &&
        (cap.label.toLowerCase().includes(q) ||
          cap.command.toLowerCase().includes(q) ||
          cap.description.toLowerCase().includes(q));
      g.classList.toggle('match', hit);
    }
  }

  return { render, setMatches, focusCore: () => layers.core.querySelector('.cr-core')?.focus() };
}
