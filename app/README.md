# Personal Developer Workspace — application

First implementation slice (**P2.7**): **Capture → Persist → Associate → Display**.

A developer opens the app, opens a project, captures a note, and sees it persisted
as part of that project — through the real authorization boundary, into real
PostgreSQL, surfaced through the first-class relationship read model.

Built against the accepted architecture: **P2.5** (decision) and **P2.6**
(implementation architecture). This slice implements only what that path needs.

## Requirements

- **Node.js ≥ 22.6** (uses native TypeScript execution — no build step). Verified on Node 26.
- **PostgreSQL ≥ 14** running locally.

> **Local-dev note (environment deviation from P2.6 §18):** P2.6 specifies
> `docker compose` with a PostgreSQL container. Docker is not available in this
> environment, so these instructions use a locally-installed PostgreSQL instead.
> This changes *how Postgres is started*, nothing about the architecture — the
> application still targets a single real PostgreSQL system of record. A
> `docker-compose.yml` can be added later without any code change.

## Commands

```sh
cd app

# 1. install dependencies
npm install

# 2. start PostgreSQL (example: Homebrew)
#    brew services start postgresql@16

# 3. create the databases (app + test)
createdb devworkspace
createdb devworkspace_test

# 4. configure
cp .env.example .env          # defaults already match the createdb names

# 5. run migrations (forward-only, from empty)
npm run migrate               # npm run migrate -- --status  to inspect

# 6. seed deterministic development data
npm run seed

# 7. start the two processes (separate terminals)
npm run dev:core              # http://localhost:4177
npm run dev:worker            # drains the transactional outbox

# 8. tests  (uses devworkspace_test; drops & recreates its schema each run)
npm test

# 9. type check
npm run typecheck
```

Open <http://localhost:4177>. Use the **Acting as** switcher:

- **Alice** owns the seeded projects — she can view them and capture into them.
- **Bob** is a workspace member with **no** share — he sees nothing (deny-by-default).

## What is real vs. mocked

| Real | Mocked / dev-only |
|---|---|
| Node HTTP application, worker process | — |
| PostgreSQL persistence, migrations, transactions | — |
| `VisibilityPolicy` authorization (SQL fragment + `canSee` from one source) | — |
| First-class `relationship` edges + synthesised `belongs_to` read model | — |
| Transactional outbox + state-based idempotent worker consumer | — |
| Capture → persist → associate → display workflow | — |
| — | **Authentication** — a `Authorization: Dev <principalId>` header maps to a seeded principal (`src/adapters/http/auth.ts`). This is **not** the final auth architecture (P2.5 §22 Q6). It exists only to exercise the authorization boundary. |
| — | Seeded projects / one seeded note, so the project view is immediately non-empty. |

## Module boundaries (P2.6 §6)

```
src/domain/        pure — objects, relationships, VisibilityPolicy. no I/O.
src/ports/         interfaces. every read takes a ResolvedScope.
src/application/   use cases: capture-note, view-project.
src/adapters/
  persistence/     the only place SQL lives (INV-14).
  http/            Node http server + DEV auth + composition root.
  web/             vanilla HTML/CSS/JS, connected to the real API.
src/worker/        outbox drain + fts-maintenance consumer.
```

## Visual shell (P3.1 — static)

`src/adapters/web/` is the dark HUD **developer command center**. It is
calibrated to the supplied **RUBRIC reference screenshots** (the primary visual
authority), then `Design_Dashboard_Aesthetic_Claude_Blueprint.md`:

- **Pure-black canvas.** A 1px orange hairline runs across the very top edge.
  Semantic accents used sparingly: orange = action / active, cyan = apps /
  external, purple = memory / context, amber = routines, red = blocker.
- **Borderless rails.** Following the reference, the rails are NOT boxed
  panels — they are typographic sections on pure black, divided by hairline
  rules. Only the Skills Deck items are real cards. Big orange metric numbers;
  very small tightly-tracked uppercase labels; monospace for times / ids /
  status.
- **Compact centred header:** a small orange product mark + `AGENTIC CONTEXT
  OS` subtitle + a row of tiny icon controls; thin orange-outline pill
  buttons (`GRAPH`, `MENU`) at the edges; the dev-auth principal switcher as
  a pill.
