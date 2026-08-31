# Design Blueprint — Personal Developer Workspace

## Visual & Interaction Specification

**Status:** Reconciled at **T2.1 — Blueprint Reconciliation** (2026-08-30). Supersedes the pre-T2.1 revision of this file in full.

**What this document is.** The authoritative visual and interaction specification for the Personal Developer Workspace UI. It is *derived from* the product blueprint and constrained by observed evidence; it is not a description of another product.

**What this document is not.** It is not a product specification, not an architecture document, and not a technology selection. It may not introduce product entities, workflows, or capabilities.

### Authority order

When these disagree, the higher one wins:

1. **`Claude_Project_Blueprint.md`** (Master Execution Blueprint) — product purpose, entities, core workflows, MVP scope, architecture direction, and `Capture → Connect → Understand → Act`.
2. **`docs/phase-1/` and `docs/phase-2/`** — the accepted product and architecture design (P1.1–P1.2, P2.1–P2.6). P2.1 §5/§7/§8 and P2.2 §3–§6 are the authoritative object and relationship semantics.
3. **This document** — visual and interaction direction only.
4. **`docs/reference-video-analysis.md`** — authoritative *only* for what was observed in the reference video and for the transferable principles derived from it. It has **no authority over product taxonomy, entities, or scope**.

A reference-derived idea may never override items 1 or 2. Where the reference and the product model disagree, **the product model wins and the reference idea is discarded**.

### Reconciliation record

The pre-T2.1 revision was written as an interpretation of the "Rubric Agentic OS / Second Brain" reference screens, and had absorbed that product's taxonomy into our colour system, our panel structure, our graph layers, and our acceptance checklist. `docs/reference-video-analysis.md` established by direct frame evidence which parts of that reference are transferable principles and which are that product's own semantics. This revision keeps the former and removes the latter. §12 lists every retired directive and why.

---

# 1. Design intent

Build a dense, quiet, dark-first **developer context environment** for a persistent context layer.

The interface exists to make one thing tangible: **the developer's accumulated work is one connected body, and the system knows how it connects.**

At a glance the user should be able to move from:

> "What am I working on?" → "What is this connected to?" → "Why is it related?" → "What should I do next?"

without leaving the environment.

## 1.1 It must not collapse into

- A generic SaaS dashboard or admin panel.
- A Notion-style document workspace.
- A generic AI chat interface.
- A grid of rounded cards separated by whitespace.
- **A visual imitation of the reference product.**

## 1.2 It must not become

- A decorative simulation of activity. Nothing may move, glow, count, or accumulate unless real data drives it.
- A picture of a graph. The graph is an instrument (§5), not a background.

## 1.3 The controlling trade-offs

When forced to choose:

| A | B | Choose |
|---|---|---|
| A visually impressive effect with little product value | A quieter interaction that makes context easier to understand | **B** |
| A conventional SaaS pattern that is easier to build | The dense environment pattern specified here | **B**, unless accessibility, performance, or a real technical constraint makes it materially harmful |
| Fabricated visual richness | An honest, sparser surface that reflects real data | **B**, always |
| Matching the reference more closely | Serving `Capture → Connect → Understand → Act` | **B**, always |

When something is genuinely unspecified: **do not invent a product decision.** Inspect the repository, preserve the established direction, make the smallest reversible choice, and record it if consequential.

---

# 2. Product authority — the non-negotiables

This specification must at all times preserve:

1. **`Capture → Connect → Understand → Act`** as the product's core loop. Every surface must leave structural room for all four. A shell that only supports *Understand* and *Act* is a failure regardless of appearance.
2. **Cross-surface object identity.** A given object has one identity everywhere — dashboard, graph, inspector, search, capture, API. No widget may maintain a competing identity or a private dataset. (Established at P3.3; must not regress.)
3. **The richer relationship model.** Relationships are first-class: typed, directional, authored, with origin, confidence state, provenance, and their own visibility scope (P2.1 §8, P2.2 §4–§5). They must never be flattened into aggregate counts.
4. **User-authored Connect.** Users create and refine relationships. The UI must make manual typed linking a normal, low-friction action — not an admin function.
5. **Reason-giving.** An inferred relationship must always show its confidence state and be able to show the signals that produced it (P2.2 §4: *no false certainty*). The system may never present an inference as a plain fact.
6. **Provenance.** Every object and every relationship can show where it came from and who created it.
7. **Real data only.** Density, counts, freshness, and activity are read from the real store or are absent. Representative seed data must be visibly labelled until real functionality exists (§8.3).

---

# 3. Reference boundaries

## 3.1 What we learned from the reference

Recorded as principle in §10 and applied throughout. In summary: the reference demonstrated a *state grammar* and a *density discipline* — a strict contrast ladder, one accent doing few jobs, shape as a type system, hairline division instead of cards, elevation reserved for pressable things, state stated in words, past dimmed rather than hidden, absolute counts, a spotlight rather than a replacement for search, relationships revealed on selection, a near-zero motion budget, and a visual system that survives re-palette and re-labelling.

## 3.2 What we intentionally do not copy

These are **prohibited** as product architecture, taxonomy, or visual requirement:

