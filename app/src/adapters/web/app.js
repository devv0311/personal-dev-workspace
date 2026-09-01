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
  SKILLS,
} from './graph-model.js';

/**
 * The dev-auth BOOTSTRAP credential (T3.3.2; corrected at T3.3-CORRECTION).
 *
 * The demo principals `Alice` and `Bob` are gone, along with the client-side
 * table of principal labels that named them. This is a single id — the
 * workspace's head, Dev — used only to make the very first authenticated
 * request, exactly as the P2.7 dev-auth boundary requires a credential to be
 * presented. It is replaced wholesale when real authentication arrives.
 *
 * Nothing about identity is ASSERTED here. Who the current user is, and who
 * heads the workspace, both come from `/api/me`, which the SERVER answers from
 * the principal row the credential resolved to and from the membership that
 * carries the `owner` role. A name in the header is one the datastore
 * returned, never one this file invented — and this constant decides only
 * which credential is presented first, not who anyone is.
 */
const DEFAULT_PRINCIPAL_ID = '00000000-0000-4000-8000-0000000000d1';

/**
 * The stored-principal key is versioned. A browser that still held the previous
 * default would otherwise keep opening as the identity this correction moved
 * away from, and the shell would look uncorrected for exactly the people who
 * had used it before.
 */
const PRINCIPAL_KEY = 'dc.principalId.v2';

/** The assistant service (Zone B). Separate origin: it holds no DB credential. */
const ASSISTANT_URL = localStorage.getItem('dc.assistantUrl') || 'http://localhost:4178';

