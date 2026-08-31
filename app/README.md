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

# 7. start the processes (separate terminals)
npm run dev:core              # http://localhost:4177
npm run dev:worker
npm run dev:assistant   # P3.4 — Zone B; runs on the deterministic fake unless
                        # ANTHROPIC_API_KEY is set. Holds no DB credential.            # drains the transactional outbox

# 8. tests  (uses devworkspace_test; drops & recreates its schema each run)
npm test

# 9. type check
npm run typecheck
```

Open <http://localhost:4177>. Use the principal switcher (top right). Every
option is a **real workspace member** — the demo principals `Alice` and `Bob`
were removed at T3.3.2, and there is no client-side fallback list:

- **Sanchit** is the workspace's primary member and owns the seeded projects.
- **Shourya** is a member with exactly **one** project share — everything else
  is invisible to them (deny-by-default), which is what makes the authorization
  boundary demonstrable without an invented user.
- **Dev**, **Aatika**, **Ananya** are members with no shares.

The identity shown in the header is answered by the server (`GET /api/me`) from
the principal row the presented credential resolved to — the client never names
a user it has not been told about.

## What is real vs. mocked

| Real | Mocked / dev-only |
|---|---|
| Node HTTP application, worker process | — |
| PostgreSQL persistence, migrations, transactions | — |
| `VisibilityPolicy` authorization (SQL fragment + `canSee` from one source) | — |
| First-class `relationship` edges + synthesised `belongs_to` read model | — |
| Transactional outbox + state-based idempotent worker consumer | — |
| Capture → persist → associate → display workflow | — |
| **GitHub repository activity** — read live from the REST API per request (T3.3.1). No activity is seeded, cached in the page or replayed from a fixture. | — |
| **Background execution records** — real outbox-worker outcomes with real timestamps, scoped by the same policy as every other read (T3.3.4). | — |
| — | **Authentication** — a `Authorization: Dev <principalId>` header maps to a seeded principal (`src/adapters/http/auth.ts`). This is **not** the final auth architecture (P2.5 §22 Q6). It exists only to exercise the authorization boundary. |
| — | Seeded projects and notes, so the map is immediately non-empty. These are ordinary rows written through the real schema, not a display-only dataset. |
| — | **Email** — no mail provider, connector or credential exists anywhere in the runtime. The surface renders `Not connected` with no count, message or timestamp (T3.3.3). |

## External activity (T3.3.1)

GitHub supplies **activity**. It is never the system of record for a
DEVWORKSPACE object, and there is no import, sync or reconciliation path in the
codebase — `readExternalActivity` reads, and writes nothing.

- **Seam.** `ports/external-activity.ts` → `adapters/external/github.ts`. One
  provider instance per process, so its TTL cache and in-flight de-duplication
  are shared across requests.
- **Route.** `GET /api/external/github`, behind the same authenticated-scope
  gate as every other `/api/` read.
- **The join.** An internal object may record `attributes.externalRef`
  (e.g. `github:repository:devv0311/personal-dev-workspace`). The seed anchors
  one real Project to this repository, and that anchor is the *only* GitHub-
  related row ever persisted. Anchors are resolved through
  `listVisibleByExternalRef`, which composes the ordinary `VisibilityPolicy`
  fragment — so a public repository can never become a side channel into a
  project the caller may not see.
- **Honesty rules, enforced in code.** A total is reported only when the
  response proves it exact (no `rel="next"`); a section that fails comes back
  `{ ok: false, error }` and is rendered as that reason rather than as an empty
  list; a failed refetch keeps the previous snapshot's `fetchedAt` and marks it
  `stale`; `open_issues_count` is carried as `openIssuesAndPullRequests`
  because GitHub counts PRs in it; the token never appears in a response.
- **Credential.** `GITHUB_TOKEN` is optional. Anonymous reads work for a public
  repository at a lower rate limit, and the UI states which mode is in use.

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

## Dashboard ↔ graph integration (P3.3)

P3.1/P3.2 gave the command center a real interactive graph; the surrounding
rail widgets still read from a mix of real data and representative preview
content, computed independently of each other. P3.3 does not add a widget or
touch the visual system — it makes the existing widgets **projections of the
one object the graph and inspector already hold**, so a piece of context
encountered anywhere in the shell leads to the same underlying object
everywhere else.

**No backend or API change was needed.** Every cross-surface interaction is
built entirely from the `/api/graph` and `/api/objects/:id` payloads the
client already fetches — both already scoped by the same `VisibilityPolicy`
as everything else. Reusing them, rather than adding a widget-specific
endpoint, is what keeps the authorization boundary singular: a rail widget
can only ever reference an id the server already decided this principal may
see.

**The shared derivation.** `graph-model.js` (already pure, DOM-free, and
shipped verbatim to the browser) gained two functions:
- `pulseLinkTarget(node)` — the real project id the current selection belongs
  to: itself, if a project is selected; its `homeProjectId`, if a capture is;
  `null` otherwise. One function, used everywhere a widget needs to know
  "which project is this."
- `recentActivity(graph, node, detail)` — the real captured objects relevant
  to that scope, most recent first: a project's own children when a project
  is selected, its home project's siblings when one of its captures is, and
  every capture in the graph when nothing ties the selection to one project.
  Returns `{ items, total }` — `items` capped for the fixed-size dot grid,
  `total` uncapped for the numeric metric, so a project with more captures
  than the grid can show still reports its true count.

Every id either function returns was already present in `state.graph.nodes`
(the whole-graph payload) or in a project's own already-filtered `children`
(P3.2's `inspectObject`) — so feeding one back into `view.revealAndFocus()`
can never resolve to an object the caller could not already see, and there is
no second, competing place that "knows" what a project or a capture is.

**What became interactive, using that derivation:**
- **Project Pulse's header** now links back to the real project the current
  selection belongs to (an orange hover state signals it, matching the
  existing interactive-element language). Clicking it re-focuses the graph on
  that same project — useful after panning or zooming away — without
  re-deriving or re-fetching anything; it calls the same `revealAndFocus`
  every other surface uses.
- **Project Pulse's "Context activity" dot grid** — previously a plain count
  of anonymous filled circles — now has one real captured object behind each
  lit dot (title on hover, `Enter`/click opens it in the graph). This is the
  blueprint's "Developer Activity" concept (§10.2), realised through the
  widget that already existed rather than a new one: the accepted visual
  language (a dot grid) is unchanged, the dots just stopped being anonymous.
- **The metric shown for "Captures"** now reflects the scope implied by the
  selection (a project's own total, or its parent's, or the workspace's)
  instead of always the global count.

**What deliberately did not change — classification.** Per the requirement
that preview content not be removed just to look more finished:
- **Attention** (right rail) stays static preview, unlinked, with its
  `PREVIEW` tag unchanged. None of its three rows correspond to a real
  persisted object — GitHub activity, decision-conflict detection and task
  tracking are all future-milestone capabilities this slice does not build
  (classification **C**, §6/§18) — so none was wired to selection, per
  "an attention item must have an identifiable underlying object when it
  claims to represent one." Two of its static example strings (`api-gateway-
  rework`, `context-engine`) coincidentally matched real seeded project
  titles from an unrelated principal; renamed to non-colliding placeholders
  (`payment-service`, `auth-service` — the first is the blueprint's own
  example) so a screenshot of this preview content can never be misread as a
  cross-principal leak.
- **Session's "What's next"** stays static preview — there is no calendar or
  task backend to derive it from (classification C); unchanged.
- **Project Pulse's "Open tasks" / "Blocked"** stay hardcoded — no `task`
  domain object is ever created by any capture path yet, so there is nothing
  real to compute them from (classification C); the section keeps its
  `PREVIEW` tag for exactly this reason, alongside the parts of it that are
  now real or interactive.
- **Search** already resolved graph node identity in P3.2
  (`searchNodes(state.graph, …)` → `view.revealAndFocus(id)`); P3.3 added no
  second index and no semantic capability, only confirmed the reuse.

**Verified:** `tsc --noEmit` clean; **51/51 tests** (46 from P2.7/P3.2
unchanged, 5 new — `pulseLinkTarget`/`recentActivity` unit tests covering
project scope, home-project fallback, the global case, and that the display
cap never distorts the reported total). Cross-surface browser verification:
Project Pulse → Graph (select a project, pan/zoom away, click the Pulse
header, confirm the transform actually changed and the inspector still names
the same project); Graph → Dashboard (select a capture, confirm Pulse relinks
to its *home* project, not the capture itself); Developer Activity → Context
(click a real activity dot, confirm the inspector opens that exact object);
Capture → Connect (capture a note, confirm Pulse's count and the activity
grid both gain a dot, and that dot resolves to the new object); Bob
(identical flows — his Pulse links only to his one shared project, his
activity dots are only his three captures, no Alice title appears in the
dashboard DOM, and a direct API probe for one of her objects still 404s).
Rendered at 2048 / 1600 / 1140 / 390 with no overflow; visual composition is
byte-for-byte the same as P3.2 except the two renamed preview strings.
Evidence: `docs/screenshots/p3.3/`.

## AI layer (P3.4)

The first AI layer over the persisted context: **ask a question → retrieve real
context → grounded answer → visible provenance → navigate to the source object**,
plus summarization and task extraction on the same pipeline.

The architecture was **not designed here** — P2.3/P2.5/P2.6 already specified it
(trust chain, Context API, `RetrievalProvider` seam, `LLMProvider` port, no
automatic mutations). P3.4 implements it. Decisions and their rationale:
`docs/phase-3/P3.4-ai-layer-decisions.md`.

### The trust chain, as built

```
User  →  Assistant (Zone B, NO datastore credential)  →  Context API  →  Context Engine (trusted)  →  PostgreSQL
             untrusted generator                            two credentials      the single VisibilityPolicy