| Not copied | Why |
|---|---|
| `Applications / Routines / Memory / Skills` as a taxonomy | Describes an AI assistant's own faculties. Our layers are the P2.1 object classes. Adopting it makes our graph describe our tooling instead of the developer's work. |
| An AI-configuration file (`CLAUDE.md` or equivalent) as graph root | Our root is the developer's own workspace (§5.5). A context graph centred on the tool is a category error. |
| `Departments` | A creator's domains. Our equivalent orthogonal axis is the home **Project** (P2.1 §5). |
| `Micro Apps` | Generated single-file HTML artefacts, a consequence of how the reference author works. Not a product concept. |
| `Hermes` / branded runners | The *principle* of showing execution and access locality may transfer (§10.14); the branded entity does not. |
| The badge-ring / particle-core structure as such | See §5.10 and §12. The reference's ring is a run-artefact archive we do not have, and its particle core represents 60,596 files. Reproducing either at our scale would fabricate data. |
| `Force / Circle / Hex / Rings` layout switching | Four projections, at least two of which answer no distinct question. See §5.12 (open). |
| Physics controls (`Link springs`, `Circle / Hex size`, `RING SPIN`) | Our layout is deterministic, not a force simulation. Controls must reflect real supported behaviour. |
| `Bake settings` | No product requirement. Removed. |
| The `X Agentic OS` wordmark lockup, the pixel-art mascot and icon set, the hard offset accent backplate on modals | Strongly identifying brand ornament. |
| Splitting into an "OS" surface and a separate "Second Brain" surface | Would cost the cross-surface object identity established at P3.3. See §5.12 (open). |
| A user-editable panel layout (drag / resize / remove / add) | Large surface area, no product justification. Deferred indefinitely. |
| "Remove" as a verb on a graph node | Dangerously ambiguous next to a real persisted object — delete the note, or hide the dot? Prohibited. |

## 3.3 How the reference influences without determining

The reference contributes **grammar**: how state is expressed, how density is made legible, how attention is directed, how motion is budgeted. It contributes **nothing** about what our objects are, how they relate, or what the product does. Those come from `Claude_Project_Blueprint.md`, P2.1 and P2.2.

The clone boundary, stated concretely: taking the state grammar, the interaction principles, and the contrast/density discipline is **influence**. Taking the four-layer taxonomy, the orange-on-black hexagon palette, the badge-ring-around-a-particle-core, the wordmark lockup, and the two-surface split *together* is a **clone**. This revision removes the latter set.

## 3.4 Where the reference gives us no guidance

The reference contains **no** loading state, error state, empty state, system-health surface, capture affordance, relationship-authoring affordance, or reason-giving. Its silence is **not** a recommendation. §8 and §6.7–§6.10 govern these, from the product model alone.

---

# 4. Visual direction

## 4.1 Composition

Desktop:

```text
┌──────────────────────────────────────────────────────────────┐
│                          HEADER                              │
├──────────────┬──────────────────────────────┬───────────────┤
│              │                              │               │
│     LEFT      │        CONTEXT FIELD        │     RIGHT     │
│     RAIL      │      (the graph, §5)        │     RAIL      │
│              │                              │               │
└──────────────┴──────────────────────────────┴───────────────┘
```

- The **Context Field is visually dominant** — the largest region, the only one with space around it, and the only one that ever moves (§7).
- Target proportions: rails ~22–24 % each, centre ~46–52 %. These are targets, not permission to force a broken layout. On ultrawide, the centre takes the extra width.
- **Full-bleed.** No page container, no outer margin, no scroll on the primary surface. The environment reaches the viewport edges.
- The header **frames** the composition. It is not a conventional navbar and must stay short.

**Rail semantics.** The two rails are split by *direction of demand*, not by "nav vs detail":

- **Left rail — what you reach for.** Capture, current session/activity, the state of the work you are in.
- **Right rail — what wants you.** Items needing attention, available actions, scheduled or pending work.

A panel whose content does not fit either sense probably does not belong in a rail.

## 4.2 Density

The interface is deliberately information-dense. Density must come from **real data**: compact rows, small metadata, status markers, real counts, real graph nodes, fine rules.

Density must never come from:
- Text made unreadably small.
- Fabricated nodes, dots, particles, or activity (§8.3).
- Filler widgets added to occupy space.

**Density is only survivable when paired with §4.3 and vertical rhythm.** Rows must breathe vertically even when the panel is dense horizontally. Density is quantitative; whitespace is vertical.

## 4.3 Contrast hierarchy

A strict four-tier ladder. No intermediate values. This is what makes tier 4 safe to be genuinely faint.

| Tier | Treatment | Carries |
|---|---|---|
| **1** | Accent, or white at large size | The single most important value in a panel. At most one per panel. |
| **2** | Off-white, normal body size, regular weight | Primary content — titles, object names, row subjects. |
| **3** | Mid-grey, small, uppercase, wide tracking (~0.12–0.2 em) | Labels, column headers, section names. Reads as chrome, not content. |
| **4** | Dark grey, smallest, often lowercase | Ambient metadata — freshness, hints, counts-of-counts. Faint by design; present when sought, absent when not. |

Hierarchy comes from **size, weight, opacity, letter-spacing, and position** — not from colour. Do not use many colours to establish hierarchy.

## 4.4 Structural borders and division

- **Default: no border.** Panels are typographic regions on a shared ground, separated by a **hairline rule** at low opacity.
- No panel boxes, no panel fills, no card grids, no heavy shadows, no neumorphic surfaces.
- A **very** low-contrast technical texture may sit on the canvas. It must never compete with the information layer.
- Corner treatment and restrained rounding are permitted where technically useful; overall geometry stays structured.

## 4.5 Accent usage

**One accent colour, doing exactly three jobs — and nothing else:**

1. **Now / next** — the current time, the next scheduled item, today's marker.
2. **You can act here** — primary buttons, run/confirm triggers, the active tool in the header.
3. **This is the current focus** — the selected object and its halo.

Everything outside those three jobs is greyscale, **except** the two data-bearing hue channels defined in §5.4.

Rules:
- Saturation concentrates on meaningful elements. Do not spread accent across ordinary borders, labels, or icons.
- **Colour never carries meaning alone.** Every state that colour reinforces must also be stated in text or a non-colour marker (§4.13, §10.5).
- Error/blocker states use a distinct signal colour, always paired with a word.

## 4.6 Typography