const state = {
  /** Which PLACE the shell is in: the OS command centre, or the Second Brain.
   *  Both are the same session over the same objects — this is navigation
   *  between two surfaces, not two datasets (T3.2 §3, §21). */
  view: 'os',
  members: [],
  /** The authenticated identity, as the server reports it. Never assumed. */
  me: null,
  principalId: localStorage.getItem(PRINCIPAL_KEY) || DEFAULT_PRINCIPAL_ID,
  ask: { busy: false, result: null },
  graph: { nodes: [], edges: [], stats: { projects: 0, captures: 0 } },
  selected: null, // { node, detail }
  results: [],
  resultIndex: -1,
  /** Whether the assistant answered its /healthz on the last probe. */
  assistantOnline: false,
  /**
   * What the assistant runtime says it can ACTUALLY execute. Empty lists are a
   * real answer — the development stub is not a model and exposes no tier and
   * no effort control — and the configuration matrix renders them as
   * unavailable rather than as "everything is available".
   */
  runtime: { kind: null, model: null, tier: null, defaultEffort: null, models: [], efforts: [] },
  /** Real produced outputs, from /api/artifacts. Never seeded. */
  artifacts: [],
  /** Each artifact source's own condition, so a gap can explain itself. */
  artifactSources: [],
  /** The caller's OWN mail accounts and the providers this deployment has. */
  mail: { storage: { ok: false, reason: null }, providers: [], accounts: [] },
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
  // The Second Brain is a RADIAL SECTOR TREE over the same payload the rails
  // and the inspector read (T3.2 §4; geometry corrected at T3.3-CORRECTION §2).
  layout: 'sector',
  // `runSkill` is async since T3.3.5 (a run is awaited so its outcome can be
  // reported). Ring invocations are fire-and-forget, so the rejection is
  // absorbed here rather than surfacing as an unhandled promise.
  onSkill: (id) => void runSkill(id).catch(() => {}),
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
  // The orbit carries produced OUTPUTS, not capabilities: activating one opens
  // the artifact itself (T3.3-CORRECTION §1).
  onArtifact: (a) => openArtifact(a),
  onCore: () => enterBrain(),
  // One timezone for the whole shell — the orbit's tooltip reads in the same
  // wall clock as every other timestamp on screen.
  formatTime: (iso) => `${fmtDate(iso)} IST`,
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
 * Run a SKILL — from the Second Brain's inner ring or from the Skills Deck.
 *
 * There are four, and they are the four the product can actually run. The
 * command view's six capability circles are gone, and with them the two
 * "capabilities" that were never skills at all: Connect was the map's own
 * selection gesture and Search was the spotlight, both still reachable from the
 * rails where they belong.
 *
 * Every branch delegates to something the shell already wires — the capture
 * form or the P3.4 assistant. Nothing here claims an executable the product
 * lacks, and an assistant skill refuses outright when the assistant is not
 * reachable rather than appearing to run.
 */
async function runSkill(id) {
  document.body.classList.remove('drawer-left', 'drawer-right');
  switch (id) {
    case 'capture':
      enterBrain();
      $('tool-capture').click();
      // Opening the capture form is not a run: nothing has been captured yet,
      // and reporting "done" here would claim a write that has not happened.
      return { kind: 'opened', note: 'capture form ready' };
    case 'ask':
      // Likewise — the assistant has not been called until there is a question.
      openAsk();
      return { kind: 'opened', note: 'ask panel ready' };
    case 'summarize': {
      if (!state.assistantOnline) return { kind: 'ran', ok: false, detail: 'assistant offline' };
      openAsk();
      $('ask-input').value = 'Summarize this';
      return { kind: 'ran', ...(await runAsk('Summarize this', id)) };
    }
    case 'extract': {
      if (!state.assistantOnline) return { kind: 'ran', ok: false, detail: 'assistant offline' };
      openAsk();
      $('ask-input').value = 'Extract tasks from this';
      return { kind: 'ran', ...(await runAsk('Extract tasks from this', id)) };
    }
    default:
      return { kind: 'none' };
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
    // read — the centre can never disagree with the panels around it. The orbit
    // around it is loaded separately, because artifacts are produced by systems
    // the graph knows nothing about.
    ring.render(graph);
    renderFilters(graph);
    renderPulse(graph);

    $('field-empty').hidden = graph.stats.projects > 0 || graph.stats.captures > 0;
    $('ro-tl').textContent = `WORKSPACE · ${graph.workspaceId.slice(0, 8)}`;
    renderIdentity();
    // The command view's right-hand readout belongs to the ORBIT, and the orbit
    // is artifacts — the workspace's own size is already stated on the core
    // beneath it. Two writers on one readout would race, and whichever landed
    // last would decide what the centre appeared to be counting.
    $('os-tl').textContent = 'DEVWORKSPACE · COMMAND CENTRE';
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
    $('os-tl').textContent =
      err.status === 401
        ? 'DEVWORKSPACE · NOT AUTHENTICATED'
        : 'DEVWORKSPACE · WORKSPACE UNAVAILABLE';
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

/* ------------------------------------------------------------ time (IST) --
 *
 * ONE timezone for the whole shell (T3.3.10): Asia/Kolkata, stated explicitly
 * on every formatter rather than inherited from whatever the device happens to
 * be set to. A timestamp read from the API, a repository commit time and the
 * header clock are then guaranteed to be the same wall clock, and a shell
 * opened on a machine set to another zone still reads in the user's own. */
const TZ = 'Asia/Kolkata';
const TZ_LABEL = 'IST · INDIA';

const fmtDate = (iso) => {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('en-GB', {
      timeZone: TZ,
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });
  } catch {
    return iso;
  }
};

/**
 * Compact stamp for a rail table: the time when it happened today, the date
 * when it did not. Both in IST, and `—` when there is genuinely no timestamp —
 * an absent instant is never filled in with `now`.
 */
function istStamp(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const day = (x) => x.toLocaleDateString('en-GB', { timeZone: TZ });
  return day(d) === day(new Date())
    ? d.toLocaleTimeString('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false })
    : d.toLocaleDateString('en-GB', { timeZone: TZ, day: '2-digit', month: 'short' }).toUpperCase();
}

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

  items.forEach((item, i) => {
    const tr = document.createElement('tr');
    tr.className = i === 0 ? 'latest' : 'past';
    tr.dataset.id = item.id;
    tr.setAttribute('role', 'button');
    tr.setAttribute('tabindex', '0');
    tr.setAttribute('aria-label', `Open ${item.title} in the graph`);

    const t = document.createElement('td');
    t.className = 't mono';
    t.textContent = istStamp(item.createdAt);
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
 * How a Skills card describes the engine behind it.
 *
 * The T3.1 review rejected `FAKE · DETERMINISTIC-FAKE-1` on these cards, and
 * rightly: the assistant's development stub does report exactly that from its
 * own /healthz, but printing it in a model slot dresses a stub up as a model
 * and an effort tier. The fix is not to hide the state — it is to state it in
 * words. A stub says it is a stub; a real provider is named, with the model it
 * actually reports and nothing more (T3.2 §8, §23).
 */
function providerName(kind) {
  return kind === 'fake' ? 'dev stub' : String(kind ?? 'unknown');
}

function providerLabel(p) {
  if (!p) return 'assistant · ready';
  return `assistant · ${providerName(p.kind)}${p.model && p.kind !== 'fake' ? ` · ${p.model}` : ''}`;
}

/** Skills whose engine is the assistant service rather than the core. */
const ASSISTANT_SKILLS = ['flow-ask', 'flow-summarize', 'flow-extract'];
/** Card id ⇄ skill id, so one runner serves the deck and the Second Brain ring. */
const SKILL_BY_CARD = {
  'flow-capture': 'capture',
  'flow-ask': 'ask',
  'flow-summarize': 'summarize',
  'flow-extract': 'extract',
};
const CARD_BY_SKILL = Object.fromEntries(
  Object.entries(SKILL_BY_CARD).map(([card, skill]) => [skill, card]),
);

/* ------------------------------------- model / effort (T3.3-CORRECTION §5) --
 *
 * A Skills card offers a configuration control, and the control tells the
 * truth about three separate things:
 *
 *   1. WHAT WILL RUN. The badge shows the configuration that the next run will
 *      actually send. With the development stub answering, there is no model
 *      and no effort to send, and the badge says so instead of naming one.
 *   2. WHAT CAN RUN. The matrix lists every model and effort the UI knows
 *      about, and disables every one the CONFIGURED RUNTIME does not report as
 *      supported. A disabled option cannot be selected here, and the assistant
 *      pipeline refuses it as well — so an unsupported combination can never be
 *      made to appear to have run.
 *   3. WHAT DID RUN. After a run the assistant echoes the configuration it
 *      used, and that — not the request — is what the badge is updated from.
 */
const MODEL_TIERS = ['haiku', 'sonnet', 'opus', 'fable'];
const EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh'];
const cfgKey = (skill, part) => `dc.skill.${skill}.${part}`;

/** The selection a card holds, kept only while the runtime still supports it. */
function skillConfig(skill) {
  const model = localStorage.getItem(cfgKey(skill, 'model'));
  const effort = localStorage.getItem(cfgKey(skill, 'effort'));
  return {
    model: model && state.runtime.models.includes(model) ? model : null,
    effort: effort && state.runtime.efforts.includes(effort) ? effort : null,
  };
}

/**
 * The badge text for a card: the configuration a run will genuinely use.
 * Falls back to the runtime's own default, and to a plain statement that there
 * is no such control when the runtime exposes none.
 */
function skillConfigLabel(skill) {
  if (!state.assistantOnline) return 'runtime unavailable';
  if (state.runtime.models.length === 0 && state.runtime.efforts.length === 0) {
    return `${providerName(state.runtime.kind)} · no model control`;
  }
  const chosen = skillConfig(skill);
  const model = chosen.model ?? state.runtime.tier ?? state.runtime.model ?? '—';
  const effort = chosen.effort ?? state.runtime.defaultEffort;
  return effort ? `${model} · ${effort}` : `${model} · no effort control`;
}

/** Repaint every configuration badge, on the cards and on the Second Brain ring. */
function renderSkillConfigs() {
  for (const btn of document.querySelectorAll('.sk-cfg')) {
    const skill = btn.dataset.cfg;
    btn.textContent = skillConfigLabel(skill);
    // The control is pressable only when there is something real to choose.
    const choosable =
      state.assistantOnline &&
      (state.runtime.models.length > 0 || state.runtime.efforts.length > 0);
    btn.disabled = !choosable;
    btn.title = choosable
      ? 'Choose the model and effort this skill runs with'
      : `The configured runtime (${providerName(state.runtime.kind)}) exposes no model or effort control.`;
  }
  $('skill-runtime').textContent = state.assistantOnline
    ? `Runtime · ${providerName(state.runtime.kind)}` +
      (state.runtime.models.length
        ? ` · models ${state.runtime.models.join(', ')} · effort ${state.runtime.efforts.join(', ')}`
        : ' · exposes no model or effort control, so every option is unavailable')
    : 'Runtime · assistant not reachable, so no skill can run.';

  // The Second Brain's inner ring shows the same states and the same badges,
  // because it runs the same skills through the same runner.
  view.setSkillState(
    SKILLS.map((sk) => {
      const assistant = sk.engine === 'assistant';
      const available = assistant ? state.assistantOnline : true;
      return {
        id: sk.id,
        available,
        reason: available ? null : 'assistant not reachable',
        badge: assistant && available ? skillConfigLabel(sk.id) : sk.engine,
      };
    }),
  );
}

/**
 * Executability is a state (T3.3.5).
 *
 * A card may only look pressable while the thing behind it can actually run.
 * `/capture` is a core write path and is always available; the three assistant
 * skills are disabled the moment the assistant stops answering, with the reason
 * stated in words on the card itself. A disabled card is not merely styled
 * differently — it is `aria-disabled`, drops its `button` role's tab stop, and
 * its handler refuses — so it cannot be run by click, Enter or screen reader.
 */
function setSkillsAvailability(online) {
  state.assistantOnline = online;
  for (const id of ASSISTANT_SKILLS) {
    const card = $(id);
    if (!card) continue;
    card.classList.toggle('unavailable', !online);
    card.setAttribute('aria-disabled', String(!online));
    card.tabIndex = online ? 0 : -1;
    const slot = card.querySelector('[data-state]');
    if (slot && !online) {
      slot.textContent = 'unavailable · assistant not reachable';
      slot.className = 'sk-state mono off';
    } else if (slot && slot.classList.contains('off')) {
      slot.textContent = '';
      slot.className = 'sk-state mono';
    }
  }
  renderSkillConfigs();
}

/**
 * Report a real run on the card that started it: running, then how long it took
 * and whether it succeeded. The elapsed time is measured, not estimated, and a
 * failure is reported as a failure — a card never silently returns to rest as
 * though the run had worked.
 */
function skillRun(cardId) {
  const slot = $(cardId)?.querySelector('[data-state]');
  const started = performance.now();
  let timer = null;
  const paint = (text, cls) => {
    if (!slot) return;
    slot.textContent = text;
    slot.className = `sk-state mono${cls ? ` ${cls}` : ''}`;
  };
  const elapsed = () => `${((performance.now() - started) / 1000).toFixed(1)}s`;
  paint('running · 0.0s', 'busy');
  timer = setInterval(() => paint(`running · ${elapsed()}`, 'busy'), 100);
  const stop = () => {
    if (timer) clearInterval(timer);
    timer = null;
  };
  return {
    ok: (note = 'done') => {
      stop();
      paint(`${note} · ${elapsed()}`, 'ok');
    },
    fail: (reason) => {
      stop();
      paint(`failed · ${reason}`, 'err');
    },
  };
}

/**
 * Ask the assistant what it is and what it can execute.
 *
 * The capability lists come from the RUNTIME, not from this file: an empty
 * models list means the configured runtime is not a model provider, and the
 * matrix renders every model as unavailable rather than pretending otherwise.
 */
async function probeAssistant() {
  const cells = document.querySelectorAll('.sk-meta[data-assistant]');
  try {
    const res = await fetch(`${ASSISTANT_URL}/healthz`, { method: 'GET' });
    const data = await res.json();
    const p = data?.provider;
    state.runtime = {
      kind: p?.kind ?? null,
      model: p?.model ?? null,
      tier: p?.tier ?? null,
      defaultEffort: p?.defaultEffort ?? null,
      models: Array.isArray(p?.models) ? p.models : [],
      efforts: Array.isArray(p?.efforts) ? p.efforts : [],
    };
    cells.forEach((c) => (c.textContent = providerLabel(p)));
    setSkillsAvailability(true);
  } catch {
    state.runtime = { kind: null, model: null, tier: null, defaultEffort: null, models: [], efforts: [] };
    cells.forEach((c) => (c.textContent = 'assistant · offline'));
    setSkillsAvailability(false);
  }
}

/* --------------------------------------------- the configuration popover --- */

let cfgFor = null;

function closeCfg() {
  $('cfg-pop').hidden = true;
  for (const b of document.querySelectorAll('.sk-cfg')) b.setAttribute('aria-expanded', 'false');
  cfgFor = null;
}

/** One option button. A value the runtime cannot run is disabled, struck
 *  through, and says why — it is never merely styled differently. */
function cfgOption(part, value, chosen, supported) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'cfg-opt';
  b.textContent = value;
  b.disabled = !supported;
  b.setAttribute('aria-pressed', String(supported && chosen === value));
  if (!supported) {
    b.title = `The configured runtime (${providerName(state.runtime.kind)}) cannot run "${value}".`;
    b.setAttribute('aria-disabled', 'true');
  }
  b.onclick = (ev) => {
    // The grid is rebuilt below, which detaches this button — so the
    // outside-click listener would no longer recognise it as inside the
    // popover and would close it. Stop here instead.
    ev.stopPropagation();
    if (!supported || !cfgFor) return;
    // Toggling off returns the card to the runtime's own default rather than
    // leaving a stale choice behind.
    const key = cfgKey(cfgFor, part);
    if (localStorage.getItem(key) === value) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
    renderSkillConfigs();
    openCfg(cfgFor, document.querySelector(`.sk-cfg[data-cfg="${cfgFor}"]`));
  };
  return b;
}

function openCfg(skill, anchor) {
  if (!anchor || anchor.disabled) return;
  cfgFor = skill;
  const pop = $('cfg-pop');
  const chosen = skillConfig(skill);
  $('cfg-title').textContent = `/${skill === 'extract' ? 'extract-tasks' : skill} configuration`;

  const models = $('cfg-models');
  models.textContent = '';
  for (const m of MODEL_TIERS) {
    models.append(cfgOption('model', m, chosen.model ?? state.runtime.tier, state.runtime.models.includes(m)));
  }
  const efforts = $('cfg-efforts');
  efforts.textContent = '';
  for (const e of EFFORT_LEVELS) {
    efforts.append(
      cfgOption('effort', e, chosen.effort ?? state.runtime.defaultEffort, state.runtime.efforts.includes(e)),
    );
  }

  // The note states what is actually running, and — when options are
  // unavailable — why. It never implies an unavailable option would work.
  const unsupportedModels = MODEL_TIERS.filter((m) => !state.runtime.models.includes(m));
  const unsupportedEfforts = EFFORT_LEVELS.filter((e) => !state.runtime.efforts.includes(e));
  const parts = [`Running on ${providerName(state.runtime.kind)}.`];
  if (unsupportedModels.length === MODEL_TIERS.length) {
    parts.push('This runtime is not a model provider, so no model can be selected.');
  } else if (unsupportedModels.length) {
    parts.push(`Unavailable here: ${unsupportedModels.join(', ')}.`);
  }
  if (unsupportedEfforts.length === EFFORT_LEVELS.length) {
    parts.push('It exposes no effort control.');
  } else if (unsupportedEfforts.length) {
    parts.push(`Effort unavailable: ${unsupportedEfforts.join(', ')}.`);
  }
  $('cfg-note').textContent = parts.join(' ');

  pop.hidden = false;
  anchor.setAttribute('aria-expanded', 'true');
  const r = anchor.getBoundingClientRect();
  const w = pop.offsetWidth;
  pop.style.left = `${Math.max(8, Math.min(window.innerWidth - w - 8, r.left))}px`;
  pop.style.top = `${Math.min(window.innerHeight - pop.offsetHeight - 8, r.bottom + 6)}px`;
}

function wireSkillConfig() {
  for (const btn of document.querySelectorAll('.sk-cfg')) {
    btn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      if (cfgFor === btn.dataset.cfg) closeCfg();
      else openCfg(btn.dataset.cfg, btn);
    });
  }
  $('cfg-close').onclick = closeCfg;
  document.addEventListener('click', (ev) => {
    if (!cfgFor) return;
    if ($('cfg-pop').contains(ev.target)) return;
    if (ev.target.closest?.('.sk-cfg')) return;
    closeCfg();
  });
}

/* ------------------------------------------------- repository (T3.3.1) ----- */
//
// External activity, read live from /api/external/github. Three rules govern
// everything below, and each is enforced rather than asserted:
//
//   1. A NUMBER IS PRINTED ONLY WHEN IT IS EXACT. The server marks a section's
//      total `null` when the source could not prove it was the whole set, and
//      `exact()` renders that as an em dash. A partial page is never printed as
//      a total.
//   2. AN UNAVAILABLE SECTION SAYS SO. `ok: false` carries the source's own
//      reason and is rendered as that reason — never as an empty list, which
//      would read as "nothing happened".
//   3. NOTHING IS SYNTHESISED. Every row's title, actor, state, timestamp and
//      URL is a field the source returned; a missing field renders as absent.

const REPO_EVENT_LABEL = {
  commit: 'commit',
  pull_request: 'pull request',
  issue: 'issue',
  workflow_run: 'CI run',
};

/** An exact count, or an em dash when the source could not prove one. */
const exact = (section) => (section?.ok && section.total !== null ? String(section.total) : '—');

const sectionOf = (repo, kind) => repo?.sections?.[kind] ?? null;
const entitiesOf = (repo, kind) => {
  const s = sectionOf(repo, kind);
  return s?.ok ? s.entities : [];
};

function repoRow(entity) {
  const tr = document.createElement('tr');
  tr.dataset.ref = entity.ref; // the stable external id, preserved on the row
  const t = document.createElement('td');
  t.className = 't mono';
  t.textContent = istStamp(entity.at);
  const c = document.createElement('td');
  c.className = 'cx';
  const kind = REPO_EVENT_LABEL[entity.kind] ?? entity.kind;
  c.textContent = entity.title || `(untitled ${kind})`;
  const sub = document.createElement('span');
  sub.className = 'rx mono';
  // Only what the source actually reported: no actor line when there is no actor.
  sub.textContent = entity.actor ? `${kind} · ${entity.actor}` : kind;
  c.append(document.createElement('br'), sub);
  const s = document.createElement('td');
  s.className = 'st';
  s.textContent = entity.state ?? '—';

  tr.append(t, c, s);
  if (entity.url) {
    tr.setAttribute('role', 'button');
    tr.setAttribute('tabindex', '0');
    tr.setAttribute('aria-label', `Open ${entity.title || kind} on GitHub`);
    const open = () => window.open(entity.url, '_blank', 'noopener,noreferrer');
    tr.addEventListener('click', open);
    tr.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        open();
      }
    });
  } else {
    tr.classList.add('inert');
  }
  return tr;
}

