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

## Deferred (documented, not built here)

Per P2.7 §15 / §16 — belongs to later milestones, not this slice:
relationship suggestions & candidates, suppressions, usage signals, ranking
weight sets, telemetry / G1–G4 gate events, the Assistant service and Context
API, semantic/vector retrieval, lexical *search* endpoints (the `object_fts`
index is built but not yet queried), Task objects and real `belongs_to` anchor
edges, `project_share` management UI, real authentication, production deployment.