- **One primary UI typeface**, highly legible, carrying nearly everything.
- **Section labels:** uppercase, compact, wide tracking, restrained weight. This is the device that makes chrome recede to a different plane from content.
- **Monospace** is reserved for literal machine strings: identifiers, paths, timestamps where precision matters, commands, and technical metadata. Do not make the whole UI monospace.
- **Give each typeface exactly one semantic job.** A decorative or novelty face may never carry data.
- Label vocabulary must be drawn from the **product's** nouns (Project, Task, Note, Decision, Idea, Resource, Checkpoint, Capture, Inbox, Attention, Activity, Relationships) — never from the reference's.

## 4.7 Geometry — shape as a semantic channel

Shape is a **type system**, not decoration. Assign geometry to meaning and hold it everywhere:

- **Shape encodes object class** (§5.4). One shape per class, used identically in the graph, in inspectors, in rails, and in search results.
- **Squares/grids encode time** — period grids, activity grids, schedule rows.
- **The accent halo encodes focus** — never used for anything else.

Favour circles, rings, thin radial lines, fine edges, and compact rectangular controls. Avoid large rounded SaaS cards, giant pills, and soft neumorphic surfaces.

Geometry must be justified by meaning. **Do not adopt a shape because the reference uses it.**

## 4.8 Data-driven visualisation

Prefer **counting to charting.**

| Form | Encodes |
|---|---|
| Hero numeral + unit label | The one number that matters in a panel |
| Segmented proportion bar with per-segment counts | Composition of a set — never a trend |
| Dot / cell grid | Discrete real events across a period |
| Ordered table with an explicit status column | A schedule or queue |
| Node–link graph | Relationships (§5) |

Rules:
- **Absolute, unrounded counts**, read from the real store. Not rounded, not approximated, not decorative.
- **Freshness stated explicitly** — a relative age in tier 4, and an absolute timestamp where precision matters.
- Every value must be traceable to a real query. If the data does not exist yet, show an empty state or a labelled preview (§8.3) — never a plausible-looking number.
- Line charts and sparklines are not part of the default vocabulary. Introduce one only when a genuine trend question exists.

## 4.9 Elevation

**Elevation means "this is a thing you can run or open."**

- Raised, filled, bordered surfaces are reserved for pressable objects — action cards and primary controls.
- Everything else is typography on the shared ground, divided by hairlines.
- If cards become the default container, elevation stops meaning anything. Cards are the exception, not the layout.

## 4.10 Glow

Three levels, never mixed:

- **Level 0 — Structural.** No glow. Borders, inactive labels, secondary metadata, static structure.
- **Level 1 — Ambient.** A wide, very low-opacity bloom behind the Context Field only. May take the hue of the current focus.
- **Level 2 — Active.** A tight halo on **exactly one element at a time** — the selected node, or the active control.

Do not make every panel, border, icon, and label glow. The aesthetic depends on contrast between quiet structure and selective illumination.

## 4.11 Theming and re-labelling survivability

The composition and the state grammar are the design. Palette and vocabulary are **configuration**.

Requirements:
- All colour, spacing, and type decisions live in **named tokens**. No hard-coded values in component styles.
- **Renaming a panel must not break the layout.** If it does, the structure is not real.
- Dark-first is the current default and a legitimate choice, but the visual language must **not depend on darkness**. Structure carried by hairlines, the contrast ladder, shape encoding, and typography must survive inversion. (Reference evidence: the same system was demonstrated fully legible in light mode.)
- A light theme is **not** required now. Not being blocked from one later **is** required.

## 4.12 Responsive principles

- **Desktop (primary):** full composition preserved wherever space allows; centre grows on ultrawide.
- **Laptop:** rails may collapse to drawers/overlays. The Context Field is preserved. Do not shrink everything uniformly until it is unreadable.
- **Mobile:** never force the three-column composition onto a phone. Use a sequential model: header → context summary → Context Field → attention → work items → capture. Graph controls become a sheet or overlay.
- The Context Field must never become a dead scroll region on touch. Verified viewports: 2048 / 1600 / 1140 / 390, with zero horizontal overflow at each.
- Mobile must preserve the visual identity without literally reproducing desktop geometry.

## 4.13 State expression

- **State is stated in words.** `BLOCKED`, `INFERRED`, `PRIVATE`, `QUEUED`, `STALE` are text. Colour and shape reinforce; they never carry the meaning alone.
- **Past stays visible and de-emphasised.** Completed, fired, or superseded items remain in place at reduced opacity rather than being hidden or struck through. The shape of the period should be readable without navigating.
- Non-colour state indicators are mandatory (§8.2).

---

# 5. Graph direction — the Context Field

## 5.1 What the graph represents

The Context Field is **the developer's real workspace objects and the real relationships between them.**

It is an **interrogable instrument**, not a decorative background. It exists to answer, by direct interaction:

- What am I working on?
- What is this connected to?
- Why is it connected — and how confident is that?
- Where did this come from?
- What changed recently?
- What should I do next?

If a visual element in the field does not serve one of those questions, it does not belong there.

## 5.2 Authoritative object classes

From P2.1 §5/§7/§9 and the implemented domain model. **This list is authoritative. Do not add classes to it from any other source.**

| Class | Role |
|---|---|
| **Project** | Top-level container and unit of sharing. Not nested. |
| **Task** | Actionable work. Carries Work Context and Checkpoints. Has a dedicated detail view. |
| **Note** | Free-form context. The capture default. |
| **Decision** | A choice plus its rationale. Has a dedicated detail view. |
| **Idea** | Uncommitted candidate. |
| **Resource** | External reference. |
| **Checkpoint** | Structured in-flow capture: focus / progress / blockers / next action / open questions. |

Two structural containers are also real and may be represented: the **Workspace** (the root, §5.5) and the **Inbox** (captures with no home Project yet).

MVP-required classes are **Project, Task, Note, Decision, Checkpoint** (P2.1 §9). Idea and Resource are in the model but need not be foregrounded before they carry data.

