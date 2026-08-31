// T3.2 / T3.3-CORRECTION — the OS command centre: CORE + ARTIFACT ORBIT.
//
// WHAT CHANGED, AND WHY.
//
// This perimeter used to carry six static capability circles — CAPTURE,
// SEARCH, CONNECT, ASK, EXTRACT TASKS, SUMMARIZE. They were duplicates of the
// Skills Deck, they were not data, and a command centre whose centre shows you
// six buttons you already have is showing you nothing about your workspace.
// They are REMOVED: not hidden, not disabled, not retained as invisible
// semantic nodes. Nothing in this file knows what a capability is any more.
//
// The orbit now carries ARTIFACTS — real outputs this system produced:
// delivered background routines, CI runs, pull requests, issues, and objects a
// user kept from an assistant proposal. Every node has a stable id, a real
// title, a real category, a real instant and a real source, and every one of
// them came from /api/artifacts, which assembles them from records that already
// existed. If nothing has been produced, the orbit is empty and says so — the
// track, the enclosure and the atmosphere stay exactly as they are.
//
// The centre is still the workspace CORE: the product's identity, and its real
// size, from the same graph payload the rails read.
//
// The distinction the whole composition depends on: a PARTICLE is texture —
// no id, no title, no timestamp, no handler — and an ARTIFACT is data. Nothing
// here blurs the two.
//
// Motion budget (§16): nothing animates at rest. The only movement is a state
// transition — hover, focus, entering the Second Brain — and each is disabled
// under prefers-reduced-motion by the stylesheet.

const NS = 'http://www.w3.org/2000/svg';

const GEO = {
  C: 500,
  R_BOUND: 496, // outer system boundary (dashed)
  R_TICK: 478, // fine tick ring
  R_ORBIT: 418, // artifact track
  R_NODE: 21,
  R_LABEL: 352, // artifact labels, on their own track inside the orbit
  R_SHELL: 306, // faceted wireframe enclosure
  GUIDES: [152, 238, 306],
  R_CORE: 122, // core hexagon
  START: -Math.PI / 2,
  /** How many decorative markers ride the orbit. Texture, not a slot count. */
  DECO: 24,
};

/** The most artifacts the orbit will place. A view bound; the server caps too. */
const MAX_ORBIT = 14;

function el(name, attrs, parent) {
  const n = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
  if (parent) parent.append(n);
  return n;
}

/** Regular polygon path, used for the core hexagon. */
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

const truncate = (v, n) => {
  const s = String(v ?? '');
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
};

/**
 * @param {object} opts
 * @param {SVGSVGElement} opts.svg          host, viewBox 0 0 1000 1000
 * @param {(a:object)=>void} opts.onArtifact an artifact node was activated
 * @param {()=>void} opts.onCore             the core was activated
 * @param {HTMLElement} [opts.tip]           shared hover readout
 * @param {(iso:string)=>string} [opts.formatTime] wall-clock formatter (IST)
 */
