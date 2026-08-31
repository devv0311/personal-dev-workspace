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
| P3.1 — Static Visual Shell | `app/src/adapters/web/`, `Design_Dashboard_Aesthetic_Claude_Blueprint.md` | COMPLETED | 2026-08-29 | PR #13 → `main` |
| P3.2 — Interactive Second-Brain Graph | `app/src/application/context-graph.ts`, `app/src/adapters/web/graph-*.js` | COMPLETED | 2026-08-30 | PR #14 → `main` |
| P3.3 — Dashboard ↔ Graph Integration | `app/src/adapters/web/graph-model.js`, `app/src/adapters/web/app.js` | COMPLETED | 2026-08-30 | PR #15 → `main` |
| T3.1 — Visual Shell (blueprint-reconciled) | `app/src/adapters/web/` — token system, rails, Context Field framing, inspector relationship rows | COMPLETED | 2026-08-30 | PR #17 → `main` |

## Design Reconciliation Track

| Task | Deliverable | Status | Accepted | Merge |
|---|---|---|---|---|
| T2.1 — Blueprint Reconciliation | `Design_Dashboard_Aesthetic_Claude_Blueprint.md` (rewritten), `docs/reference-video-analysis.md` (evidence, unchanged) | AWAITING REVIEW | — | — |
| T2.2 — Implementation-Blocking Decision Review | `docs/PROGRESS.md` § *T2.2* (canonical); `Design_Dashboard_Aesthetic_Claude_Blueprint.md` §11 annotated | AWAITING REVIEW | — | — |

## Notes

- **Reference video analysis (evidence, not a milestone).** `docs/reference-video-analysis.md` records a frame-level analysis of the supplied reference video (`Reference.mp4`). It is authoritative **only** for what was observed in that reference and for the transferable design principles derived from it. It has no authority over product taxonomy, entities, or scope, and is not a specification. Method and limitations (no audio transcription; ~4 of 21 minutes contain reference UI) are stated in its §0.
- **T2.1 (Blueprint Reconciliation) — AWAITING REVIEW 2026-08-30.** Documentation only; **no application code, UI, graph, backend, schema, dependency, or stack decision was touched**. `Design_Dashboard_Aesthetic_Claude_Blueprint.md` was rewritten in place (same filename, so the three existing references from `app/README.md`, this file, and `app/src/adapters/web/styles.css` stay valid) as a reconciled visual and interaction specification. The prior revision had been written as an interpretation of the reference screens and had absorbed that product's taxonomy into our colour system, panel structure, graph layers, and acceptance checklist.
  - **Authority order made explicit** (§0): master blueprint → accepted P1/P2 design → this document → the reference analysis. A reference-derived idea may never override the product model; where they disagree the reference idea is discarded.
  - **Reference product semantics removed.** `Applications / Routines / Memory / Skills` is no longer our taxonomy; the graph root is the user's **Workspace** (a real entity), never an AI-configuration artefact; `Micro Apps`, `Departments`, `Hermes`, the `Skills Deck` and `Routines Monitor` panel requirements, the `Applications`/`Routines` graph orbits, the badge-ring and particle-core requirements, `Force / Circle / Hex / Rings` layout switching, physics sliders, and `Bake settings` are all retired. Every retired directive is listed with its reason in §12 so none is reinstated.
  - **Product model restored as authoritative.** Object classes are P2.1 §5/§7/§9 (Project, Task, Note, Decision, Idea, Resource, Checkpoint, plus Workspace and Inbox). Relationship semantics are P2.1 §8 and P2.2 §4–§5 — ten typed directional verbs, origin, four confidence states, provenance, and per-relationship visibility. Aggregate relationship counts are prohibited. P2.2's rule that **Weak relationships must not appear in primary context** is now a hard rendering rule.
  - **Encoding reframed onto our own axes**: shape encodes object class, hue encodes home Project — two orthogonal channels, neither carrying meaning alone. This replaces the reference-derived `--apps` / `--memory` / `--routines` colour semantics, under which every real object class currently renders undifferentiated.
  - **Capture, user-authored Connect, reason-giving, and provenance are named non-negotiables** (§2) with dedicated interaction sections (§6.7–§6.10, §5.8, §5.9). The reference contains none of these, and §3.4 records that its silence is not guidance.
  - **Motion budget defined as a budget, not a menu** (§7): nothing continuous moves except a justified focal effect; shimmer, decorative node pulses, ambient graph drift and animated data surfaces are prohibited; ambient/orbital rotation is **off by default**; reduced motion removes all continuous motion without information loss.
  - **Fabricated density prohibited** (§5.10): every node is a real object, every domain edge a real or genuinely computed relationship, and a sparse workspace looking sparse is correct behaviour. The `PREVIEW` / `OFFLINE` marking convention established in P3.1–P3.3 is preserved (§8.3).
  - **Cross-surface object identity** (established at P3.3) is recorded as a non-negotiable that must not regress.
  - **Eight open questions** recorded rather than answered (§11): per-Project hue at scale, a shape vocabulary for seven classes, whether more than one layout projection is needed, whether the Context Field is ever a separate surface, right-rail composition once only real capabilities are shown, how "possibly related" is surfaced, how reason-giving is presented, and where an assistant answer's grounding record lives.
  - **Five known specification-to-implementation deviations** recorded in §13 for a future visual task, not fixed here: reference taxonomy in the style tokens, the offline `APPLICATIONS`/`ROUTINES` orbits, ring rotation on by default, preview widgets inheriting reference structure, and unverified inspector relationship display. `app/README.md` is deliberately **not** amended — it is a truthful record of what was implemented.
  - No milestone was started, and P3.4 remains unaccepted on its feature branch.