## 5.3 Relationship semantics

From P2.1 §8 and P2.2 §4–§5. Authoritative.

**Verbs** (directional, A → verb → B): `belongs to`, `derived from`, `explains`, `caused by`, `blocked by`, `next action for`, `follows from`, `related to`, `references`, `supersedes`.

**Origin:** `explicit` (user-authored) · `user_confirmed` · `structural` (computed on read, never stored).

**Confidence state** and its **mandatory surfacing rules** (P2.2 §4):

| State | Visual treatment |
|---|---|
| **Known / structural** | Shown as fact. No confirmation affordance. |
| **User-confirmed** | Shown as fact, same standing as Known. Never auto-removed. |
| **Inferred — high** | Shown in primary context, **visually marked as inferred**, with a one-click confirm affordance and access to its contributing signals. |
| **Weak / possible** | **Must not appear in the primary context view.** Available only through a deliberate, on-demand "possibly related" affordance. |

That last row is a hard rendering rule, not a preference. **The default Context Field must not draw weak links.**

**Additional required properties on every relationship:** author, creation time, provenance, and its own visibility scope (`shared` / `private`).

**Prohibited:** collapsing relationships into aggregate counts (`4 Tasks · 7 Notes`). Relationships are listed individually, by name, with verb, direction, and confidence state.

## 5.4 Encoding — two orthogonal channels

Two independent visual channels, never overloaded. This is what keeps the field legible as it grows.

| Channel | Encodes | Rule |
|---|---|---|
| **Shape** | **Object class** (§5.2) | One distinct shape per class. Identical everywhere the class appears. |
| **Hue** | **Home Project** (the orthogonal "domain" axis, P2.1 §5) | Categorical, assigned from a bounded palette. |

Supporting encodings:

- **Accent halo** — current focus. One element at a time.
- **Edge line treatment** (weight / dash) — confidence state, **always** accompanied by a text label.
- **Explicit chips** — visibility scope (`private` / `shared`), staleness, and `INFERRED`. These are text, not colour (§4.13).

Constraints:
- The palette must remain distinguishable for colour-vision-deficient users, and every hue-carried meaning must be recoverable without colour.
- Node size may encode a real magnitude (e.g. relationship count) or nothing. It may never encode importance the system has not measured.

## 5.5 The root

The graph root is the user's **Workspace** — a real entity in the data model, not a synthetic node and not an AI-configuration artefact.

- A graph with a named origin is comprehensible; one without is a cloud. Distance from the root is meaningful.
- The root must be identified by product vocabulary. It must never be named after, or stand for, the assistant, its configuration, or its prompt.
- Projects sit at the first level out from the root; non-Project objects hang from their home Project, or from the Inbox when unfiled.

## 5.6 Selection and relationship reveal

**Relationships are revealed on selection, not permanently drawn as decoration.**

- **At rest:** the field draws few or no edges. Structural containment may be indicated very quietly. Weak links are never drawn (§5.3).
- **On selection:** the selected node's relationships are revealed prominently — highlighted, with the rest of the field muted — answering "what does this touch?" in one gesture.
- **Focus** narrows to a node's neighbourhood as a separate, explicit action from selection.
- **Hover** shows lightweight identity only; it must not trigger a layout or reveal.
- Selection state must be recoverable without colour, and reachable by keyboard.

## 5.7 Search-to-node — the spotlight

**Search attenuates the world rather than replacing it.**

- Activating search **dims the environment** and leaves matching objects legible **in the positions they already occupy**. Matches do not reflow into a list and do not move.
- A match keeps its spatial identity, so the user learns one persistent map instead of re-reading a ranked list each time.
- Search must resolve to the **same object identity** used by the graph, the inspector, and the rails (§2 item 2). No second index, no search-only records.
- Where search results also exist in a rail, the same query should illuminate them there too — one query, every surface answering in place.
- Search is scoped by the same visibility policy as every other read. It may never reveal the existence of an object the principal cannot see.

## 5.8 Provenance

**Provenance and real source location are visible, not hidden.**

- Every object can show where it came from: its capture origin, its author, its creation time, its home Project, and — once external sources exist — the external system, repository, or reference it originated from.
- Every relationship can show who created it, when, its origin, and (when inferred) the signals that produced it.
- Provenance is displayed as concrete, quotable detail — an identifier, an author, a timestamp, a source — not as a vague badge.
- **Do not represent an integration as functional because its glyph appears in seed data.** External-source provenance is an attribute of a real object; it is not a decorative layer (§5.11).

## 5.9 Context explanation — reason-giving

This is a first-class requirement, not a nicety, and the product model demands it (P2.2 §4: *no false certainty*).

- An inferred relationship must always be **visibly marked as inferred** and must be able to **show which signals produced it**.
- The system may never present an inference as a plain fact.
- Where the workspace surfaces something because it judged it relevant, the user must be able to ask **why this** and get a concrete answer.
- Borderline evidence resolves to Weak, and Weak stays out of primary context (§5.3).

## 5.10 Real-data density

**Graph density must always represent real project/context data.**

- Every node is a real persisted object. Every domain edge is a real or genuinely computed structural relationship.
- **Never fabricate density for visual effect** — no filler particles, no synthetic dot fields, no decorative point clouds, no invented node counts.
- If the workspace holds twenty objects, the field shows twenty objects and looks like it. A sparse workspace looking sparse is **correct behaviour**, not a defect to be styled around.
- Where a visual concept requires density we do not have, the concept is wrong for us — not the data.
- Empty and near-empty states are first-class and must be designed (§8.1), not avoided by padding the field.

## 5.11 What is explicitly NOT part of the graph