export function createCommandRing({
  svg,
  onArtifact = () => {},
  onCore = () => {},
  tip = null,
  formatTime = (iso) => String(iso ?? ''),
}) {
  const layers = {
    atmo: svg.querySelector('#cr-atmo'),
    deco: svg.querySelector('#cr-deco'),
    ring: svg.querySelector('#cr-ring'),
    core: svg.querySelector('#cr-core'),
  };
  let built = false;
  let artifacts = [];

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
   * The orbit TRACK and its decorative markers — hollow rings and hairlines at a
   * fixed cadence around the band. No glyph, no label, no count, no handler:
   * density without a single fabricated artefact (§1). The cadence is a
   * constant, deliberately unrelated to how many artifacts exist, so the ring
   * never implies a number of slots waiting to be filled.
   */
  function buildDecoration() {
    const host = layers.deco;
    host.textContent = '';
    el('circle', { class: 'cr-orbit', cx: GEO.C, cy: GEO.C, r: GEO.R_ORBIT }, host);
    for (let i = 0; i < GEO.DECO; i++) {
      const a = GEO.START + (i / GEO.DECO) * Math.PI * 2;
      const x = GEO.C + Math.cos(a) * GEO.R_ORBIT;
      const y = GEO.C + Math.sin(a) * GEO.R_ORBIT;
      el('circle', {
        class: 'cr-marker',
        cx: x.toFixed(1), cy: y.toFixed(1), r: i % 4 === 0 ? 6 : 3.5,
      }, host);
      if (i % 4 === 0) {
        el('line', {
          class: 'cr-hair',
          x1: (GEO.C + Math.cos(a) * (GEO.R_ORBIT + 14)).toFixed(1),
          y1: (GEO.C + Math.sin(a) * (GEO.R_ORBIT + 14)).toFixed(1),
          x2: (GEO.C + Math.cos(a) * (GEO.R_TICK - 10)).toFixed(1),
          y2: (GEO.C + Math.sin(a) * (GEO.R_TICK - 10)).toFixed(1),
        }, host);
      }
    }
  }

  /* ------------------------------------------------------ the artifact orbit */

  /**
   * Place the real artifacts.
   *
   * Nothing is placed that did not come from the feed, and no slot is filled to
   * make the ring look complete: with three artifacts, three nodes are drawn.
   * The empty case draws one quiet line ON the track saying so — an absence
   * stated, not an absence disguised.
   */
  function buildOrbit() {
    const host = layers.ring;
    host.textContent = '';

    if (artifacts.length === 0) {
      const t = el('text', {
        class: 'cr-orbit-empty',
        x: GEO.C,
        y: (GEO.C - GEO.R_ORBIT).toFixed(1),
        'text-anchor': 'middle',
      }, host);
      t.textContent = 'NO ARTIFACTS PRODUCED YET';
      return;
    }

    const items = artifacts.slice(0, MAX_ORBIT);
    const step = (Math.PI * 2) / items.length;
    items.forEach((a, i) => {
      const angle = GEO.START + i * step;
      const x = GEO.C + Math.cos(angle) * GEO.R_ORBIT;
      const y = GEO.C + Math.sin(angle) * GEO.R_ORBIT;

      const g = el('g', {
        // The category is an attribute, so the restrained glow is a stylesheet
        // concern and the class is never the only place the class is stated —
        // the tooltip and the modal both name it in words.
        class: `cr-artifact${a.unread ? ' unread' : ''}`,
        'data-artifact': a.id,
        'data-category': a.category,
        role: 'button',
        tabindex: '0',
        'aria-label': `${a.categoryLabel}: ${a.title}. ${formatTime(a.createdAt)}.${a.unread ? ' Unread.' : ''}`,
        transform: `translate(${x.toFixed(1)} ${y.toFixed(1)})`,
      }, host);

      el('circle', { class: 'hit', r: GEO.R_NODE + 12, fill: 'transparent' }, g);
      el('circle', { class: 'glow', r: GEO.R_NODE + 9 }, g);
      el('circle', { class: 'bg', r: GEO.R_NODE }, g);
      el('circle', { class: 'rim', r: GEO.R_NODE }, g);
      // An unread artifact carries a filled centre; a read one does not. The
      // state is also in the aria-label and in the tooltip, so it never rests
      // on the mark alone.
      if (a.unread) el('circle', { class: 'seen', r: 5 }, g);

      // The label track sits inside the orbit so the ring reads as one band of
      // names rather than a scatter of dots.
      const lx = GEO.C + Math.cos(angle) * GEO.R_LABEL - x;
      const ly = GEO.C + Math.sin(angle) * GEO.R_LABEL - y;
      const label = el('text', { class: 'af-label', x: lx.toFixed(1), y: ly.toFixed(1) }, g);
      label.textContent = truncate(a.title, 22).toUpperCase();
      const kind = el('text', {
        class: 'af-kind',
        x: lx.toFixed(1),
        y: (ly + 14).toFixed(1),
      }, g);
      kind.textContent = a.categoryLabel.toUpperCase();

      const fire = () => onArtifact(a);
      g.addEventListener('click', fire);
      g.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' || ev.key === ' ') {
          ev.preventDefault();
          fire();
        }
      });
      if (tip) {
        g.addEventListener('pointerenter', (ev) => showTip(a, ev));
        g.addEventListener('pointermove', (ev) => showTip(a, ev));
        g.addEventListener('pointerleave', hideTip);
      }
    });
  }

  /**
   * Hover readout. It always carries the TIMESTAMP, because "when was this
   * produced" is the question an orbit of outputs exists to answer, and it
   * names the source so a node is traceable before it is opened.
   */
  function showTip(a, ev) {
    if (!tip) return;
    tip.textContent = '';
    const k = document.createElement('span');
    k.className = 'tk';
    k.textContent = a.categoryLabel;
    const s = document.createElement('strong');
    s.textContent = a.title;
    const m = document.createElement('span');
    m.className = 'tm';
    m.textContent = `${formatTime(a.createdAt)} · ${a.source}`;
    tip.append(k, s, m);
    if (a.state) {
      const st = document.createElement('span');
      st.className = 'ts';
      st.textContent = `${a.state}${a.unread ? ' · unread' : ''}`;
      tip.append(st);
    }
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

    el('text', { class: 'core-name', y: 22 }, g).textContent = 'DEVWORKSPACE';
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

  function ensureBuilt() {
    if (built) return;
    built = true;
    buildAtmosphere();
    buildDecoration();
    buildCore();
  }

  /**
   * The core states the workspace's real size. Both numbers come from the
   * graph payload's own stats — the same numbers the rails and the inspector
   * report — so the centre can never disagree with the panels around it.
   */
  function render(graph) {
    ensureBuilt();
    const objects = Math.max(0, (graph?.nodes?.length ?? 0) - 1);
    const projects = graph?.stats?.projects ?? 0;
    if (coreCount) {
      coreCount.textContent = `${objects} OBJECT${objects === 1 ? '' : 'S'} · ${projects} PROJECT${projects === 1 ? '' : 'S'}`;
    }
  }

  /** Place a new artifact feed. Each item must already carry its real fields. */
  function renderArtifacts(items) {
    ensureBuilt();
    artifacts = Array.isArray(items) ? items : [];
    buildOrbit();
  }

  /** Mark one artifact read in place, without refetching the whole orbit. */
  function markRead(id) {
    artifacts = artifacts.map((a) => (a.id === id ? { ...a, unread: false } : a));
    const g = layers.ring.querySelector(`[data-artifact="${CSS.escape(id)}"]`);
    if (g) {
      g.classList.remove('unread');
      g.querySelector('.seen')?.remove();
    }
  }

  /** Light the artifacts whose title, category or source matches — search
   *  attenuates the ring in place rather than replacing it with a list (§19). */
  function setMatches(query) {
    const q = String(query ?? '').trim().toLowerCase();
    svg.classList.toggle('searching', q.length > 0);
    for (const g of layers.ring.querySelectorAll('.cr-artifact')) {
      const a = artifacts.find((x) => x.id === g.dataset.artifact);
      const hit =
        q.length > 0 &&
        !!a &&
        (a.title.toLowerCase().includes(q) ||
          a.categoryLabel.toLowerCase().includes(q) ||
          String(a.source).toLowerCase().includes(q));
      g.classList.toggle('match', hit);
    }
  }

  return {
    render,
    renderArtifacts,
    markRead,
    setMatches,
    focusCore: () => layers.core.querySelector('.cr-core')?.focus(),
  };
}