```

- **The assistant has no database path.** Not by convention — `test/assistant-boundary.test.ts`
  walks its real module graph from the entry point and fails if anything in it
  imports `pg`, reaches `adapters/persistence`, or touches the pool. It also
  asserts the only core URL it ever calls is `/ctx/context-set`.
- **Two credentials on the Context API** (P2.6 §14.1): a *service token*
  authenticates the assistant as a caller and conveys no identity; the *end-user
  credential* is relayed verbatim and validated by the core, which derives the
  principal from it alone. Service-token-only is rejected; a principal in the
  body is ignored. Both tested.
- **The assistant cannot write.** Task creation goes back through the core's
  ordinary authenticated write path, initiated by the user and attributed to the
  user (INV-8).

### Retrieval — reusing what already existed

`object_fts` has been maintained by the outbox worker since P2.7 and had **never
been read**. It now has its first consumer, behind the `RetrievalProvider` seam.

There is **no vector store and no embedding model**: P2.5 selected lexical-only
MVP retrieval with this seam as the upgrade path. Semantic behaviour comes from
*query understanding* (question → intent + retrieval terms) ahead of retrieval.
The port is storage-neutral by construction, and a second implementation
(`InMemoryRetrievalProvider`) is kept green so the seam cannot rot — it enforces
the same visibility rule through `canSee` rather than SQL, which is what proves
"the provider pre-restricts to the scope" is a property of the *contract*.

One defect found by running the real system: `websearch_to_tsquery` ANDs bare
terms, so "why did we choose token bucket?" matched nothing and the answer fell
back to recency — confidently, about the wrong note. Terms are now OR-ed with
`ts_rank` discriminating.

### Grounding and provenance — the model is untrusted

Everything the model returns is re-validated against the evidence actually
supplied:

| Model does | System does |
|---|---|
| cites a ref not in the evidence | citation is **dropped** — a hallucinated citation cannot be displayed |
| proposes a task from an invented source | text kept, **attribution removed** — no false provenance |
| answers with evidence but cites nothing | marked **ungrounded** in the UI, not presented as fact |
| returns prose instead of JSON | treated as a **provider failure**, not an answer |
| context retrieval fails | turn **stops** — `Unavailable` is distinct from an empty set; no answer from priors |

Every evidence row in the panel is a real object id, so clicking it is the same
`revealAndFocus` the rest of the command center uses — the answer navigates back
into the graph.

### Evaluation

`test/assistant-eval.test.ts` is a labelled set of realistic developer-context
questions scored on seven dimensions, run against the deterministic provider so
a regression means the *pipeline* changed:

```
intent 9/9 · retrieval 6/6 · index recall 4/4 · provenance 9/9
grounding 9/9 · authorization 2/2 · extraction 1/1
```

`authorization`, `provenance` and `grounding` are asserted at **100%** — they are
invariants, not quality scores. `intent` and `retrieval` have floors. **Index
recall is measured separately from citation**: the first version of this eval
scored the AND-bug case as passing because the right note was cited via the
recency fallback, which hid the defect entirely.

### UI

An **Ask Context** panel in the accepted HUD language (same treatment as the
graph control panel), reachable from the left rail or from the inspector's
"Ask about this" — which scopes the question to the selected object. It shows the
grounding state, the answer, evidence rows with their layer/rank/relationship
provenance, and inert task proposals with a per-item **Create**. Nothing is
created until that button is pressed. The P3.1–P3.3 visual system is unchanged.

### Provider

`LLMProvider` port. Default is a **deterministic fake** — that is what makes the
boundary testable. Setting `ANTHROPIC_API_KEY` activates a real adapter behind
the same port (no new dependency; uses global `fetch`). Swapping providers must
not change the authorization, provenance or grounding results.

## Visual shell reconciliation (T3.1)

`src/adapters/web/` was brought into conformance with the **reconciled**
`Design_Dashboard_Aesthetic_Claude_Blueprint.md` (T2.1) and the T2.2 decision
review. The command-centre composition, the interactive graph (P3.2) and the
cross-surface object identity (P3.3) are unchanged; the reference-derived
taxonomy that had leaked into the shell was removed. No backend, schema,
dependency or test was touched. `tsc --noEmit` clean, 75/75 tests pass, no
horizontal overflow at 2048 / 1600 / 1140 / 390, clean console.

The five known deviations at blueprint §13, resolved:

1. **Colour.** `--apps` / `--memory` / `--routines` retired from `styles.css`.
   One action accent (`--action`) doing only three jobs — now/next, action,
   current focus — a four-tier greyscale contrast ladder, and a bounded,
   token-named categorical palette (`--proj-1..8`) **reserved for Project
   identity**, applied additively by project order (mod 8) as a structural
   placeholder. Object class is carried by its name in text, never by hue; the
   final per-Project assignment rule and >N overflow behaviour stay deferred
   (blueprint Q1). No colour value is hard-coded outside a token.
2. **Offline orbits removed, not dimmed.** The `APPLICATIONS` / `ROUTINES`
   rings, their badges/nodes/labels, the decorative particle core and the
   ambient ~6.5k-dot memory lattice are gone. The field draws only real
   objects — the Workspace root (a real entity, labelled `WORKSPACE`), its
   projects, their captured context — and real or genuinely computed edges.
   A sparse workspace now looks sparse. The honeycomb canvas texture was
   replaced with a neutral dot grid.
3. **No ambient motion.** The ring rotation is gone with the ring. Nothing
   continuous moves; only selection/focus/search transitions do, all
   reduced-motion gated.
4. **Retired reference widgets not recreated.** The Skills Deck, the Routines
   table, the Micro-Apps launchers and the "Today's mix" bar were removed. The
   left rail is *Actions* (Capture, Ask) + *Session* (real clock/zones/day
   progress) + *Project Pulse* (P3.3 real parts, `PREVIEW`-tagged for the
   unbacked task counts). The right rail is *Attention* (`PREVIEW`) plus a
   short note that the region is intentionally quiet — retired widgets were not
   recreated to fill it.
5. **Relationship rows (Q7).** Each row carries verb + direction + confidence
   state as text, with an expandable **Provenance** slot (origin, author,
   created, provenance kind, visibility) that the layout no longer precludes
   from carrying contributing signals later. Weak / possible relationships are
   filtered out of the primary view (§5.3); the on-demand "possibly related"
   affordance stays deferred (Q6).

Other shell changes: header identity is `DEVWORKSPACE · persistent context
layer` (product vocabulary; the "Agentic Context OS" lockup and the non-functional
`Menu` / layout / info header controls were removed); the search input applies a
**spotlight** — the field attenuates and matches stay in place, they never
reflow (§5.7); keyboard focus uses a dedicated `--focus` token, not a data hue.

**P3.4's `Ask Context` panel** predates T3.1 on this branch. T3.1 neither built
nor removed it — it was left functionally intact and only re-tokenised for
colour conformance. Whether an assistant surface belongs in the shell is
blueprint Q8, deferred to the AI-layer milestone's acceptance.

## Live data + reference-system integration (T3.3)

What each reference-derived surface now shows, and why:

| Surface | State after T3.3 |
|---|---|
| **Repository** (new, right rail) | Live GitHub activity: repository metadata, contributors, commits, branches, pull requests, issues and workflow runs. Exact totals only; per-section failures stated; freshness, source and auth mode printed. Rows open the real entity on GitHub; the linked internal project opens on the map. |
| **Email** | `Not connected`. No mail connector, credential or dependency exists in the runtime, so no count, message row or timestamp is shown — and none is invented. A provider integration was **not** built, because no mailbox authorization exists. |
| **Routines** | Real background-execution records from the outbox worker: real event type, the consumer actually registered for it, the object it concerned, its state and its recorded timestamp. There is still **no clock-based scheduler**, so no row carries a fire time or a next run, and nothing infers whether a worker process is alive — `pending` is a fact about a row, not a claim about a process. |
| **Skills Deck** | Executability is a state. `/capture` runs in the core and is always available; the three assistant skills are `aria-disabled`, removed from the tab order and refuse to run whenever the assistant does not answer `/healthz`. A run shows running, measured elapsed time, and success or failure. The dev stub is still named `dev stub`; no effort tier is shown, because the service exposes none. |
| **Second Brain** | Unchanged in composition. Every semantic node remains a real persisted object; the inspector now also shows an object's **external source** (its stable reference and canonical URL) when it records one. |
| **Micro Apps** | Unchanged — Capture, Second Brain, Ask Context, Spatial Search all delegate to real capabilities. No generated-artifact browser or asset gallery exists, so none is shown. |
| **Living artifacts** | No artifact/output system exists in this build. Nothing is rendered rather than a synthetic gallery. |
| **Particle field** | Unchanged decorative atmosphere. Carries no id, count, label or handler, so density is visual and never fabricated data. |
| **Clock** | `Asia/Kolkata`, 12-hour with meridiem, ticking every second. T3.3.10 made the zone explicit on **every** formatter in the shell — the header clock, the activity table, repository timestamps and routine timestamps now share one zone rather than inheriting the device's. |

## Deferred (documented, not built here)

Per P2.7 §15 / §16 — belongs to later milestones, not this slice:
relationship suggestions & candidates, suppressions, usage signals, ranking
weight sets, telemetry / G1–G4 gate events, the Assistant service and Context
API, semantic/vector retrieval, lexical *search* endpoints (the `object_fts`
index is built but not yet queried), Task objects and real `belongs_to` anchor
edges, `project_share` management UI, real authentication, production deployment.