- **No `Applications` orbit or layer.** External systems are provenance on real objects (§5.8), not a semantic ring.
- **No `Routines` / automation orbit or layer.** No scheduled-automation object exists in the product model. If one is ever introduced, it enters through the product blueprint, not through this document.
- **No `Memory` layer** distinct from the object classes. Everything the workspace holds is an object of a class in §5.2.
- **No `Skills` layer.**
- **No decorative particle core** representing "accumulated context" in the abstract.
- **No AI-configuration node**, and no node representing the assistant.
- **No decorative edges.** Anything drawn as a domain edge must be a real relationship.
- **No non-functional controls.** Every control in the graph surface must map to behaviour the implementation actually supports.
- **Offline scaffolding is prohibited going forward.** Any layer that carries no domain data must be removed rather than dimmed. (§13 records the existing scaffold as a known deviation to be retired.)

## 5.12 Deferred graph questions

Recorded as open questions in §11, not decided here: alternative layout projections, and whether the graph is ever a separate surface.

---

# 6. Interaction principles

## 6.1 Search — spotlight

See §5.7. Principle: **attenuate, do not replace; results keep their position.** Search must be reachable by keyboard from anywhere, and dismissible without side effects.

## 6.2 Selection

One selection at a time. Selection focuses the object, reveals its relationships (§5.6), and drives the inspector (§6.4) and any linked rail surfaces (§2 item 2). Selection never destroys the user's viewport position without an explicit navigation action.

## 6.3 Relationship reveal

Revealed on selection, muted at rest, never decorative. Confidence state is visible on every revealed relationship. Weak links require a deliberate, separate action to see (§5.3).

## 6.4 Context inspection

Keep **three concerns on distinct surfaces**. Collapsing them into one scrolling panel is what makes inspectors unusable.

1. **Identity** — class, title, real identifier, home Project, author, timestamps, visibility scope, staleness.
2. **Actions** — what can be done, in a strict three-tier weight order (primary / secondary / tertiary). Never more than three tiers.
3. **Content and relationships** — the object's body, and its relationships listed individually with verb, direction, confidence state, and access to provenance and signals.

Rules:
- The inspector must resolve to the **real persisted object**. No inspector-only data.
- Relationship rows must traverse back into the graph, preserving one identity across graph → inspector → capture → API.
- Actions stay within what the API actually supports.
- The verb "Remove" is prohibited on a node (§3.2). Destructive actions must name what they destroy.

## 6.5 Filtering

- Filters derive from **types actually present** in the data, never from a hard-coded list.
- Filtering is a **view concern and never the security boundary.** Re-enabling every filter must reveal nothing the principal could not already see.
- Filter state must be visible and reversible in one action.

## 6.6 Navigation

- The environment is one place. Moving between the field, an object, and a rail is a change of focus, not a change of application.
- Any surface that is genuinely a different mode of thinking gets a named door and a visible way back — but see §11 (open) before creating one.
- Keyboard navigation and visible focus are mandatory (§8.2).

## 6.7 Capture

**Capture is first-class and must not be designed around.** (P2.1 §7.)

- Reachable from **every view in one action**, and accepts plain text immediately.
- **No mandatory fields beyond the text itself.** Type defaults to Note. Title optional.
- Timestamp, author, and attachment to the active work item are **auto-attached, never asked**. With no active item, the capture goes to the Inbox.
- **Checkpoint capture** is a structured quick-capture (focus / progress / blockers / next action / open questions), every field skippable. It is the primary in-flow habit; the UI must make it obvious and fast.
- Misfiling is expected and cheap to fix. Refinement is a normal action, not an error correction.
- A capture must appear in the Context Field, already anchored, without a reload.

## 6.8 Connect

**Users author relationships. This is not an admin function.**

- Manual typed linking uses the §5.3 verb vocabulary, is reachable from the object being viewed, and is low-friction.
- `related to` is the safe default when the precise verb is unknown, and must be refinable later without penalty.
- Inverse relationships are shown automatically on the other object.
- Accepting an inferred relationship is a **one-click** action from where it is surfaced.
- Rejecting one is equally cheap and is remembered (P2.2 §5) — a rejected suggestion must not silently reappear.

## 6.9 Understand

- Selecting an object shows the context that gives it meaning: its relationships, its rationale, its history, and why each related item is there.
- Assembled context is **layered, bounded, and ranked** (P2.2 §6) — not an undifferentiated dump.
- **Staleness is flagged, never fabricated.** If context is old, say so.
- Where the assistant answers from workspace context, the answer must carry its grounding: what it used, and a way back to those objects. An answer that cannot be grounded must say so rather than assert.

## 6.10 Act

- Actions surfaced next to context: create the next Task, complete work, confirm a relationship, file an Inbox item, hand off.
- **Parameters that determine an action's cost or quality are shown at the point of decision**, and again on the result.
- **Important automated actions leave durable receipts** (§10.4): what ran, with what parameters, what it produced, and a way back to the evidence. Applies to assistant answers and to inferred-relationship surfacing. It does not authorise building a routines system.
- Proposals are proposals. Anything the system suggests creating remains a proposal until a person accepts it.

---

# 7. Motion budget

**Motion is a scarce budget.** Evidence: in the reference, every text-bearing surface was byte-identical between consecutive frames; only the focal visualisation moved. Aliveness read as credible *because* the data was still.

## 7.1 What may move

- **The Context Field's focal visualisation only** — and only if a real, justified effect is chosen. Nothing else, ever, continuously.

## 7.2 What moves only in response to interaction

- Selection and focus transitions.
- The search spotlight dim/undim.
- Relationship reveal on selection.
- Panel, drawer, and inspector open/close.
- Filter application.
- Explicit navigation transitions.

These carry meaning. They are the motion budget's primary use.

## 7.3 What is static

Everything that carries text or data. Specifically prohibited by default:

- Connection shimmer.
- Decorative node pulses.
- Ambient graph movement / drift.
- Animated counters, bars, meters, or progress fills.
- Panel or border shimmer, breathing, or glow cycling.
- Typing/terminal effects, scanlines, sweeps, glitch effects.
- Any looping animation on a rail widget.