function renderRepoUnavailable(message) {
  const stateEl = $('repo-state');
  stateEl.textContent = 'Unavailable';
  stateEl.className = 'meta tag offline';
  $('repo-name').textContent = '—';
  $('repo-sub').textContent = '';
  $('repo-link').removeAttribute('href');
  for (const id of ['repo-prs', 'repo-branches', 'repo-people']) $(id).textContent = '—';
  $('repo-breakdown').textContent = '';
  $('repo-rows').textContent = '';
  $('repo-contributors').textContent = '';
  $('repo-linked').textContent = '';
  $('repo-link-label').hidden = true;
  $('repo-ci').textContent = '—';
  const empty = $('repo-empty');
  empty.hidden = false;
  empty.textContent = message;
  $('repo-foot').textContent = 'No repository activity is being displayed.';
}

async function loadRepository() {
  let repo;
  try {
    repo = await api('/api/external/github');
  } catch (err) {
    renderRepoUnavailable(
      err.status === 401
        ? 'Not authenticated, so no repository activity was requested.'
        : `Repository activity could not be read: ${err.message}`,
    );
    return;
  }
  state.repo = repo;

  if (!repo.configured) {
    renderRepoUnavailable('No repository is configured for this workspace.');
    $('repo-state').textContent = 'Not configured';
    return;
  }

  const repoSection = sectionOf(repo, 'repository');
  const meta = entitiesOf(repo, 'repository')[0] ?? null;

  const stateEl = $('repo-state');
  if (repo.stale) {
    stateEl.textContent = 'Stale';
    stateEl.className = 'meta tag warn';
  } else if (repoSection?.ok) {
    stateEl.textContent = 'Live';
    stateEl.className = 'meta tag live';
  } else {
    stateEl.textContent = 'Unavailable';
    stateEl.className = 'meta tag offline';
  }

  $('repo-name').textContent = repo.repository;
  $('repo-sub').textContent = meta
    ? [meta.detail.defaultBranch, meta.state, meta.detail.language]
        .filter(Boolean)
        .join(' · ')
    : (repoSection && !repoSection.ok ? repoSection.error : '—');
  if (repo.repositoryUrl) $('repo-link').href = repo.repositoryUrl;
  else $('repo-link').removeAttribute('href');

  // Exact totals only. Pull requests, branches and contributors came back as
  // provably complete pages; anything that did not renders as an em dash.
  $('repo-prs').textContent = exact(sectionOf(repo, 'pull_request'));
  $('repo-branches').textContent = exact(sectionOf(repo, 'branch'));
  $('repo-people').textContent = exact(sectionOf(repo, 'contributor'));

  const prs = sectionOf(repo, 'pull_request');
  const issues = sectionOf(repo, 'issue');
  const parts = [];
  if (prs?.ok && prs.total !== null) {
    const open = prs.entities.filter((p) => p.state === 'open').length;
    const merged = prs.entities.filter((p) => p.state === 'merged').length;
    parts.push(`${open} open · ${merged} merged`);
  } else if (prs && !prs.ok) {
    parts.push('pull requests unavailable');
  }
  if (issues?.ok && issues.total !== null) {
    parts.push(`${issues.entities.filter((i) => i.state === 'open').length} open issues`);
  } else if (issues && !issues.ok) {
    parts.push('issues unavailable');
  }
  $('repo-breakdown').textContent = parts.join(' · ');

  // Recent activity: real entities across the time-stamped kinds, newest first.
  const timeline = ['commit', 'pull_request', 'issue', 'workflow_run']
    .flatMap((k) => entitiesOf(repo, k))
    .filter((e) => e.at)
    .sort((a, b) => String(b.at).localeCompare(String(a.at)))
    .slice(0, 8);
  const rows = $('repo-rows');
  rows.textContent = '';
  for (const e of timeline) rows.append(repoRow(e));

  const failed = ['commit', 'pull_request', 'issue', 'workflow_run']
    .map((k) => sectionOf(repo, k))
    .filter((s) => s && !s.ok);
  const empty = $('repo-empty');
  if (timeline.length === 0) {
    empty.hidden = false;
    empty.textContent = failed.length
      ? failed[0].error
      : 'No timestamped repository activity was returned.';
  } else {
    empty.hidden = failed.length === 0;
    if (failed.length) empty.textContent = `Partly unavailable — ${failed[0].error}`;
  }

  // Contributors: real logins and the contribution counts GitHub reports. No
  // e-mail, avatar or role — the source does not give them here and we do not
  // fetch them, so none can be shown. These are GitHub accounts, deliberately
  // NOT merged into workspace membership: they are different identity systems.
  const people = $('repo-contributors');
  people.textContent = '';
  const contributors = sectionOf(repo, 'contributor');
  if (contributors?.ok) {
    for (const c of contributors.entities) {
      const li = document.createElement('li');
      li.className = 'tm-row';
      const chip = document.createElement('span');
      chip.className = 'tm-chip';
      chip.textContent = (c.title || '?').charAt(0).toUpperCase();
      const nm = document.createElement('span');
      nm.className = 'tm-name';
      if (c.url) {
        const a = document.createElement('a');
        a.href = c.url;
        a.target = '_blank';
        a.rel = 'noreferrer noopener';
        a.textContent = c.title;
        nm.append(a);
      } else {
        nm.textContent = c.title;
      }
      const n = document.createElement('span');
      n.className = 'tm-you label';
      const commits = c.detail?.contributions;
      n.textContent = typeof commits === 'number' ? `${commits} commits` : '';
      li.append(chip, nm, n);
      people.append(li);
    }
    if (contributors.entities.length === 0) {
      const li = document.createElement('li');
      li.className = 'rail-quiet';
      li.textContent = 'GitHub reported no contributors for this repository.';
      people.append(li);
    }
  } else {
    const li = document.createElement('li');
    li.className = 'rail-quiet';
    li.textContent = contributors?.error ?? 'Contributors unavailable.';
    people.append(li);
  }

  // CI: what the Actions API actually reports. Zero runs is a real answer and
  // is stated as zero runs — never as a green tick, and never as a failure.
  const ci = sectionOf(repo, 'workflow_run');
  const ciEl = $('repo-ci');
  if (!ci?.ok) {
    ciEl.textContent = ci?.error ?? 'Workflow status unavailable.';
    ciEl.className = 'repo-ci off';
  } else if ((ci.total ?? ci.entities.length) === 0) {
    ciEl.textContent = 'No workflow runs recorded for this repository.';
    ciEl.className = 'repo-ci off';
  } else {
    const latest = ci.entities[0];
    ciEl.textContent =
      `${latest.title || 'workflow'} · ${latest.state ?? 'unknown'}` +
      `${latest.detail?.branch ? ` · ${latest.detail.branch}` : ''} · ${istStamp(latest.at)}` +
      ` (${ci.total} run${ci.total === 1 ? '' : 's'})`;
    ciEl.className = `repo-ci ${latest.state === 'success' ? 'ok' : latest.state === 'failure' ? 'err' : ''}`;
  }

  // The internal object this repository is anchored to — resolved by the server
  // through the same VisibilityPolicy as every other read, so it can only name
  // an object this principal may already open. Clicking it uses the one
  // selection path every other surface uses, so the repository panel, the map
  // and the inspector all lead to the same object (T3.3.11).
  const linked = $('repo-linked');
  linked.textContent = '';
  $('repo-link-label').hidden = repo.links.length === 0;
  for (const l of repo.links) {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'repo-link-row';
    btn.textContent = l.objectTitle || '(untitled)';
    const k = document.createElement('span');
    k.className = 'rk label';
    k.textContent = l.objectType;
    btn.append(k);
    btn.onclick = () => goTo(l.objectId);
    li.append(btn);
    linked.append(li);
  }

  // Freshness and provenance, always stated: which source, how it authenticated,
  // and the instant the network read completed — not the instant of this render.
  const fetched = istStamp(repo.fetchedAt);
  $('repo-foot').textContent = repo.stale
    ? `Showing the last successful read (${fetched} IST). Refresh failed: ${repo.staleReason}`
    : `${repo.source} · ${repo.authMode} · read ${fetched} IST. External activity only — DEVWORKSPACE objects are not created from it.`;
}

