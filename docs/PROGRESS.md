# Project Progress

Authoritative record of milestone status. Sequencing and acceptance are controlled by the user; a milestone is COMPLETED only when the user has explicitly accepted it.

Stable branch: `main`. Integration branch: `develop`.

## Phase 1 — Define the Core Problem

| Milestone | Deliverable | Status | Accepted | Merge |
|---|---|---|---|---|
| P1.1 — Problem Definition | `docs/phase-1/P1.1-problem-definition.md` | COMPLETED | 2026-08-29 | PR #1 → `develop` |
| P1.2 — Individual + Small-Team Scope | `docs/phase-1/P1.2-individual-small-team-scope.md` | COMPLETED | 2026-08-29 | PR #2 → `develop` |

## Phase 2 — Design the Core System

| Milestone | Deliverable | Status | Accepted | Merge |
|---|---|---|---|---|
| P2.1 — Personal Developer Workspace | `docs/phase-2/P2.1-personal-developer-workspace.md` | COMPLETED | 2026-08-29 | PR #3 → `develop` |
| P2.2 — Context Engine | `docs/phase-2/P2.2-context-engine.md` | COMPLETED | 2026-08-29 | PR #4 → `develop` |
| P2.3 — AI Assistant | `docs/phase-2/P2.3-ai-assistant.md` | COMPLETED | 2026-08-29 | PR #5 → `main` (first promotion to stable) |
| P2.4 — Technical Architecture Investigation | `docs/phase-2/P2.4-architecture-investigation.md` | COMPLETED | 2026-08-29 | PR #6 → `main` |
| P2.5 — Architecture Decision | `docs/phase-2/P2.5-architecture-decision.md` | COMPLETED | 2026-08-29 | PR #7 → `main` |
| P2.6 — Implementation Architecture / Technical Foundation | `docs/phase-2/P2.6-implementation-architecture.md` | COMPLETED | 2026-08-29 | PR #9 → `main` |
| P2.7 — First Implementation Slice | `app/` (code) | COMPLETED | 2026-08-29 | PR #11 → `main` |

## Phase 3 — Build the MVP

| Milestone | Deliverable | Status | Accepted | Merge |
|---|---|---|---|---|
| P3.1 — Static Visual Shell | `app/src/adapters/web/`, `Design_Dashboard_Aesthetic_Claude_Blueprint.md` | IN REVIEW | — | branch `feature/p3.1-static-visual-shell` (not merged) |

## Notes

- P2.3 closeout promoted all accepted Phase 1 and Phase 2 documentation to `main`; `develop` is kept in sync with `main`.
- P2.4 was accepted after a review pass; its review corrections are in commit `558022f`. It is an **investigation only** — the architecture decision is deliberately not made, and its open questions (§16, classified must-answer / validate / defer) are inputs to P2.5.
- P2.5 selected **Alternative A** — a relational-core modular monolith with first-class relationship edges, derived-only lexical indexes, a dedicated worker process, an isolated Assistant process with no datastore credentials, a `RetrievalProvider` seam, a transactional outbox, and 15 architectural invariants. Accepted after a hostile-but-fair architecture review; six MAJOR gaps closed pre-acceptance in commit `c48f04b` (selected architecture unchanged). Conditions on acceptance: lexical-only MVP retrieval is contingent on the G1–G4 quality gates being instrumented from the first slice (§13.4); the Assistant process boundary protects one property only (egress component cannot read the datastore); relationship-level visibility (R9a) and the A→C evolution path are preserved subject to the documented invariants.
- P2.6 selected the concrete stack — **TypeScript / Node.js** (one codebase for core + worker; separate TS Assistant service) on **PostgreSQL** as the single system of record (in-store FTS, recursive-CTE 2-hop assembly, `SKIP LOCKED` job claiming, transactional outbox, JSONB for mutable-type attributes); lexical retrieval only, no vector store; `docker compose` (PostgreSQL only) for local dev; 3 containers + PostgreSQL in 2 network zones for deployment. Accepted after a rigorous implementation-architecture review; **3 blocking defects + 6 material gaps** closed pre-acceptance in commit `79c5a45` (Task/Project capture anchoring, non-null creator ownership, dual-credential Context API, structural-vs-stored relationships, per-request `ResolvedScope`, per-hop visibility, `RetrievalProvider` scoped-result eligibility, execution-time worker scope, state-based outbox consumers, G1–G4 instrumentation, deterministic ranking, JSONB governance, failure matrix, per-invariant test mapping). Selected architecture and all 15 P2.5 invariants unchanged; no P2.5 reopening.
- P2.7 delivered the first real vertical slice (**Capture → Persist → Associate → Display**) under `app/`: TypeScript/Node core + worker, PostgreSQL system of record, one SQL migration, the single `VisibilityPolicy` (SQL fragment + `canSee` from one source, `filter → assemble → rank`, deny-by-default), first-class `relationship` edges with the synthesised `belongs_to` read model, transactional outbox with a state-based idempotent `fts-maintenance` worker consumer, and a minimal vanilla UI wired to the real API. Verified: `tsc --noEmit` clean; 27/27 tests passing from an empty database; end-to-end capture + restart persistence + authorization boundary confirmed manually. Accepted after a review pass (no defects; no code changed in review). One documented predicate refinement (`object.id ∈ sharedProjectIds` disjunct so a shared Project's own record is visible to the sharee) — refines, does not reopen, P2.6 §9.2. Local-dev deviation documented in `app/README.md`: a locally-installed PostgreSQL is used instead of `docker compose` (Docker unavailable in this environment) — no architectural change. The dashboard visual blueprint (`Design_Dashboard_Aesthetic_Claude_Blueprint.md`) is **not** implemented.
- Phase 2 design (P2.1–P2.6) plus the first implementation slice (P2.7) are on `main`.
- **P3.1 (Static Visual Shell)** is implemented on `feature/p3.1-static-visual-shell` and **awaiting visual review / explicit acceptance** — not merged. It transforms `app/src/adapters/web/` into the dark HUD developer command center from `Design_Dashboard_Aesthetic_Claude_Blueprint.md` (now committed to the repo): three-column composition, semantic accent/glow system, a **static** SVG Context Field, left/right intelligence rails, and desktop → laptop-drawer → mobile-sequential responsive behavior. A **visual correction pass** followed the first review: the Context Field is now the dominant surface with a layered orbital structure — real project nodes on the outer ring, real captured-context nodes on the inner ring, `belongs_to` relationship lines, a particle core, HUD chrome (crosshair, corner brackets, layer labels, legend, readouts); the Context Inspector was reduced to a short secondary detail surface; rails are a true 24% through the primary desktop range (`clamp(272px, 24%, 420px)`) with the centre growing on ultrawide per blueprint §7; and horizontal-overflow bugs at ≤1180px and ≤720px were fixed. Verified free of horizontal clipping at 2048 / 1600 / 1100 / 390. Only the three web files changed; no backend, domain, schema, migration, or test was touched. P2.7 preserved — `tsc --noEmit` clean, 27/27 tests still pass; capture → persist → associate → display verified end-to-end through the new UI (a new capture appears as a field node immediately). Small documented P3.1 decisions (CDN fonts with fallbacks, one reduced-motion-gated ring rotation, PREVIEW-tagged representative widgets) are in `app/README.md`. No later P3 milestone (graph engine, AI, search, integrations) has been started or authorized.