- P2.3 closeout promoted all accepted Phase 1 and Phase 2 documentation to `main`; `develop` is kept in sync with `main`.
- P2.4 was accepted after a review pass; its review corrections are in commit `558022f`. It is an **investigation only** — the architecture decision is deliberately not made, and its open questions (§16, classified must-answer / validate / defer) are inputs to P2.5.
- P2.5 selected **Alternative A** — a relational-core modular monolith with first-class relationship edges, derived-only lexical indexes, a dedicated worker process, an isolated Assistant process with no datastore credentials, a `RetrievalProvider` seam, a transactional outbox, and 15 architectural invariants. Accepted after a hostile-but-fair architecture review; six MAJOR gaps closed pre-acceptance in commit `c48f04b` (selected architecture unchanged). Conditions on acceptance: lexical-only MVP retrieval is contingent on the G1–G4 quality gates being instrumented from the first slice (§13.4); the Assistant process boundary protects one property only (egress component cannot read the datastore); relationship-level visibility (R9a) and the A→C evolution path are preserved subject to the documented invariants.
- P2.6 selected the concrete stack — **TypeScript / Node.js** (one codebase for core + worker; separate TS Assistant service) on **PostgreSQL** as the single system of record (in-store FTS, recursive-CTE 2-hop assembly, `SKIP LOCKED` job claiming, transactional outbox, JSONB for mutable-type attributes); lexical retrieval only, no vector store; `docker compose` (PostgreSQL only) for local dev; 3 containers + PostgreSQL in 2 network zones for deployment. Accepted after a rigorous implementation-architecture review; **3 blocking defects + 6 material gaps** closed pre-acceptance in commit `79c5a45` (Task/Project capture anchoring, non-null creator ownership, dual-credential Context API, structural-vs-stored relationships, per-request `ResolvedScope`, per-hop visibility, `RetrievalProvider` scoped-result eligibility, execution-time worker scope, state-based outbox consumers, G1–G4 instrumentation, deterministic ranking, JSONB governance, failure matrix, per-invariant test mapping). Selected architecture and all 15 P2.5 invariants unchanged; no P2.5 reopening.
- P2.7 delivered the first real vertical slice (**Capture → Persist → Associate → Display**) under `app/`: TypeScript/Node core + worker, PostgreSQL system of record, one SQL migration, the single `VisibilityPolicy` (SQL fragment + `canSee` from one source, `filter → assemble → rank`, deny-by-default), first-class `relationship` edges with the synthesised `belongs_to` read model, transactional outbox with a state-based idempotent `fts-maintenance` worker consumer, and a minimal vanilla UI wired to the real API. Verified: `tsc --noEmit` clean; 27/27 tests passing from an empty database; end-to-end capture + restart persistence + authorization boundary confirmed manually. Accepted after a review pass (no defects; no code changed in review). One documented predicate refinement (`object.id ∈ sharedProjectIds` disjunct so a shared Project's own record is visible to the sharee) — refines, does not reopen, P2.6 §9.2. Local-dev deviation documented in `app/README.md`: a locally-installed PostgreSQL is used instead of `docker compose` (Docker unavailable in this environment) — no architectural change. The dashboard visual blueprint (`Design_Dashboard_Aesthetic_Claude_Blueprint.md`) is **not** implemented.
- Phase 2 design (P2.1–P2.6) plus the first implementation slice (P2.7) are on `main`.
- **P3.1 (Static Visual Shell) — ACCEPTED 2026-08-29** after final rendered-evidence review (screenshots at 2048 / 1600 / 1140 / 390 in `app/docs/screenshots/p3.1-final-evidence/`); merged to `main` via PR #13. It transforms `app/src/adapters/web/` into the dark HUD developer command center from `Design_Dashboard_Aesthetic_Claude_Blueprint.md` (now committed to the repo): three-column composition, semantic accent/glow system, a **static** SVG Context Field, left/right intelligence rails, and desktop → laptop-drawer → mobile-sequential responsive behavior. A **visual correction pass** followed the first review: the Context Field is now the dominant surface with a layered orbital structure — real project nodes on the outer ring, real captured-context nodes on the inner ring, `belongs_to` relationship lines, a particle core, HUD chrome (crosshair, corner brackets, layer labels, legend, readouts); the Context Inspector was reduced to a short secondary detail surface; rails are a true 24% through the primary desktop range (`clamp(272px, 24%, 420px)`) with the centre growing on ultrawide per blueprint §7; and horizontal-overflow bugs at ≤1180px and ≤720px were fixed. A **reference-driven correction pass** then followed (the project owner supplied the original RUBRIC reference screenshots as the primary visual authority): the shell was rebuilt to match that design language — **borderless** typographic rails on pure black divided by hairline rules (only Skills Deck items are cards), a compact centred header with orange-outline pill controls and a top orange hairline, and a much larger dominant Context Field drawn as concentric **APPLICATIONS / ROUTINES / MEMORY** orbital layers (cyan hex badges, amber nodes, a full-360° purple memory dot-field) with an orange `CONTEXT.CORE` and particle core. Real data drives it: one project node per project near the core, each forming a bright memory **cluster wedge** sized by its real capture count; selecting a node slides up a compact Context Inspector with real captures + the real capture form. Still a static SVG — no graph engine, no Three.js, no physics. Verified free of horizontal clipping at 2048 / 1600 / 1140 / 390. Only the three web files changed; no backend, domain, schema, migration, or test was touched. P2.7 preserved — `tsc --noEmit` clean, 27/27 tests still pass; capture → persist → associate → display verified end-to-end through the new UI. Small documented P3.1 decisions (CDN fonts with fallbacks, one reduced-motion-gated ring rotation, PREVIEW-tagged representative widgets) are in `app/README.md`. No later P3 milestone (graph engine, AI, search, integrations) has been started or authorized.
- **P3.2 (Interactive Second-Brain Graph) — ACCEPTED 2026-08-30**; merged to `main` via PR #14. It replaces P3.1's static SVG Context Field with a genuinely interactive graph while treating the accepted P3.1 visual system as locked — header, rails, typography, semantic accents, orbital geometry, memory density, glow and hex texture are unchanged; the only composition addition is the blueprint §14 graph control panel, drawn in the same language.
  - **Graph read model (server-side).** `GET /api/graph` returns the whole graph the current principal may see; `GET /api/objects/:id` returns one object with its edges for the inspector. Both are assembled in `application/context-graph.ts` from the same repositories, the same `ResolvedScope` and the same `VisibilityPolicy` fragment as every other read (INV-3) — there is deliberately **no graph-specific authorization path**. Nodes come from `ObjectRepository.listVisible`, edges from `RelationshipRepository.listVisible` (the whole-graph form of `forObject()`, composed from the identical SQL fragments); an assembly-time cross-check drops any edge whose endpoints are not both in the visible node set, and `stats` are counted from the filtered node set, so neither an edge nor a count can imply a node the principal cannot see.
  - **Real data, real relationships.** Nodes are real `object` rows keyed by their real ids; edges are stored `relationship` rows, the synthesised `belongs_to` anchor from `home_project_id`, and structural containment computed on read from `object.workspace_id` (P2.6 §8.3, labelled `origin: 'structural'`). Nothing decorative is drawn as a domain edge. The `APPLICATIONS` and `ROUTINES` orbits carry no domain data and remain an explicitly offline scaffold — dimmed, non-interactive, never selectable.
  - **Interactions.** Pan, zoom about the cursor (wheel/pinch, 0.35x-6x), hover with a HUD readout of real metadata, selection (focus the node, highlight its edges, mute the rest), focus-on-neighbourhood, relationship highlighting, local **lexical** search-to-node (not semantic retrieval), type filters derived from the types actually present, per-project expand/collapse as view state only, and keyboard `/ f 0 + - Esc`.
  - **Inspector integration.** Selection resolves to the real persisted object — title, type, id, timestamps, body, captured context, and every relationship with verb, direction, provenance and confidence. Related rows traverse back into the graph, so one object keeps one identity across graph → inspector → capture → API. Actions stay inside what the API already supports.
  - **Capture → graph update.** Capturing through the inspector persists a real note and the new node appears in the graph already anchored (19 → 20 nodes; readout, chips, counts and activity all follow).
  - **Authorization verified.** Alice 19 nodes / 21 edges; Bob 5 / 4 (one shared project and its three captures). As Bob: no Alice titles anywhere in the DOM; search for her terms returns 0 results while his own returns 1; direct `/api/objects/` requests for her project and her note both 404; stats count only what he can see; and re-enabling every client filter reveals nothing further. Client filtering is a view concern, never the security boundary.
  - **Rendering and performance.** Hand-built SVG, no graph library — the P3.1 visual system is SVG and locked, and a force/flowchart library would impose its own aesthetic and layout. `graph-model.js` is pure and DOM-free (layout, adjacency, neighbourhood, search, filters, focus/zoom maths); `graph-view.js` owns all DOM. One transform on a single `#viewport` group carries pan/zoom so no node DOM re-renders; strokes use `vector-effect="non-scaling-stroke"` and labels size as `1/zoom`; hover/selection/filter only rewrite class attributes. The ~6.5k-dot ambient memory lattice is batched into three `<path>` elements, one per opacity tier — P3.1's accepted density at three DOM nodes instead of thousands (~560 elements total). Measured pan and zoom hold 60 fps at 2048px (16.7 ms median, 17.6 ms worst frame). Layout is deterministic and orbital, not physics: in P3.1 each project's wedge was a synthetic cluster *sized by* its capture count; now the lit dots **are** the captures.
  - **Mobile touch.** A two-mode model scoped to ≤720px, so the graph is never a dead-scroll region: at the fitted scale `touch-action: pan-y` lets a vertical swipe scroll the page while a horizontal-first drag belongs to the graph (axis decided once, past a 6px slop); once zoomed past the fitted scale the surface becomes `touch-action: none` and one finger pans in 2D. Pinch always belongs to the graph, pinching in is what engages, and **Reset** returns to the page-scroll state. Verified with real CDP touch events.
  - **Three latent defects were found by driving the real UI and fixed**: `setPointerCapture` retargets the following `click` to the `<svg>`, so the node under the press is now recorded at `pointerdown`; the pan delta was measured from the press point rather than the previous move, compounding the translation; and the chip accent class `routines` collided with the right rail's `.routines` **table** rule (`width: 100%`), now scoped to `table.routines`. One P2.7 asymmetry was also corrected: `forObject()` synthesised only the queried object's own anchor, so it under-reported a Project's incident edges and the inspector disagreed with the graph about the same object — it is now symmetric, with all P2.7 tests passing unchanged.
  - **Verified:** `tsc --noEmit` clean; **46/46 tests pass** (27 P2.7 unchanged, 9 graph read-model, 10 graph interaction logic — the interaction logic is tested against the same `graph-model.js` the browser loads, not a copy). Rendered at 2048 / 1600 / 1140 / 390 with zero horizontal overflow, no clipped controls, working selection and inspector at every width, and a clean console. Visual evidence: `app/docs/screenshots/p3.2/` (16 screenshots covering default state, hover, project selection, capture selection with relationship highlighting, focus, pan/zoom, search results and search-focus, filtering, collapse-all, capture → connect, the Bob authorization boundary, and mobile selection).
  - **Small documented decisions** are in `app/README.md`: the dev static server sends `cache-control: no-store`; the dev seed gained a third project shared with Bob plus more captured notes and three real relationship rows (one `private`), because Bob seeing *exactly one* project is a stronger authorization demonstration than Bob seeing nothing; selection emphasis, the focus transition and a two-beat search-match pulse are the only added motion, all disabled under `prefers-reduced-motion`.
  - No later P3 milestone (AI, semantic retrieval, embeddings, integrations, routines execution) has been started or authorized.
- **P3.3 (Dashboard ↔ Graph Integration) — ACCEPTED 2026-08-30**; merged to `main` via PR #15. Connects the surrounding command-center rail widgets to the same underlying object the P3.2 graph and Context Inspector already hold, so a piece of context encountered anywhere in the shell leads to the same persisted object everywhere else — no widget maintains a competing identity.
  - **No backend or API change.** Every cross-surface interaction is built entirely from the already-fetched `/api/graph` and `/api/objects/:id` payloads, both already scoped by the same `VisibilityPolicy` as every other read — a rail widget can only ever reference an id the server already decided the current principal may see.
  - **Shared derivation**, added to the already-pure `graph-model.js` (ships verbatim to the browser): `pulseLinkTarget(node)` resolves the real project id the current selection belongs to (itself if a project, its `homeProjectId` if a capture, else null); `recentActivity(graph, node, detail)` resolves the real captured objects in that scope, most recent first, returning `{ items, total }` so a fixed-size display grid never distorts the reported count. Every id either returns was already present in the graph payload or a project's own already-filtered `children`, so feeding one back into `revealAndFocus()` can never surface an object the caller could not already see.
  - **What became interactive:** Project Pulse's header now links back to the real project the selection belongs to and re-focuses the graph on it when clicked (same `revealAndFocus` path as search and the inspector's own relationship rows); Project Pulse's "Context activity" dot grid — previously an anonymous count — now has one real captured object behind each lit dot, openable via click or `Enter`; the "Captures" metric reflects the scope implied by the current selection instead of always the global count.
  - **Classified and left untouched (legitimately unavailable, not a shortcut):** Attention (GitHub activity, decision-conflict detection and task tracking are all future-milestone capabilities — none of its three rows names a real object, so none was wired to selection); Session's "What's next" (no calendar/task backend); Project Pulse's "Open tasks"/"Blocked" (no `task` domain object is ever created by any capture path yet). All three keep their `PREVIEW` tag. One pre-existing cosmetic issue was found and fixed: two of Attention's static example strings (`api-gateway-rework`, `context-engine`) coincidentally matched real seeded project titles from an unrelated principal; renamed to non-colliding placeholders (`payment-service`, `auth-service`) so a screenshot of static preview content can never be misread as a cross-principal leak. Search already resolved graph node identity in P3.2 and was reused unchanged, with no second index and no semantic capability added.
  - **Verified:** `tsc --noEmit` clean; **51/51 tests** (46 from P2.7/P3.2 unchanged, 5 new unit tests for `pulseLinkTarget`/`recentActivity` covering project scope, home-project fallback, the global case, and that the display cap never distorts the reported total). Cross-surface browser verification against the running app: Project Pulse → Graph → Inspector (pan/zoom away, click the Pulse header, confirm the transform actually changed and the inspector still names the same project); Graph → Dashboard (select a capture, confirm Pulse relinks to its *home* project, not the capture itself); Capture → persist → Graph/Pulse update (capture a note, confirm Pulse's count and the activity grid both gain a dot, and that newest dot resolves to the exact new object); Activity → Context (a real activity dot opens the exact object it names; Attention rows confirmed still non-interactive); Bob (his Pulse links only to his one shared project, his activity dots are only his three captures, no Alice title appears anywhere in the dashboard DOM, and direct API probes for two of her objects still 404). Rendered at 2048 / 1600 / 1140 / 390 with zero horizontal overflow and a clean console at every viewport, including mobile (rails as a sequential stack, unchanged from P3.1/P3.2). Visual composition confirmed pixel-consistent with the accepted P3.2 evidence — orbital geometry, semantic ring colors, `CONTEXT.CORE`, hex background, header, rail treatment, Skills Deck and Routines all unchanged; the only content changes are the two renamed preview strings. Evidence: `app/docs/screenshots/p3.3/`.
  - No P3.4 or later milestone (semantic search, embeddings, AI assistant, integrations, routines execution) has been started or authorized.

---

## T2.2 — Implementation-Blocking Decision Review

**Review date:** 2026-08-30
**Mode:** analysis + documentation only. No application code, UI, graph, backend, schema, dependency, or technology decision was touched.
**Subject:** the eight open questions recorded at `Design_Dashboard_Aesthetic_Claude_Blueprint.md` §11 (T2.1).
**Purpose:** establish the smallest set of decisions required to safely begin **T3.1 — Visual Shell**. Questions that can be decided later without causing rework are left open.

### Scope assumption (stated, not invented)

**T3.1 is not defined in any project document.** No T-series roadmap exists beyond the task names the user has issued. This review therefore evaluates T3.1 as what its name states — a **visual shell** task: composition, design tokens, typography, structural division, rails, panel shells, states, and responsive behaviour, bringing the existing shell into conformance with the reconciled specification (§13 deviations 1–5).

Every classification below is conditional on that scope. **If T3.1 is later widened to include the Context Field's node rendering, the relationship/inference surfacing, or an AI surface, then Q2, Q3, Q6 and Q7 re-open and must be re-reviewed before that work starts.** Defining T3.1's scope is the user's decision, not this review's.

### Question numbering

The task instruction collapsed two numbers. Blueprint §11 numbering is canonical here:

| Instruction label | Blueprint §11 | Subject |
|---|---|---|
| Q1 | **Q1** | Per-Project hue at scale |
| Q2 | **Q2** | Shape vocabulary for seven object classes |
| Q3 (right rail) | **Q5** | Right-rail composition |
| Q3/Q4 (projections) | **Q3** | Alternative layout projections |
| Q4 | **Q4** | Is the Context Field ever a separate surface |
| Q6 | **Q6** | Surfacing "possibly related" (Weak relationships) |
| Q7 | **Q7** | Reason-giving presentation |
| Q8 | **Q8** | Receipt surface for assistant answers |

All eight §11 questions are reviewed. Nothing was added.

### Cross-check against the known deviations

The eight questions map cleanly onto the five specification-to-implementation deviations in §13, which are T3.1's actual workload. No deviation depends on an unreviewed question:

| §13 deviation | Governed by |
|---|---|
| 1 — reference taxonomy in style tokens (`--apps` / `--memory` / `--routines`) | **Q1** (partially blocking) |
| 2 — offline `APPLICATIONS` / `ROUTINES` orbits | Already settled by §5.11. No open question. |
| 3 — ambient ring rotation on by default | Already settled by §7.4. No open question. |
| 4 — preview widgets inheriting reference structure | **Q5** (partially blocking) |
| 5 — inspector relationship display unverified | **Q7** (partially blocking) |

---

### Q1 — Per-Project hue at scale

**1. Classification: PARTIALLY BLOCKING.**

**2. Why.** T3.1 must retire `--apps` / `--memory` / `--routines` (§13 deviation 1). Retiring them without deciding what replaces them would leave the shell with no accent system, and re-deriving one later would be rework across every token consumer. However, the *overflow* behaviour the question actually asks about — what happens past roughly 8–12 projects — only manifests when the Context Field renders many project-hued nodes. That is node-rendering work, not shell work, and no token changes when it is decided.

**3. Minimum decision required now.** T3.1 establishes the **palette structure only**, which §4.5, §4.11 and §5.4 already constrain:

- One action accent, doing only the three jobs in §4.5.
- Greyscale for the four-tier contrast ladder (§4.3).
- A bounded, named, token-defined categorical set **reserved for Project identity** — not for object class, not for the retired reference categories.
- No hue may be the sole carrier of any meaning (§4.13). Where the shell needs to indicate a Project, a **text label is sufficient and is the default**; hue is additive.

T3.1 must not reintroduce class-keyed or reference-keyed colour semantics, and must not hard-code colour values outside tokens.

**4. Deferred portion → a later Context Field task:** the exact palette values, the assignment rule, and the >N overflow behaviour (stable palette with a shared bucket / coarser axis / active-Project-only hue).

---

### Q2 — Shape vocabulary for seven object classes

**1. Classification: NON-BLOCKING.**

**2. Why.** §11 records that this blocks *node rendering*, which is Context Field work. The shell does not require it: wherever the shell must indicate an object's class — rail rows, inspector headers, search results — §4.13 already requires the state to be stated in words, so a **text type label** discharges the requirement completely. The shape channel is currently unused, so introducing shape later is additive rather than corrective. The real risk is the opposite one: if T3.1 invents a shape set now, a later Context Field task that revises it creates rework.

**3. Minimum decision required now.** None. One prohibition applies: **T3.1 must not invent a shape vocabulary.** Object class is carried by its product noun in text (Project, Task, Note, Decision, Idea, Resource, Checkpoint). If T3.1 renders the Context Field at all, nodes use a single uniform mark, with class carried by label on hover/selection.

**4. Deferred portion → a later Context Field task:** whether all seven classes (plus Workspace and Inbox) are distinguishable at node size, or whether a reduced shape set is used with the remainder distinguished only on inspection.

---

### Q5 — Right-rail composition

**1. Classification: PARTIALLY BLOCKING.**

**2. Why.** T3.1 must build the rail as structure, and §12 retired the Skills Deck and Routines Monitor as required panels — so without a minimum rule T3.1 has no basis for deciding what may occupy the rail, and the most likely failure is recreating the retired panels to avoid an empty region. The *structure* is safe to build now: §4.1 already fixes the rail's meaning ("what wants you"), and §4.11 requires the layout to survive re-labelling, so changing the rail's contents later does not disturb its structure.

**3. Minimum decision required now.** The specification already determines this; T3.1 must apply it rather than improvise:

- The rail is **structural**, defined by §4.1's direction-of-demand split. Its contents are not final.
- It may be populated **only** from capabilities that actually exist (accepted through P3.3: capture, projects and objects, first-class relationships, the graph read model, cross-surface object identity, lexical search-to-node) **or** from content carrying a visible `PREVIEW` / `OFFLINE` marker (§8.3).
- **The retired Skills Deck and Routines Monitor must not be recreated**, in their reference form or a renamed equivalent. No automation or skill object exists in the product model.
- **Sparse or empty rail regions are correct** (§5.10, §15). Adding widgets to fill space is prohibited.
- Preview strings must not collide with real data (§8.3).

**4. Deferred portion → a later task, once the capabilities it would surface are accepted:** the final composition of the rail, and retirement of the remaining preview widgets.

---

### Q3 — Alternative layout projections

**1. Classification: NON-BLOCKING.**

**2. Why.** A visual shell requires exactly one composition. Projection switching is a Context Field control, and §12 has already retired `Force / Circle / Hex / Rings`, the `VIEW` toggle, and the physics sliders. Adding a second projection later is additive and disturbs nothing, provided T3.1 does not build a switching control now.

**3. Minimum decision required now.** None. Two prohibitions apply, both already in §12 and §5.11: **T3.1 ships one deterministic layout and no layout-projection control, no physics control, and no `Bake settings`.** No control may imply behaviour the implementation does not support.

**4. Deferred portion → a later Context Field task:** whether a second projection is needed at all, and if so whether it answers "what belongs to what" or "what changed recently".

---

### Q4 — Is the Context Field ever a separate surface

**1. Classification: NON-BLOCKING.**

**2. Why.** This is not a blocker because the conservative option is already settled and is the one that preserves the non-negotiable. §2 item 2 makes cross-surface object identity binding, and P3.3 established it deliberately. A single surface is therefore what T3.1 builds regardless of how Q4 eventually resolves. Building one surface leaves a dedicated surface addable later; building two now would put the settled principle at risk. Resolving Q4 in this review would be resolving a future architecture question unnecessarily.

**3. Minimum decision required now.** None. Constraint: **T3.1 builds a single surface and preserves cross-surface object identity** — one object keeps one identity across the field, the inspector, the rails, search and the API, with no widget-private dataset. T3.1 must not preclude a later dedicated surface, but must not build one.

**4. Deferred portion → whenever deep graph exploration is actually scoped:** whether a dedicated full-screen Context Field place is justified, and how it would preserve object identity.

---

### Q6 — Surfacing "possibly related" (Weak relationships)

**1. Classification: NON-BLOCKING.**

**2. Why.** The question splits into a rule and an affordance. The **rule** — P2.2 §4, restated as a hard rendering rule at §5.3 — is already fully decided and immediately actionable: Weak relationships must not appear in the primary context view. Only the **on-demand affordance** is open, and that is relationship-surfacing work that presupposes relationship rendering the shell does not perform.

**3. Minimum decision required now.** None. Constraint: **T3.1 must not render Weak relationships anywhere in the primary view, and must not build the on-demand "possibly related" affordance.** Nothing in the shell may imply that a Weak link is a fact.

**4. Deferred portion → a later relationship-surfacing task:** the form of the on-demand affordance.

---

### Q7 — Reason-giving presentation

**1. Classification: PARTIALLY BLOCKING.**

**2. Why.** §11 notes this "determines how much room the inspector needs", and §13 deviation 5 puts the inspector's relationship display in T3.1's path. If T3.1 fixes the inspector as a short strip with aggregate or single-line relationship rows, adding per-relationship confidence marking and an explanation later requires re-architecting that surface. The *presentation form* — inline, on hover, in the inspector, or a dedicated surface — does not need deciding, and deciding it now would be designing the explanation system prematurely.

**3. Minimum decision required now.** T3.1 must leave room, structurally, for what §5.3 and §5.9 already require:

- Relationships are an **individually listed set**, never aggregate counts.
- Each row must be able to carry its **verb, direction, and confidence state as text**.
- Each row must have an **expandable slot** for provenance and contributing signals — the slot need not be populated by T3.1, but the layout must not preclude it.
- The inspector must be able to **grow**; it may not be a fixed-height region that cannot accommodate a relationship list of arbitrary length.

**4. Deferred portion → a later relationship/inference-surfacing task:** the actual presentation of contributing signals (inline / hover / inspector / dedicated surface), and the confirm–reject affordance for inferred links.

---

### Q8 — Receipt surface for assistant answers

**1. Classification: NON-BLOCKING.**

**2. Why.** §11 itself records this as "a product question, not a visual one". It has no bearing on the visual shell: no assistant surface exists in the accepted product, P3.4 remains unaccepted on a feature branch, and the shell renders nothing that would carry a grounding record.

**3. Minimum decision required now.** None. Constraint: **T3.1 must not build an assistant surface, an answer surface, or a receipt surface.**

**4. Deferred portion → the AI-layer milestone, when it is reviewed and accepted:** whether an answer's grounding record is transient in the answer or persisted as an addressable object.

---

### Decisions required before T3.1

Three, all of them minimum constraints derived from already-accepted documentation. None is a new product decision, and none changes the taxonomy, information model, or architecture.

1. **Q1 — palette structure.** One action accent + greyscale ladder + a bounded, token-named categorical set reserved for Project identity. No class-keyed or reference-keyed colour semantics. Hue never the sole carrier.
2. **Q5 — rail rule.** The rail is structural; populate only from accepted capabilities or visibly `PREVIEW`/`OFFLINE`-marked content; do not recreate the retired Skills Deck or Routines Monitor; sparse regions are correct.
3. **Q7 — inspector shape.** Relationships as an individually listed, growable set, each row able to carry verb, direction and confidence state as text, with an expandable slot for provenance and signals.

### Deferred questions

| Question | Deferred to |
|---|---|
| Q1 — palette values, assignment rule, >N overflow | a later Context Field task |
| Q2 — shape vocabulary for seven classes | a later Context Field task |
| Q3 — whether a second layout projection is needed | a later Context Field task |
| Q4 — dedicated Context Field surface | whenever deep graph exploration is scoped |
| Q5 — final rail composition, preview retirement | a later task, once the capabilities exist |
| Q6 — "possibly related" affordance | a later relationship-surfacing task |
| Q7 — presentation of contributing signals | a later relationship/inference-surfacing task |
| Q8 — where a grounding record lives | the AI-layer milestone, when accepted |

Blueprint §11 is annotated with these outcomes. It remains the canonical location for the questions themselves; this section is the canonical record of their classification.

### Constraints T3.1 must honour

Consolidated. Items marked **[settled]** were already binding before this review and are restated because they govern T3.1's known deviations.

**Colour and tokens**
1. Retire `--apps`, `--memory`, `--routines`. Do not replace them with any class-keyed or reference-keyed scheme. *(Q1; §13 deviation 1)*
2. One action accent, three jobs only. Bounded categorical set reserved for Project identity. All values token-defined; none hard-coded. **[settled — §4.5, §4.11]**
3. No hue, and no colour, may be the sole carrier of a meaning. **[settled — §4.13]**

**Context Field**
4. Do not invent a shape vocabulary. Class is carried in text; nodes use a uniform mark if rendered at all. *(Q2)*
5. One deterministic layout. No projection control, no physics control, no `Bake settings`. *(Q3; §12)*
6. Single surface. Cross-surface object identity preserved; no widget-private dataset. *(Q4; §2 item 2)*
7. Remove the offline `APPLICATIONS` / `ROUTINES` orbits rather than dimming them. **[settled — §5.11; §13 deviation 2]**
8. Every node a real object; every domain edge a real or genuinely computed relationship. No fabricated density; sparse looks sparse. **[settled — §5.10]**
9. Weak relationships absent from the primary view; no on-demand affordance built. *(Q6; §5.3)*

**Rails and panels**
10. Rail structure per §4.1's direction-of-demand split; contents only from accepted capabilities or `PREVIEW`/`OFFLINE`-marked content; retired panels not recreated; empty regions acceptable. *(Q5; §13 deviation 4)*
11. Preview strings must not collide with real data. **[settled — §8.3]**

**Inspector**
12. Relationships individually listed and growable; each row carries verb, direction and confidence state as text and has an expandable slot for provenance and signals. Aggregate counts prohibited. *(Q7; §5.3, §13 deviation 5)*

**Motion**
13. Ambient/orbital rotation off by default. No shimmer, decorative node pulses, ambient drift, or animated data surfaces. Reduced motion removes all continuous motion without information loss. **[settled — §7; §13 deviation 3]**

**Out of scope for T3.1**
14. No assistant, answer, or receipt surface. *(Q8)*
15. No new product entity, workflow, or capability. Capture, user-authored Connect, reason-giving and provenance remain structurally accommodated. **[settled — §2, §15]**

### T3.1 Readiness

**READY** — T3.1 can begin without resolving any further open question, subject to the fifteen constraints listed above under **Constraints T3.1 must honour**, of which three carry the minimum decisions this review made (Q1 palette structure, Q5 rail rule, Q7 inspector shape) and the remainder restate already-settled specification.

Two conditions attach:

- **Scope.** This readiness holds for T3.1 as a *visual shell* task, as assumed above. If T3.1 is scoped to include Context Field node rendering, relationship/inference surfacing, or an AI surface, Q2, Q3, Q6 and Q7 must be re-reviewed before that portion begins.
- **Sequencing.** T2.1 remains AWAITING REVIEW. T3.1 should not begin until T2.1 and this review are accepted by the user.

---

## T3.2 — Agentic Command Centre + Ring-Based Second Brain

**Status:** IMPLEMENTED — awaiting review. Not merged, not accepted.
**Branch:** `feature/t3.2-agentic-command-center` (cut from `feature/t3.1-reference-ui` HEAD `6711812`, carrying all prior uncommitted work forward).
**Date:** 2026-08-31.
**Acceptance gate:** `docs/visual-qa/T3.2-agentic-command-center-checklist.md`.
**Evidence:** `app/docs/screenshots/t3.2-command-center/` (13 captures, four viewports, six states).

### What the milestone changed

The command centre became two **places** over one session:

```
OS COMMAND VIEW ──click core──▶ SECOND BRAIN ──← back / Esc──▶ OS COMMAND VIEW
```

- **OS view** — a ring of the workspace's six real capabilities around a core
  that carries the DEVWORKSPACE identity mark and the workspace's real size,
  inside a non-data atmosphere (enclosure, guides, ticks, boundary, markers,
  particle mass). New module `command-ring.js`.
- **Second Brain** — the existing context graph, re-projected as concentric
  rings (core → capabilities → projects → context rings → system boundary) over
  the *same* payload. New pure functions `layoutSecondBrain` / `brainRings` /
  `ringPoints` / `semanticClassOf` in `graph-model.js`; ring structure and the
  inner capability ring rendered by `graph-view.js` under `layout: 'brain'`.
- **Rails** reordered to the reference: left = Micro Apps → Calendar + Time
  (IST) → Project Pulse → Workspace Members; right = Email → Skills Deck →
  Routines.

### Decisions this milestone records

1. **Ring colour is semantic, and never the only channel.** Orange = core and
   capabilities, cyan = projects, purple = captured context, amber = tasks. Each
   class is also stated in text on the node, on its ring annotation and in the
   inspector. This *extends* §4.13 rather than reopening it; the T3.1 per-project
   identity hue is superseded on the map by the class hue.
2. **Capabilities are drawn in the ring system but are not graph objects.** They
   carry no id, never enter the index, never appear in search and never open the
   inspector. Activating one runs the real capability. This keeps "every node is
   a real object" (§5.10) intact while satisfying the inner-ring requirement.
3. **Email and Routines are composition, not data.** Both surfaces are required
   by the reference composition and neither has a backing system. They render in
   an explicitly stated `NOT CONNECTED` / `OFFLINE` state with empty values and a
   sentence naming the absence. No message, sender, timestamp, schedule or run
   history is fabricated.
4. **The development stub is called a development stub.** The T3.1 review
   rejected `FAKE · DETERMINISTIC-FAKE-1` on the Skills cards. The value is
   genuinely reported by the assistant's `/healthz`, but printing it in a model
   slot dresses a stub up as a model, so the shell names it `dev stub` — on the
   cards and in the assistant panel's own status and provider lines. A real
   provider is named with the model it actually reports. No effort tier is shown
   anywhere, because the service exposes none.
5. **The fabricated Project Pulse figures are gone.** The hardcoded "7 open
   tasks / 3 blocked" is replaced by Projects / Captures / Links, all derived
   from the loaded graph.
6. **People are membership only.** `Dev`, `Sanchit`, `Shourya`, `Aatika` and
   `Ananya` are seeded as real principals with real workspace memberships and
   surfaced through a new scoped read. A principal row plus a membership is the
   whole of what the model records about a person, so it is the whole that is
   shown: no e-mail, avatar, role, external account, contribution or activity.
7. **The Second Brain takes the whole canvas.** Entering it withdraws the rails.
   It is a change of location with a named exit, not a panel beside them.

### Backend touched (minimal, and only to serve §13)

`MemberRepository` port + `member-repository.pg.ts` adapter + container wiring +
`GET /api/workspace/members` (scoped like every other read; two columns) and the
five seeded group members in `src/seed.ts`. No schema change. Nothing else in
the backend was altered.

### Verification

- `npm test` — **105 / 105 pass** (96 pre-existing, 9 new ring-system tests).
- `npx tsc --noEmit` — clean.
- Browser: no console errors at 2048×1600, 1600×900, 1140×860 or 390×844.
- No horizontal overflow at any of those widths.
- IST clock verified ticking every second with a meridiem, `UTC+05:30`.
- Capture, Connect, grounded `/summarize`, spatial search, selection reveal,
  inspector provenance and cross-surface object identity all verified intact.

### Open

- Email and Routines remain preview surfaces until a mail integration and a
  scheduler exist.
- The header's search and Second-Brain controls are hidden below 720 px; both
  stay reachable from Micro Apps, and `/` still opens search.