/* ----------------------------------------------------- routines (T3.3.4) --- */
//
// Real background-execution records, or a truthful empty state. Nothing here
// invents a schedule, a fire time or a next run, because the product has no
// clock-based scheduler — and nothing infers whether a worker process is alive,
// because the datastore cannot observe that. A pending row means the row has
// not been delivered; that is a fact about the queue, and it is all that is said.

const RUN_STATE_LABEL = {
  delivered: 'Delivered',
  pending: 'Pending',
  dead_lettered: 'Dead-lettered',
};

async function loadWorker() {
  const body = $('routine-rows');
  const note = $('routines-note');
  const tag = $('routines-state');
  if (!body) return;
  body.textContent = '';

  let w;
  try {
    w = await api('/api/system/worker');
  } catch (err) {
    tag.textContent = 'Unavailable';
    tag.className = 'meta tag offline';
    note.textContent =
      err.status === 401
        ? 'Not authenticated, so no execution records were requested.'
        : `Execution records could not be read: ${err.message}`;
    return;
  }
  state.worker = w;

  tag.textContent = `${w.delivered} run${w.delivered === 1 ? '' : 's'}`;
  tag.className = `meta tag${w.deadLettered > 0 ? ' err' : w.pending > 0 ? ' warn' : ' live'}`;

  for (const r of w.runs) {
    const tr = document.createElement('tr');
    tr.className = r.state === 'delivered' ? 'past' : '';
    const t = document.createElement('td');
    t.className = 't mono';
    t.textContent = istStamp(r.at);
    const c = document.createElement('td');
    c.className = 'cx';
    // The registered consumer, or the plain truth that none handles this event.
    c.textContent = r.routine ?? 'no registered consumer';
    const sub = document.createElement('span');
    sub.className = 'rx mono';
    sub.textContent = r.objectTitle ? `${r.event} · ${r.objectTitle}` : r.event;
    c.append(document.createElement('br'), sub);
    const s = document.createElement('td');
    s.className = 'st';
    s.textContent = RUN_STATE_LABEL[r.state] ?? r.state;

    tr.append(t, c, s);
    // Cross-surface identity: a run names a real object, and opening it goes
    // through the same reveal path the graph, search and the inspector use.
    if (r.objectId) {
      tr.setAttribute('role', 'button');
      tr.setAttribute('tabindex', '0');
      tr.setAttribute('aria-label', `Open ${r.objectTitle} in the Second Brain`);
      const go = () => goTo(r.objectId);
      tr.addEventListener('click', go);
      tr.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          go();
        }
      });
    } else {
      tr.classList.add('inert');
    }
    body.append(tr);
  }

  const engine =
    `Execution records from the outbox worker — event-driven, polling every ` +
    `${w.pollIntervalMs} ms. DEVWORKSPACE has no clock-based scheduler, so no ` +
    `routine has a fire time or a next run.`;
  if (w.runs.length === 0) {
    note.textContent = `No background execution has been recorded for context you can see. ${engine}`;
  } else {
    const pending = w.pending
      ? ` ${w.pending} event${w.pending === 1 ? '' : 's'} queued and not yet drained.`
      : '';
    const dead = w.deadLettered ? ` ${w.deadLettered} dead-lettered.` : '';
    note.textContent =
      `${w.delivered} delivered${w.lastDeliveredAt ? `, last ${istStamp(w.lastDeliveredAt)} IST` : ''}.` +
      `${pending}${dead} ${engine}`;
  }
}