## 7.4 What is disabled by default

- **Ambient / orbital rotation is OFF by default.** It may exist only if independently justified by a product need, and if so must be user-controllable and off on first load. It may not be introduced to imitate the reference.

## 7.5 Reduced motion

Under `prefers-reduced-motion`:
- All continuous motion stops entirely.
- Interaction transitions become instant state changes.
- **No information may be conveyed by motion alone**, so the same information hierarchy holds with every animation removed.
- Motion is never the only indicator of a state (§8.2).

---

# 8. States, accessibility, data authenticity

## 8.1 States

Every major component accounts for: default, hover, focus, active, selected, disabled, **loading, empty, error**, and success where applicable.

- Empty states are **first-class**, especially for the Context Field (§5.10). A new or sparse workspace must look intentional.
- Loading and error states must not break the composition or shift layout.
- The reference offers no guidance here (§3.4); these come from the product model.

## 8.2 Accessibility

Non-negotiable, and never traded for visual fidelity:

- Keyboard navigation throughout, including the Context Field.
- Visible focus state on every interactive element.
- Sufficient text contrast — tier 4 must still meet the project's contrast floor at its size.
- **Non-colour state indicators everywhere.**
- Accessible names for icon-only controls.
- Reduced-motion support (§7.5).
- Logical reading and navigation order despite density.
- Controls must remain operable at dense sizes.

## 8.3 Data authenticity

- Progress from representative data to real data. **Use the same underlying object everywhere** (§2 item 2).
- Representative seed data must use realistic developer terminology, never lorem ipsum and never meaningless random numbers.
- Any widget not backed by real functionality carries a **visible marker** (the established `PREVIEW` / `OFFLINE` convention). Preview content must not be removed merely to look more finished, and must not be styled to look real.
- Preview strings must not collide with real data (a screenshot of preview content must never be misreadable as a data leak).
- Once real data exists, disconnected mock datasets are prohibited.
- **Never fabricate density, counts, freshness, or activity** (§5.10).

---

# 9. Component consistency

Shared primitives must have one implementation and one visual language: panel, section header, metric block, status marker, timeline/schedule row, action card, graph node, graph edge, relationship row, filter control, search field, inspector, activity row, chip/tag, empty state.

Do not create independent visual implementations of the same concept on different surfaces.

---

# 10. Adopted design principles

Formally incorporated. These are binding.

1. **Search attenuates the world rather than replacing it.** Dim the environment, illuminate matches in place, preserve spatial identity. (§5.7)
2. **Relationships are revealed on selection rather than permanently drawn as decoration.** (§5.6)
3. **Shape and hue serve as independent semantic channels.** Never overload one channel with both classifications. (§5.4)
4. **Important automated actions leave durable receipts** — what ran, with what parameters, what it produced, and a route back to the evidence. (§6.10)
5. **State is explicit in text and never encoded solely through colour.** (§4.13)
6. **Past state remains visible while being visually de-emphasised.** (§4.13)
7. **Provenance and real source location are visible.** (§5.8)
8. **Absolute counts and freshness use real data.** Unrounded, queried, or absent. (§4.8, §8.3)
9. **Elevation communicates interaction significance.** Raised means pressable. (§4.9)
10. **Motion is a scarce budget.** (§7)
11. **Density requires a strict contrast hierarchy.** (§4.2, §4.3)
12. **The visual system survives re-labelling and re-theming.** Tokens, not hard-coded values; renaming a panel breaks nothing. (§4.11)
13. **The graph is an interrogable instrument, not a decorative background.** (§5.1)
14. **Locality and scope are per-item state.** Where an object came from, what visibility it carries, and where work executed are shown per object — not as a global setting. (§5.8, §5.4)

---

# 11. Open questions

Genuinely unresolved, and each materially affects future implementation. **Do not resolve these by inventing an answer.**

**T2.2 status (2026-08-30).** Each question was reviewed for whether it blocks the visual shell. The classification and any minimum constraint are recorded per question below; the full reasoning, the consolidated constraints, and the readiness verdict are in `docs/PROGRESS.md` § *T2.2 — Implementation-Blocking Decision Review*. **The deferred portion of every question remains open** — T2.2 resolved no question in full and changed nothing in this specification.

**Q1 — Per-Project hue at scale.** §5.4 assigns hue to home Project. Categorical palettes stay distinguishable to roughly 8–12 values. What happens beyond that — a stable palette with a shared "other" bucket, hue by something coarser, or hue reserved for the active Project only? Blocks: any real colour-token work in the Context Field.
> **T2.2 — PARTIALLY BLOCKING.** Minimum now: palette *structure* only — one action accent, the greyscale ladder, and a bounded token-named categorical set reserved for Project identity; hue never the sole carrier. Palette values, assignment rule and overflow behaviour deferred to a later Context Field task.

**Q2 — Shape vocabulary for seven classes.** §5.4 assigns shape to object class, and §5.2 lists seven (plus Workspace and Inbox). Are all distinguishable at graph node size, or does the field need a reduced set with the remainder distinguished only on inspection? Blocks: node rendering.
> **T2.2 — NON-BLOCKING.** Class is carried in text; the shape channel stays unused, so introducing it later is additive. Constraint: T3.1 must not invent a shape vocabulary. Deferred to a later Context Field task.

**Q3 — Alternative layout projections.** Reference evidence shows switchable projections answer genuinely different questions, but four is more than any user needs, and our layout is deterministic rather than physics-based. Do we need more than one projection — and if so, is the second "what belongs to what" or "what changed recently"? Blocks: whether the graph surface needs a layout control at all.
> **T2.2 — NON-BLOCKING.** One deterministic layout and no projection/physics control (§12) is already the default; a second projection would be additive. Deferred to a later Context Field task.