- **Central Context Field — a static SVG, the dominant surface.** Concentric
  labelled orbital layers matching the reference: `APPLICATIONS` (cyan ring +
  hex icon badges, representative / offline), `ROUTINES` (amber ring + nodes),
  `MEMORY` (purple). A full-360° dense concentric **dot-field** fills the
  memory annulus; an orange `CONTEXT.CORE` hexagon and a dense particle core
  sit at the centre; a faint hex-grid texture backs it.
  **Real data:** one small labelled node per project near the core, and each
  project forms a bright **cluster wedge** in the memory field whose lit inner
  rings track its real capture count. Selecting a project node slides up a
  compact **Context Inspector** (detail on demand, ~40% height) with that
  project's real captured context and the real capture form; a new capture
  brightens its wedge immediately.
  **No graph engine, no Three.js, no physics** (a later milestone).
- Responsive: desktop command centre → ≤1200px rails become Esc-dismissable
  overlay drawers (☰ in the header) → ≤720px sequential stack. Verified free
  of horizontal overflow at 2048 / 1600 / 1140 / 390.

**P3.1 decisions (small, documented):**
- Fonts loaded from Google Fonts (Inter + JetBrains Mono) with full system
  fallback stacks — degrades cleanly offline. Single `<link>`, no build step.
- One ambient effect: a ~240s Applications-ring rotation, disabled under
  `prefers-reduced-motion`. No other continuous motion.
- Preview widgets (Developer Activity timeline, Project Pulse task counts,
  Attention, Skills Deck, Routines) use representative developer content and
  carry a `PREVIEW` tag; offline tools show `OFFLINE`. Real values: the clock,
  the selected project name, the capture count / activity dots, and every
  Context Field node.
- On load the field hydrates by fetching each visible project's
  `/api/projects/:id` (a handful of calls for seed data) so context nodes are
  real, not representative.
- Mobile section order: field + capture → Attention rail → tools/pulse rail.

## Interactive context graph (P3.2)

P3.1's Context Field was a static SVG. P3.2 turns it into a real interactive
graph **without changing the accepted visual system** — same header, rails,
typography, semantic accents, orbital geometry and memory density. What was
drawn is now navigable.

**Data source — one, server-side.** `GET /api/graph` returns the whole graph
the current principal may see; `GET /api/objects/:id` returns one object with
its edges for the inspector. Both are assembled in
`application/context-graph.ts` from the same repositories, the same
`ResolvedScope` and the same `VisibilityPolicy` fragment as every other read
(INV-3). There is deliberately **no graph-specific authorization path**:

- nodes = `ObjectRepository.listVisible(scope)`
- edges = `RelationshipRepository.listVisible(scope)` — the whole-graph form of
  `forObject()`, composed from the identical SQL fragments
- an assembly-time cross-check drops any edge whose endpoints are not both in
  the visible node set, so an edge can never imply a node the principal cannot
  see
- `stats` are counted from the filtered node set, so counts cannot leak either

Client-side filters, collapse and search operate only on that already-filtered
payload. **Client filtering is a view concern, never the security boundary.**

**Semantic layers** map real object types onto the accepted P3.1 layers — no
invented domain semantics:

| Layer | Source | Treatment |
|---|---|---|
| `CONTEXT CORE` | the real workspace from the resolved scope | orange hexagon |
| `CONTEXT` | `project`, `task` | orange disc + label + capture count |
| `MEMORY` | `note`, `idea`, `decision`, `resource`, `checkpoint` | purple node in its project's wedge |
| `ROUTINES` / `APPLICATIONS` | **no domain data exists** | offline orbit scaffold: dimmed, non-interactive, filterable, never selectable |

Edges are real: stored `relationship` rows (dashed cyan, authored), the
synthesised `belongs_to` anchor from `home_project_id` (purple), and structural
containment computed on read from `object.workspace_id` (faint, labelled
`origin: 'structural'`). Nothing decorative is drawn as a domain edge.

**Rendering — hand-built SVG, no graph library.** The P3.1 visual system is
SVG and is locked; a force/flowchart library would impose its own aesthetic and
its own layout and then have to be fought back to this one. Instead:

- `graph-model.js` — pure, DOM-free: layout, adjacency, neighbourhood, search,
  filters, focus/zoom maths. Tested directly by `test/graph-model.test.js`
  (the same file the browser loads, not a copy).