/* ------------------------------------------- artifacts (T3.3-CORRECTION §1) */
//
// The command centre's orbit. Every node here is an OUTPUT this system actually
// produced — a delivered background routine, a CI run, a pull request, an
// issue, or an object a user kept from an assistant proposal — assembled by the
// server from records that already existed. The six static capability circles
// that used to occupy this ring are gone.
//
// Nothing is seeded to make the ring look populated. If the sources produced
// nothing, the orbit renders its own emptiness and the surrounding structure is
// untouched.

const ARTIFACT_LABEL = {
  routine: 'Routine output',
  ci: 'CI run',
  pull_request: 'Pull request',
  issue: 'Issue',
  ai_result: 'AI result',
};

async function loadArtifacts() {
  let feed;
  try {
    feed = await api('/api/artifacts');
  } catch (err) {
    state.artifacts = [];
    ring.renderArtifacts([]);
    $('os-tr').textContent =
      err.status === 401 ? 'NOT AUTHENTICATED' : 'ARTIFACTS UNAVAILABLE';
    return;
  }
  // The label is resolved once, here, so the node, the tooltip and the modal
  // can never name the same category three different ways.
  state.artifacts = feed.items.map((a) => ({
    ...a,
    categoryLabel: ARTIFACT_LABEL[a.category] ?? a.category,
  }));
  ring.renderArtifacts(state.artifacts);
  state.artifactSources = feed.sources ?? [];
  renderArtifactReadout();
}

/**
 * The readout states what is real: how many outputs, how many are still unread,
 * and — when a source could not be read — that it could not, with its own
 * reason. Unread is recomputed from the items in hand rather than carried from
 * the fetch, so opening an artifact updates the count immediately instead of
 * leaving a number on screen that the reader has just made false.
 */
function renderArtifactReadout() {
  const broken = (state.artifactSources ?? []).filter((x) => !x.ok);
  const n = state.artifacts.length;
  const unread = state.artifacts.filter((a) => a.unread).length;
  $('os-tr').textContent =
    `${n} ARTIFACT${n === 1 ? '' : 'S'} · ${unread} UNREAD` +
    (broken.length ? ` · ${broken.length} SOURCE${broken.length === 1 ? '' : 'S'} UNAVAILABLE` : '');
  $('os-tr').title = broken.length
    ? broken.map((b) => `${b.source}: ${b.reason}`).join('\n')
    : '';
}

/**
 * Artifact detail. Everything shown is a field the record carries; a field it
 * does not carry is not rendered at all. `Open source` appears only when a real
 * URL exists, and `Open in Second Brain` only when a real internal object is
 * behind the artifact — so neither action can lead nowhere.
 */
function openArtifact(a) {
  $('af-kind').textContent = a.categoryLabel;
  $('af-when').textContent = `${fmtDate(a.createdAt)} IST`;
  $('af-title').textContent = a.title;
  $('af-ref').textContent = a.id;

  const meta = $('af-meta');
  meta.textContent = '';
  const row = (k, v) => {
    if (v === null || v === undefined || v === '') return;
    const dt = document.createElement('dt');
    dt.textContent = k;
    const dd = document.createElement('dd');
    dd.textContent = String(v);
    meta.append(dt, dd);
  };
  row('Category', a.categoryLabel);
  row('Source', a.source);
  row('Produced', `${fmtDate(a.createdAt)} IST`);
  row('State', a.state);
  row('Read', a.unread ? 'unread' : 'read');
  for (const [k, v] of Object.entries(a.detail ?? {})) row(k, v);

  const src = $('af-source');
  src.hidden = !a.url;
  if (a.url) src.onclick = () => window.open(a.url, '_blank', 'noopener,noreferrer');

  const obj = $('af-object');
  obj.hidden = !a.objectId;
  if (a.objectId) {
    obj.onclick = () => {
      closeArtifact();
      // Cross-surface identity: the same id the graph, search and the inspector
      // use, through the one reveal path.
      goTo(a.objectId);
    };
  }

  $('artifact-modal').hidden = false;
  $('af-close').focus();

  // Opening it IS reading it — recorded for this principal alone.
  if (a.unread) {
    ring.markRead(a.id);
    state.artifacts = state.artifacts.map((x) => (x.id === a.id ? { ...x, unread: false } : x));
    renderArtifactReadout();
    api('/api/artifacts/read', { method: 'POST', body: JSON.stringify({ ref: a.id }) }).catch(
      () => {},
    );
  }
}