**Q4 — Is the Context Field ever a separate surface?** P3.3 deliberately unified dashboard and graph around one object identity. A dedicated full-screen graph place might serve deep exploration, but risks that unification. Unresolved.
> **T2.2 — NON-BLOCKING.** The conservative option is already binding via §2 item 2, so a single surface is what gets built either way; a dedicated surface stays addable. Deferred until deep graph exploration is actually scoped.

**Q5 — Right-rail composition.** §4.1 defines the right rail as "what wants you". Its current contents (Attention, an action deck, a schedule table) are largely unbacked preview inheriting reference structure. What belongs there once only real capabilities are shown? Blocks: retiring the preview widgets.
> **T2.2 — PARTIALLY BLOCKING.** Minimum now: the rail is structural per §4.1; populate only from accepted capabilities or visibly `PREVIEW`/`OFFLINE`-marked content; the retired Skills Deck and Routines Monitor must not be recreated; sparse regions are correct. Final composition deferred until the capabilities it would surface are accepted.

**Q6 — Surfacing "possibly related".** P2.2 §4 requires Weak relationships to be reachable on demand but absent from primary context. The affordance is unspecified. Blocks: any weak-link UI.
> **T2.2 — NON-BLOCKING.** The prohibition (§5.3) is already actionable; only the on-demand affordance is open. Deferred to a later relationship-surfacing task.

**Q7 — Reason-giving presentation.** §5.9 requires an inferred relationship to show its contributing signals. Whether that is inline, on hover, in the inspector, or a dedicated explanation surface is undecided — and it determines how much room the inspector needs.
> **T2.2 — PARTIALLY BLOCKING.** Minimum now: relationships as an individually listed, growable set, each row carrying verb, direction and confidence state as text with an expandable slot for provenance and signals. Presentation form deferred to a later relationship/inference-surfacing task.

**Q8 — Receipt surface for assistant answers.** §6.10 requires durable receipts for important automated actions. Where an answer's grounding record lives — transient in the answer, or persisted as an addressable object — is a product question, not a visual one. Blocks: any receipt UI.
> **T2.2 — NON-BLOCKING.** No assistant surface exists in the accepted product; the shell renders nothing that carries a grounding record. Deferred to the AI-layer milestone when it is accepted.

---

# 12. Retired directives

Removed from this specification at T2.1. Recorded so no future agent reinstates them from the prior revision or from the reference.

| Retired | Reason |
|---|---|
| The document's framing as an interpretation of the reference screens, and the instruction to "treat the supplied reference screens as the visual reference" | Inverts the authority order. The product blueprint is authoritative; the reference informs principles only. (Authority order; §3.3) |
| Title "Agentic Developer Workspace" | Product name is **Personal Developer Workspace** per the master blueprint. |
| Colour semantics `Applications = cyan`, `Memory = purple`, `Routines = amber` | Reference taxonomy embedded as our colour system. Replaced by §5.4, keyed to our own object classes and Projects. |
| Section-label examples `MICRO TOOLS`, `SKILLS DECK`, `ROUTINES`, `APPLICATIONS`, `MEMORY` | Reference vocabulary. Replaced by product nouns (§4.6). |
| "Micro Tools — Reference concept: Micro Apps" as a required panel | Not a product concept. (§3.2) |
| "Skills Deck — preserve the reference's compact card structure" as a required panel | Reference concept; no backing product capability. Its fate is Q5. |
| "Routines Monitor — preserve the reference timeline-table pattern" as a required panel | No automation object exists in the product model. Its fate is Q5. The *schedule-table pattern* survives as a general form (§4.8) if a real schedule ever exists. |
| Graph "Routine Orbit" and "Application Orbit" semantic layers | Reference taxonomy. (§5.11) |
| "The visual treatment should resemble the reference's circular orbital badges" | Copying a form because the reference has it. The reference's ring is a run-artefact archive we do not have. (§4.7) |
| The Particle Core as "a major visual motif" representing accumulated context | Would fabricate density at our scale. Violates §5.10. (§5.11) |
| Graph control panel replicating the reference: `LAYOUT: Force / Circle / Hex / Rings`, `VIEW`, `PHYSICS` sliders (`Ring spin`, `Link spring`, `Node size`), `BAKE SETTINGS` | Corrections 4–6. Our layout is deterministic, not a force simulation; no product requirement for any of these controls. Layout projections are now Q3. |
| Context Inspector example showing `RELATED — 4 Tasks / 7 Notes / 2 PRs` | Aggregate counts destroy the relationship model. Replaced by §5.3 and §6.4. |
| Ambient motion candidates: connection shimmer, occasional node pulses, ambient graph movement | Not present in the reference, and prohibited by §7.3. |
| Orbital rotation as a default ambient effect | Off by default (§7.4). |
| "Rotate/orbit where appropriate" as a required graph interaction | Not justified by a product need. |
| "The visual behavior must remain consistent with the reference" | Optimising for resemblance. (§1.1) |
| Acceptance-checklist items requiring a particle field, a routines layer, an applications layer, cyan-for-applications, amber-for-routines, and reference-shaped panels | All reference taxonomy. Replaced by §14. |
| Final-target statements "Purple communicates memory / Amber communicates automation / Cyan communicates external systems" | Same. |

---

# 13. Known deviations in the current implementation

Recorded for the next visual task. **T2.1 changes no code; these are specification-to-implementation gaps, not defects introduced here.**