- `graph-view.js` — all DOM: one transform on a single `#viewport` group
  carries pan/zoom, so neither re-renders node DOM; strokes use
  `vector-effect="non-scaling-stroke"` and labels size as `1/zoom`, so both stay
  legible at any scale; hover/selection/filter only rewrite class attributes.
- The ambient memory lattice (~6.5k dots) is batched into **three `<path>`
  elements**, one per opacity tier — the P3.1 density at three DOM nodes instead
  of thousands. Whole field: ~560 SVG elements. Measured pan and zoom hold
  60 fps (16.7 ms median, 17.6 ms worst frame at 2048px).

**Layout.** Deterministic and orbital, not physics: workspace at the centre,
projects on the P3.1 project ring, and each project's captured context fanning
outward through the memory band inside that project's wedge. In P3.1 the wedge
was a synthetic cluster "sized by" the capture count; now the lit dots **are**
the captures, drawn over the ambient lattice that still carries the accepted
density. Same input ⇒ same positions, so nothing reshuffles on pan, filter or
reload.

**Interactions:** pan (pointer drag), zoom (wheel/pinch about the cursor, `+`
`-`, 0.35×–6×), hover (emphasis + HUD readout with real metadata), selection
(focus the node, highlight its edges, mute the rest, drive the inspector),
focus (fit the selection's neighbourhood), relationship highlighting,
local lexical search-to-node (**not** semantic retrieval — a later milestone),
type filters derived from the types actually present, expand/collapse per
project (view state only; the data is never touched), keyboard `/` `f` `0`
`+` `-` `Esc`.

**Context Inspector** shows the real persisted object: title, type, id,
created/updated, body, its captured context, and every real relationship with
verb, direction, provenance and confidence. Related rows traverse to the far
object *in the graph*, so one object keeps one identity across graph →
inspector → capture → API. Actions stay within what the API already supports:
traverse, focus, and capture into a real project.

**P3.2 decisions (small, documented):**
- `RelationshipRepository.forObject()` now also returns the anchors of objects
  whose home the queried object *is*. It previously under-reported a Project's
  incident edges, which made the inspector disagree with the graph about the
  same object. All P2.7 tests pass unchanged.
- The dev static server sends `cache-control: no-store`, so an edited asset is
  always the one under test.
- The dev seed gained a third project shared with Bob, more captured notes and
  three real relationship rows (one `private`). Bob seeing *exactly one* project
  is a stronger authorization demonstration than Bob seeing nothing.
- On viewports ≤720px the graph frames the real content on first load instead of
  the outer decorative orbits, and touch uses a **two-mode model** so the graph
  is never a dead-scroll region:
  - *not engaged* (the fitted view you scroll past) — `touch-action: pan-y`, so a
    vertical swipe scrolls the page normally. A horizontal-first drag belongs to
    the graph, and once owned it pans in both axes; the axis is decided once,
    past a 6px slop, from the press origin.
  - *engaged* (zoomed past the fitted scale) — `touch-action: none`, so one
    finger pans in 2D.
  Pinch always belongs to the graph (`pan-y` grants the browser no pinch-zoom),
  and pinching in is what engages; **Reset** returns to the page-scroll state.
  Verified with real CDP touch events: vertical swipe scrolls the page and
  leaves the transform untouched; horizontal swipe pans the graph and does not
  scroll; pinch zooms and engages; a vertical swipe while engaged pans the graph
  without scrolling; Reset disengages; tap still selects.
- Selection emphasis, the focus transition and a two-beat search-match pulse are
  the only added motion; all are disabled under `prefers-reduced-motion`.

Verified at 2048 / 1600 / 1140 / 390 with no horizontal overflow and a clean
console. Evidence: `docs/screenshots/p3.2/`.

## Deferred (documented, not built here)

Per P2.7 §15 / §16 — belongs to later milestones, not this slice:
relationship suggestions & candidates, suppressions, usage signals, ranking
weight sets, telemetry / G1–G4 gate events, the Assistant service and Context
API, semantic/vector retrieval, lexical *search* endpoints (the `object_fts`
index is built but not yet queried), Task objects and real `belongs_to` anchor
edges, `project_share` management UI, real authentication, production deployment.