function closeArtifact() {
  $('artifact-modal').hidden = true;
}

function wireArtifacts() {
  $('af-close').onclick = closeArtifact;
  $('artifact-scrim').onclick = closeArtifact;
}

/* ------------------------------------- attention stack (T3.3-CORRECTION §3) */
//
// One triage surface, many sources. Mail is ONE of them, and the items it
// contributes come only from accounts the CURRENT USER connected — never from
// another member's mailbox, and never from the workspace head's by virtue of
// headship.
//
// A source that is not configured, not connected or unreadable says which, in
// words, and contributes nothing. A category count is printed only when the
// server proved it exact; otherwise the pill shows an em dash.

const INBOUND_ICON = {
  pull_request: '⑂',
  ci_failure: '⚠',
  issue: '◇',
  message: '✉',
};
const SOURCE_STATE_WORD = {
  connected: 'Connected',
  not_configured: 'Not configured',
  not_connected: 'Not connected',
  unavailable: 'Unavailable',
};

async function loadInbound() {
  const tag = $('inbound-state');
  const rows = $('inbound-rows');
  const pills = $('inbound-pills');
  const sources = $('inbound-sources');
  const empty = $('inbound-empty');
  if (!rows) return;

  let queue;
  try {
    queue = await api('/api/inbound');
  } catch (err) {
    tag.textContent = 'Unavailable';
    tag.className = 'meta tag offline';
    rows.textContent = '';
    pills.textContent = '';
    sources.textContent = '';
    empty.hidden = false;
    empty.textContent =
      err.status === 401
        ? 'Not authenticated, so no inbound items were requested.'
        : `The attention stack could not be read: ${err.message}`;
    return;
  }

  const n = queue.items.length;
  tag.textContent = n ? `${n} waiting` : 'Clear';
  tag.className = `meta tag${n ? ' warn' : ' live'}`;

  pills.textContent = '';
  for (const c of queue.categories) {
    const el = document.createElement('span');
    el.className = `cpill${c.count === null ? ' unknown' : ''}`;
    const n = document.createElement('span');
    n.className = 'n';
    // An unknown total is an absence, never the size of the page in hand.
    n.textContent = c.count === null ? '—' : String(c.count);
    el.append(n, document.createTextNode(c.label));
    if (c.count === null) el.title = 'The source could not prove this total, so none is shown.';
    pills.append(el);
  }

  rows.textContent = '';
  for (const item of queue.items) {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'ai';
    btn.disabled = !item.url;

    const t = document.createElement('span');
    t.className = 't';
    t.textContent = item.title;
    const tm = document.createElement('span');
    tm.className = 'tm';
    tm.textContent = istStamp(item.at);
    const m = document.createElement('span');
    m.className = 'm';
    const icon = INBOUND_ICON[item.category] ?? '·';
    m.textContent = item.subtitle ? `${icon} ${item.subtitle}` : icon;
    btn.append(t, tm, m);

    // Account attribution: an e-mail item names the mailbox it came from, so a
    // user with several can tell which one is asking for them. Nothing else
    // about the message is exposed.
    if (item.sourceAccount) {
      const acct = document.createElement('span');
      acct.className = 'acct';
      acct.textContent = `source · ${item.sourceAccount}`;
      btn.append(acct);
    }
    if (item.url) btn.onclick = () => window.open(item.url, '_blank', 'noopener,noreferrer');
    li.append(btn);
    rows.append(li);
  }

  empty.hidden = n > 0;
  if (n === 0) {
    const blocked = queue.sources.filter((x) => x.state === 'unavailable');
    empty.textContent = blocked.length
      ? `Nothing to show — ${blocked[0].detail}`
      : 'Nothing is waiting on you from the connected sources.';
  }

  sources.textContent = '';
  for (const src of queue.sources) {
    const li = document.createElement('li');
    li.className = src.state === 'connected' ? 'ok' : src.state === 'unavailable' ? 'err' : 'off';
    const s = document.createElement('span');
    s.className = 's';
    s.textContent = `${src.label} · ${SOURCE_STATE_WORD[src.state] ?? src.state}`;
    const d = document.createElement('span');
    d.className = 'd';
    d.textContent = src.detail ?? '';
    li.append(s, d);
    sources.append(li);
  }
}

/* --------------------------------------- mail accounts (T3.3-CORRECTION §4) */
//
// Per-user mail. This panel shows the accounts of the person whose credential
// is in force, and nothing else: the server filters by principal, so there is
// no request this page could make that would return someone else's mailbox.
//
// Authentication happens AT THE PROVIDER. There is no password field on this
// surface and nowhere for one to go: pressing Add opens the provider's own
// consent screen, and the grant comes back to the server, which seals it before
// storing it. A provider this deployment has not been configured for is offered
// as unavailable WITH the reason, never as a button that fails afterwards.

const MAIL_STATUS_WORD = {
  pending: 'Awaiting consent',
  connected: 'Connected',
  expired: 'Authorization expired',
  revoked: 'Access revoked',
  error: 'Last read failed',
};

function openSettings() {
  $('settings').hidden = false;
  $('t-settings').setAttribute('aria-expanded', 'true');
  loadMail();
  renderSettingsIdentity();
  $('settings-close').focus();
}

function closeSettings() {
  $('settings').hidden = true;
  $('t-settings').setAttribute('aria-expanded', 'false');
}

/** Who you are, and who heads this workspace — the two, stated separately. */
function renderSettingsIdentity() {
  const host = $('settings-identity');
  if (!host) return;
  host.textContent = '';
  const me = state.me;
  const row = (k, v) => {
    const li = document.createElement('li');
    const kk = document.createElement('span');
    kk.className = 'k';
    kk.textContent = k;
    const vv = document.createElement('span');
    vv.className = 'v';
    vv.textContent = v;
    li.append(kk, vv);
    host.append(li);
  };
  row('Signed in as', me?.displayName ?? 'not authenticated');
  row('Principal', me?.principalId ?? '—');
  row('Your role', me?.role === 'owner' ? 'workspace head' : (me?.role ?? '—'));
  row('Workspace', me?.workspace?.name ?? '—');
  // Headship is read from the membership that carries the owner role. A
  // workspace with none says so rather than naming a likely candidate.
  row('Workspace head', me?.workspace?.head?.displayName ?? 'not recorded');
  $('settings-who').textContent = me?.displayName ?? '—';
}

