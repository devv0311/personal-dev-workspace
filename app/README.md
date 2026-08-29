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

`src/adapters/web/` is the dark HUD **developer command center** described in
`Design_Dashboard_Aesthetic_Claude_Blueprint.md` (the authoritative visual spec):

- Near-black canvas, thin structural borders, semantic accent system
  (orange action · cyan apps · purple memory · amber routines · red blocker),
  three-level glow, technical/HUD typography, uppercase tracked labels.
- Three-column composition — left rail (Micro Tools, Developer Activity,
  Project Pulse) · centre (Context Field + Context Inspector) · right rail
  (Attention, Skills Deck, Routines). Rails are a true **24%** through the
  primary desktop range (`--rail-w: clamp(272px, 24%, 420px)`); on genuine
  ultrawide the cap lets the centre grow into an immersive command centre
  (Design blueprint §7).
- Central **Context Field** is a **static SVG**, deliberately the dominant
  surface: layered orbital rings + cardinal ticks, a crosshair, semantic
  layer labels (`PROJECTS / CONTEXT / MEMORY`), a static particle core with a
  few network links, HUD corner brackets + readouts + a node-type legend.
  **Real data:** one node per project on the outer ring, one node per that
  project's captured context on the inner ring, with `belongs_to`
  relationship lines between them. Selecting a project node loads its real
  captured context, lights its edges, and enables the real capture form; a
  new capture appears in the field immediately.
  **No graph engine, no Three.js, no physics** (a later milestone).
- The **Context Inspector** is a secondary detail surface — short
  (`clamp(176px, 26vh, 300px)`), quieter, below the field.
- Responsive: desktop command centre → ≤1180px rails become Esc-dismissable
  overlay drawers (☰ in the header) → ≤720px sequential stack (field +
  capture → attention → tools/pulse); verified free of horizontal overflow
  at 2048 / 1600 / 1100 / 390.

**P3.1 decisions (small, documented):**
- Fonts loaded from Google Fonts (Inter + JetBrains Mono) with full system
  fallback stacks — degrades cleanly offline. Single `<link>`, no build step.
- One ambient effect: a ~220s primary-ring rotation, disabled under
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