1. **Reference taxonomy in the style tokens.** `styles.css` defines `--apps`, `--memory`, `--routines`. All real object classes currently render undifferentiated as `--memory`. §5.4 requires shape-by-class and hue-by-Project instead.
2. **Offline `APPLICATIONS` / `ROUTINES` orbits.** Present as dimmed, non-interactive scaffold. §5.11 requires removal rather than dimming.
3. **Ambient ring rotation on by default.** `app/README.md` documents a ~240 s Applications-ring rotation, reduced-motion gated. §7.4 requires it off by default; §5.11 retires the ring it rotates.
4. **Preview widgets inheriting reference structure.** Attention, the action deck, and the schedule table are `PREVIEW`-tagged and unbacked. The `PREVIEW` convention itself is correct and must be kept (§8.3); what should occupy that rail is Q5.
5. **Inspector relationship display.** Whether the current inspector meets §5.3's individual-listing and confidence-state requirements in full has not been re-verified against this revision.

`app/README.md` remains a truthful record of what was implemented and is **not** amended by T2.1.

---

# 14. Visual acceptance checklist

A visual milestone is ready for review only when:

**Composition**
- [ ] Context Field is visually dominant; rails feel integrated, not bolted on; header restrained.
- [ ] Rails are split by direction of demand (§4.1).
- [ ] Full-bleed, no outer container, no horizontal overflow at 2048 / 1600 / 1140 / 390.

**Aesthetic**
- [ ] Four-tier contrast ladder is obeyed with no intermediate values.
- [ ] One accent, doing only the three jobs in §4.5.
- [ ] Hairline division; no card grid; elevation only on pressable objects.
- [ ] Glow is selective — at most one Level-2 element at a time.
- [ ] Dense but legible; density comes from real data.
- [ ] All colour/spacing/type values come from named tokens; renaming a panel breaks nothing.

**Context Field**
- [ ] Every node is a real persisted object; every domain edge a real or genuinely computed relationship.
- [ ] No fabricated particles, filler nodes, or decorative density.
- [ ] Shape encodes object class; hue encodes home Project; neither channel is overloaded.
- [ ] Root is the Workspace, named in product vocabulary.
- [ ] No Applications / Routines / Memory / Skills layer, and no offline scaffold.
- [ ] Few or no edges at rest; selection reveals relationships.
- [ ] Weak relationships are absent from the primary view.
- [ ] Empty and sparse states look intentional.

**Relationships & explanation**
- [ ] Relationships listed individually with verb, direction, and confidence state — never aggregate counts.
- [ ] Inferred relationships are visibly marked and can show their contributing signals.
- [ ] Provenance and real source location are reachable for objects and relationships.
- [ ] Visibility scope is shown as text, not colour alone.

**Interaction**
- [ ] Search dims the environment and illuminates matches in place, without reflowing them.
- [ ] Search, graph, inspector, and rails resolve to the same object identity.
- [ ] Filters derive from types actually present; filtering is never the security boundary.
- [ ] Capture is one action from every view, needs only text, and appears anchored in the field without reload.
- [ ] Manual typed linking is available from the object being viewed; inferred links confirm in one click.
- [ ] No control implies functionality that does not exist.

**Motion**
- [ ] Nothing continuous moves except a justified focal effect.
- [ ] No shimmer, node pulses, ambient drift, or animated data surfaces.
- [ ] Orbital rotation is off by default.
- [ ] Reduced motion removes all continuous motion and loses no information.

**Quality**
- [ ] Keyboard navigation and visible focus throughout, including the field.
- [ ] Every state that colour reinforces is also stated in text.
- [ ] Loading / empty / error states do not break the composition.
- [ ] Unbacked widgets carry a visible `PREVIEW` / `OFFLINE` marker; preview strings cannot be misread as real data.
- [ ] Real data replaces representative data wherever functionality exists.

---

# 15. Non-goals

Do not:

- Redesign the product concept, or introduce product entities, workflows, or capabilities from this document.
- Turn the product into a generic productivity dashboard, or replace the graph with a list-only UI.
- Add features to fill space, or decorative effects anywhere.
- Fabricate data, density, counts, freshness, or activity.
- Represent an unimplemented integration as functional.
- Create disconnected mock datasets once real data exists.
- Make every component glow, or every component a card.
- Sacrifice readability, accessibility, or performance for visual fidelity.
- Optimise for resembling the reference.
- Reinstate anything in §12.
- Rewrite existing application architecture without inspecting it first, or modify unrelated functionality while implementing visual work.

---

# 16. Technical decision boundary

This document specifies **visual intent and interaction behaviour**, not a technology stack.

Do **not** assume React, Next.js, Three.js, D3, WebGL, Canvas, SVG, a CSS framework, a database, or an AI provider. Select implementation technology only when required by the assigned task, based on the existing repository and project requirements.

For consequential technical decisions: inspect the repository, consider alternatives, choose the smallest suitable solution, record the decision if it materially affects architecture or maintainability, and **do not alter the visual target to accommodate a technology preference**.

---

# 17. Execution directive

When implementing against this document:

1. Read this entire document, plus `Claude_Project_Blueprint.md`, P2.1 and P2.2, before modifying UI.
2. Inspect the existing repository before making architectural assumptions.
3. Treat the **product blueprint** as authoritative and this document as visual direction only. `docs/reference-video-analysis.md` is evidence, not a target.
4. Preserve the explicit decisions in this document; do not invent product behaviour where it is silent.
5. Resolve nothing in §11 by assumption — raise it.
6. Keep visual primitives reusable and token-driven.
7. Use realistic developer-oriented data; never fabricate density.
8. Verify the rendered result, not only the source.
9. Test responsive, keyboard/focus, and reduced-motion behaviour.
10. Run the project's checks after implementation.
11. Stop when the assigned task is complete. Do not begin the next milestone.

---

# 18. Relationship to the master blueprint

The product is a persistent developer context layer for individual developers and small teams:

**Capture → Connect → Understand → Act**

It connects Ideas, Tasks, Notes, Decisions, Projects, Resources, and project context — and eventually external developer activity:

```text
GitHub issue → Project → Technical decision → Relevant notes → Next action
```

The visual design exists to make that connected-context model tangible. It supports the product strategy; it does not replace it, and it may not extend it.