async function loadMail() {
  const host = $('mail-accounts');
  const note = $('mail-note');
  const providers = $('mail-providers');
  if (!host) return;
  try {
    state.mail = await api('/api/mail/accounts');
  } catch (err) {
    host.textContent = '';
    note.textContent =
      err.status === 401
        ? 'Not authenticated, so no mail accounts were requested.'
        : `Mail accounts could not be read: ${err.message}`;
    providers.textContent = '';
    return;
  }

  const { accounts, providers: list, storage } = state.mail;
  note.textContent = storage.ok
    ? `${accounts.length} account${accounts.length === 1 ? '' : 's'} connected to your user. They are visible only to you.`
    : storage.reason;

  host.textContent = '';
  if (accounts.length === 0) {
    const li = document.createElement('li');
    li.className = 'mail-empty';
    li.textContent = 'No mail account is connected to your user.';
    host.append(li);
  }
  for (const a of accounts) {
    host.append(mailCard(a));
  }

  providers.textContent = '';
  for (const p of list) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'pill ghost sm';
    b.textContent = `+ ${p.label}`;
    const blocked = !p.configured || !storage.ok;
    b.disabled = blocked;
    // Executability is a state here too: a provider that cannot complete its
    // flow says why instead of failing after the user has pressed it.
    b.title = blocked ? (p.reason ?? storage.reason ?? 'unavailable') : `Scopes: ${p.scopes.join(', ')}`;
    b.onclick = () => connectMail(p.id);
    providers.append(b);
  }
  if (list.every((p) => !p.configured)) {
    const s = document.createElement('span');
    s.className = 'mail-empty';
    s.textContent = 'No mail provider is configured for this deployment.';
    providers.append(s);
  }
}

