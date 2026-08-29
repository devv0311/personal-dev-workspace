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

## Deferred (documented, not built here)

Per P2.7 §15 / §16 — belongs to later milestones, not this slice:
relationship suggestions & candidates, suppressions, usage signals, ranking
weight sets, telemetry / G1–G4 gate events, the Assistant service and Context
API, semantic/vector retrieval, lexical *search* endpoints (the `object_fts`
index is built but not yet queried), Task objects and real `belongs_to` anchor
edges, `project_share` management UI, real authentication, production deployment.