function mailCard(a) {
  const li = document.createElement('li');
  const card = document.createElement('div');
  card.className = 'mail-card';

  const addr = document.createElement('span');
  addr.className = 'addr';
  addr.textContent = a.address;

  const st = document.createElement('span');
  st.className = `st ${a.status}`;
  st.textContent =
    `${MAIL_STATUS_WORD[a.status] ?? a.status} · ${a.provider}` +
    (a.lastSyncAt ? ` · last sync ${istStamp(a.lastSyncAt)}` : ' · never synced');
  card.append(addr, st);

  // The provider's own words for a failure — never a stack trace, never hidden.
  if (a.lastError) {
    const why = document.createElement('span');
    why.className = 'why';
    why.textContent = a.lastError;
    card.append(why);
  }

  const row = document.createElement('div');
  row.className = 'row';

  const reconnect = document.createElement('button');
  reconnect.type = 'button';
  reconnect.className = 'pill ghost sm';
  reconnect.textContent = a.status === 'connected' ? 'Reconnect' : 'Reconnect now';
  reconnect.onclick = () => connectMail(a.provider, a.id);

  const disconnect = document.createElement('button');
  disconnect.type = 'button';
  disconnect.className = 'pill ghost sm';
  disconnect.textContent = 'Disconnect';
  disconnect.onclick = async () => {
    disconnect.disabled = true;
    try {
      await api(`/api/mail/accounts/${a.id}`, { method: 'DELETE' });
      await loadMail();
      loadInbound();
    } catch (err) {
      disconnect.disabled = false;
      $('mail-note').textContent = `Not disconnected: ${err.message}`;
    }
  };

  // Which accounts feed the queue is per account, per user.
  const feeds = document.createElement('label');
  feeds.className = 'feeds';
  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.checked = a.feedsInbound;
  cb.onchange = async () => {
    try {
      await api(`/api/mail/accounts/${a.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ feedsInbound: cb.checked }),
      });
      loadInbound();
    } catch (err) {
      cb.checked = !cb.checked;
      $('mail-note').textContent = `Not changed: ${err.message}`;
    }
  };
  feeds.append(cb, document.createTextNode('feeds queue'));

  row.append(reconnect, disconnect, feeds);
  card.append(row);
  li.append(card);
  return li;
}

/**
 * Start a connection. The browser is sent to the PROVIDER's consent screen —
 * this application never sees the user's mail password, and the popup returns
 * to a server route that completes the exchange server-side.
 */
async function connectMail(provider, accountId = null) {
  try {
    const { authorizationUrl } = await api('/api/mail/accounts', {
      method: 'POST',
      body: JSON.stringify({ provider, accountId }),
    });
    window.open(authorizationUrl, 'devworkspace-mail', 'width=520,height=680');
  } catch (err) {
    $('mail-note').textContent = `Could not start: ${err.message}`;
  }
}

function wireMail() {
  $('t-settings').onclick = () => ($('settings').hidden ? openSettings() : closeSettings());
  $('settings-close').onclick = closeSettings;
  $('inbound-mail').onclick = openSettings;
  // The consent window tells us it finished; the accounts themselves are then
  // re-read FROM THE SERVER — no credential ever crosses this boundary.
  window.addEventListener('message', (ev) => {
    if (ev.origin !== window.location.origin) return;
    if (ev.data?.type !== 'devworkspace:mail') return;
    loadMail();
    loadInbound();
  });
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
  $('ins-src').textContent = '';
  $('ins-src').hidden = true;
  $('ins-src-label').hidden = true;
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
  $('ins-src').hidden = true;
  $('ins-src-label').hidden = true;

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

    renderExternalSource(o);

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
 * The external identity this object is anchored to, when it records one
 * (T3.3.1).
 *
 * It states the relationship precisely, because the distinction is the whole
 * point: the OBJECT is ours and is the system of record for its own title,
 * body, relationships and captured context; the ACTIVITY at the far end
 * belongs to GitHub and is read live. The reference itself is shown verbatim,
 * so the join is inspectable rather than implied.
 */
function renderExternalSource(o) {
  const ref = o?.attributes?.externalRef;
  const host = $('ins-src');
  const label = $('ins-src-label');
  if (typeof ref !== 'string' || !ref) {
    host.hidden = true;
    label.hidden = true;
    return;
  }
  host.textContent = '';
  const code = document.createElement('code');
  code.className = 'mono';
  code.textContent = ref;
  host.append(code);

  const url = typeof o.attributes?.externalUrl === 'string' ? o.attributes.externalUrl : null;
  if (url) {
    const a = document.createElement('a');
    a.href = url;
    a.target = '_blank';
    a.rel = 'noreferrer noopener';
    a.textContent = 'open on GitHub ↗';
    host.append(a);
  }
  const note = document.createElement('span');
  note.className = 'src-note';
  note.textContent =
    'This object is the system of record. Activity at the source is read live and never copied into it.';
  host.append(note);

  host.hidden = false;
  label.hidden = false;
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
      // A kept assistant proposal IS an artifact — the orbit gains it because
      // the object now exists, not because anything was seeded.
      loadArtifacts();
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

/**
 * Run the assistant and REPORT THE OUTCOME to the caller (T3.3.5).
 *
 * Returns `{ ok, note?, detail? }` so a Skills card can show that its run
 * actually succeeded or actually failed, rather than returning to rest and
 * leaving the user to assume it worked.
 */
async function runAsk(question, skillId = null) {
  if (state.ask.busy) return { ok: false, detail: 'already running' };
  const q = String(question ?? '').trim();
  if (!q) {
    setAskStatus('Ask a question.', 'err');
    return { ok: false, detail: 'no question' };
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
      // The configuration the card is displaying is the configuration that is
      // sent. Nothing is sent that the runtime did not report as supported —
      // and the pipeline validates it again on arrival, so an unsupported
      // combination fails as a failure rather than silently running something
      // else (T3.3-CORRECTION §5.1).
      body: JSON.stringify({
        question: q,
        targetId: state.selected?.node?.id ?? null,
        ...(skillId ? skillConfig(skillId) : {}),
      }),
    });
    const data = await res.json();
    if (!data.ok) {
      $('ask-out').hidden = true;
      const detail =
        data.stage === 'context'
          ? `Context unavailable: ${data.detail}`
          : `Model unavailable: ${data.detail}`;
      setAskStatus(detail, 'err');
      return { ok: false, detail: data.detail ?? detail };
    }
    state.ask.result = data;
    renderAsk(data);
    // Same naming as the Skills cards: a development stub is called a
    // development stub, never dressed up as a model (T3.2 §8).
    // What ACTUALLY ran, echoed by the pipeline — not what was requested.
    const ran = data.configuration
      ? [data.configuration.tier ?? data.configuration.model, data.configuration.effort]
          .filter(Boolean)
          .join(' · ')
      : '';
    setAskStatus(
      `${data.intent} · ${providerName(data.provider)}${ran ? ` · ${ran}` : ''}`,
      'ok',
    );
    $('ask-provider').textContent =
      `${providerName(data.provider).toUpperCase()}${ran ? ` · ${ran.toUpperCase()}` : ''} · ${data.weightSetVersion}`;
    // The note names what the run actually produced — grounded in real evidence,
    // or an answer with none. It never reports "done" for an ungrounded answer
    // as though it were the same result.
    return {
      ok: true,
      note: data.grounded ? `grounded in ${data.citations.length}` : 'ungrounded',
    };
  } catch (err) {
    $('ask-out').hidden = true;
    setAskStatus(`Assistant unreachable: ${err.message}`, 'err');
    return { ok: false, detail: 'assistant unreachable' };
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

/**
 * Options are the workspace's REAL members, read from the server (T3.3.2).
 *
 * There is no client-side fallback list any more: the demo principals that
 * used to fill this control before the members loaded are gone, and inventing
 * a stand-in would be exactly the fabrication this milestone removes. Until the
 * real members arrive the control states that it is still resolving.
 */
function renderPrincipalOptions() {
  const sel = $('principal');
  sel.textContent = '';
  if (state.members.length === 0) {
    const o = document.createElement('option');
    o.value = state.principalId;
    o.textContent = state.me?.displayName ?? 'resolving…';
    sel.append(o);
    return;
  }
  for (const m of state.members) {
    const o = document.createElement('option');
    o.value = m.id;
    o.textContent = m.displayName;
    if (m.id === state.principalId) o.selected = true;
    sel.append(o);
  }
}

/**
 * The two identities, as the SERVER reported them (T3.3-CORRECTION).
 *
 * They are DIFFERENT facts and the header states both:
 *   • the workspace HEAD — the member whose membership carries the `owner`
 *     role, which for DEVWORKSPACE is Dev;
 *   • YOU — whoever the presented credential resolves to, which changes when
 *     the principal does.
 *
 * Neither is hardcoded here. A workspace with no recorded head renders an
 * absence rather than a guess, and an unauthenticated session says so.
 */
function renderIdentity() {
  const me = state.me;
  const name = me?.displayName ?? null;
  const workspace = me?.workspace?.name ?? null;
  const isHead = me?.isWorkspaceHead === true;

  // The wordmark already names the product. The identity line under it repeats
  // the workspace name only when the workspace is not the product itself.
  $('brand-id').textContent = !name
    ? 'Not authenticated'
    : workspace && workspace.toUpperCase() !== 'DEVWORKSPACE'
      ? workspace
      : '';

  $('ident-head').textContent = me?.workspace?.head?.displayName ?? '—';
  $('ident-you').textContent = name ?? '—';
  // When you ARE the head, those are one person, and printing the same name
  // twice would read as two. State it once, with the role attached.
  $('ident').querySelector('.who.head').hidden = isHead;
  $('ident-role').textContent = isHead ? '· workspace head' : '';
  renderSettingsIdentity();
}

/**
 * Who the current credential resolves to. Asked of the server rather than
 * assumed from a local table, so the header can never show an identity the
 * datastore would not agree with.
 */
async function loadMe() {
  try {
    state.me = await api('/api/me');
  } catch {
    state.me = null;
  }
  renderIdentity();
  renderPrincipalOptions();
}

function wirePrincipal() {
  const sel = $('principal');
  renderPrincipalOptions();
  sel.onchange = async () => {
    state.principalId = sel.value;
    localStorage.setItem(PRINCIPAL_KEY, state.principalId);
    state.selected = null;
    view.select(null);
    // Everything scoped to a principal is re-read together, so no panel can be
    // left showing the previous identity's data — including the mail accounts,
    // which are per user and must never survive a switch.
    state.mail = { storage: { ok: false, reason: null }, providers: [], accounts: [] };
    state.artifacts = [];
    ring.renderArtifacts([]);
    await loadMe();
    await Promise.all([
      loadMembers(),
      loadGraph({ keepSelection: false }),
      loadRepository(),
      loadWorker(),
      loadArtifacts(),
      loadInbound(),
      loadMail(),
    ]);
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
      // A capture writes a real outbox event in the same transaction, so the
      // Routines surface has genuinely changed and is re-read rather than left
      // showing a stale queue — and once the worker delivers that event, it
      // becomes a real artifact, so the orbit is re-read with it.
      loadWorker();
      loadArtifacts();
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
      // Innermost surface first: a popover, then a modal, then the settings
      // panel, then search, then the inspector, then the place itself.
      if (!$('cfg-pop').hidden) {
        closeCfg();
        return;
      }
      if (!$('artifact-modal').hidden) {
        closeArtifact();
        return;
      }
      if (!$('settings').hidden) {
        closeSettings();
        return;
      }
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
    // The zone label comes from the same constant every formatter uses, so the
    // label and the numbers can never name different zones.
    const zone = document.querySelector('.clock-z .z');
    if (zone) zone.textContent = TZ_LABEL;
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
  renderIdentity();
}

/* ----------------------------------------------------- workflows (right rail) */
//
// Named, one-press developer actions. Each delegates to a real, already-wired
// capability — the left-rail capture flow, or the P3.4 assistant panel and its
// summarize / extract actions — so nothing here claims an executable the
// backend does not have. They run against the current selection scope.
function wireWorkflows() {
  // One runner for both invocation surfaces — the Second Brain's inner ring
  // and these cards — so a skill cannot behave differently depending on where
  // it was pressed.
  for (const [id, capability] of Object.entries(SKILL_BY_CARD)) {
    const e = $(id);
    if (!e) continue;
    e.addEventListener('click', async (ev) => {
      // A disabled card must actually refuse, not merely look disabled.
      if (e.getAttribute('aria-disabled') === 'true') return;
      document.body.classList.remove('drawer-left', 'drawer-right');

      // Pressing the configuration control is not pressing the card.
      if (ev.target.closest?.('.sk-cfg')) return;
      const slot = e.querySelector('[data-state]');
      // Only a capability that genuinely executes gets a running state. Opening
      // a panel is reported as opening a panel — timing it would dress
      // navigation up as work (T3.3.5).
      const willRun = capability === 'summarize' || capability === 'extract';
      const reporter = willRun ? skillRun(id) : null;
      try {
        const outcome = await runSkill(capability);
        if (reporter) {
          if (outcome?.ok) reporter.ok(outcome.note ?? 'done');
          else reporter.fail(outcome?.detail ?? 'no result');
        } else if (slot) {
          slot.textContent = outcome?.note ?? '';
          slot.className = 'sk-state mono';
        }
      } catch (err) {
        if (reporter) reporter.fail(err.message);
        else if (slot) {
          slot.textContent = `failed · ${err.message}`;
          slot.className = 'sk-state mono err';
        }
      }
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
wireSkillConfig();
wireArtifacts();
wireMail();
wireChrome();
startClock();
// Assistant-backed Skills start disabled and are enabled only once the service
// actually answers — the default state is the honest one (T3.3.5).
setSkillsAvailability(false);
probeAssistant();
closeInspector();
loadMe();
loadMembers();
loadGraph({ keepSelection: false });
loadRepository();
loadWorker();
// The artifact orbit and the attention stack are separate reads: they are
// produced by systems the graph knows nothing about, and each states its own
// availability rather than inheriting the graph's.
loadArtifacts();
loadInbound();
