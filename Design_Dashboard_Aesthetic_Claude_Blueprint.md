# Design Blueprint — Agentic Developer Workspace
## Strict Visual & Interaction Specification for Claude Code

**Purpose:** This document is an implementation-facing design blueprint for the project's visual direction. Treat it as the authoritative visual target for the Agentic Developer Workspace UI. It is derived from the supplied Rubric Agentic OS / Second Brain reference screens and the project's product blueprint. Do not invent missing design decisions where this document is explicit. Where the document intentionally leaves implementation choices open, inspect the existing repository and make the smallest technically appropriate choice without changing the visual intent.

---

# 0. DESIGN MANDATE

Build a dark-mode, futuristic **Agentic Operating System Dashboard / Developer Command Center** for a persistent developer context layer.

The visual target is the supplied reference interface:

- Deep black / dark-charcoal canvas.
- High-density command-center / HUD composition.
- Thin structural borders.
- Restrained neon accents.
- Dense network/particle visualization.
- Compact information panels.
- Circular and hexagonal geometry.
- Technical/data-oriented typography.
- Small uppercase labels.
- Status dots, progress indicators, timelines, and compact controls.
- Subtle ambient animation.
- Strong visual hierarchy despite high information density.

The resulting application should feel like:

> **a developer command center + living knowledge graph**

It must NOT visually collapse into:

- A generic SaaS dashboard.
- A conventional admin panel.
- A Notion-style workspace.
- A generic AI chat interface.
- A dashboard made from ordinary rounded cards with excessive whitespace.

The visualization is part of the product interaction model, not decorative background art.

---

# 1. REFERENCE INTERPRETATION

Two reference screens establish the visual target.

## Reference A — Main Command Center

The reference presents:

- A central, dominant circular visualization.
- An orbital ring populated with circular icons/badges.
- A dense point-cloud / constellation-like center.
- Fine connection lines inside the visualization.
- Left-side utility/intelligence widgets.
- Right-side utility/intelligence widgets.
- A restrained top identity/navigation area.
- High information density.
- Dark background with orange as a major action/identity accent.
- Small technical labels and metadata.
- Compact controls and status indicators.

The central visualization occupies most of the visual attention.

The surrounding panels provide operational context.

## Reference B — Interactive Second Brain

The reference presents:

- A large concentric orbital graph.
- A central root/context node.
- Multiple semantic layers/orbits.
- Dense memory/context particles.
- Department/category labels.
- A routines orbit.
- An applications orbit.
- A right-side control panel.
- Search.
- Layout selectors.
- View filters.
- Physics/animation controls.
- Expand/collapse controls.
- Interactive graph exploration.

This second screen should inform the application's **context graph / second-brain mode**.

---

# 2. GLOBAL CANVAS

## 2.1 Background

Use a near-black base.

Target range:

- `#050505`
- `#0A0A0A`

Do not use a bright dark-gray background.

The canvas should read as nearly black, with visual structure emerging through:

- Fine borders.
- Low-opacity geometry.
- Controlled glow.
- Particles.
- Accent highlights.

A subtle technical/grid texture may be used where appropriate, but it must remain extremely low contrast and must never compete with the information layer.

## 2.2 Density

The interface is intentionally information-dense.

Do not create large empty dashboard regions merely to follow conventional SaaS design patterns.

Density should come from:

- Compact panels.
- Small metadata.
- Status indicators.
- Graph nodes.
- Fine lines.
- Orbital geometry.
- Compact lists.
- Data grids.

Density must remain legible.

Do not achieve density by making text unreadably small.

---

# 3. COLOR SYSTEM

Color has semantic meaning.

Use these roles consistently:

| Semantic role | Visual treatment |
|---|---|
| Primary action / active state | Orange |
| Applications / external systems | Cyan / electric blue |
| Memory / knowledge / context | Purple |
| Routines / automation | Amber / yellow |
| Primary information | White |
| Secondary information | Gray / muted white |
| Error / blocker | Red |

Orange should be the strongest recurring accent in the main command center.

Cyan/blue should identify the application/external-system layer.

Purple should identify memory/context.

Amber/yellow should identify routines.

Do not use every accent color everywhere.

Saturation should be concentrated around meaningful elements.

---

# 4. GLOW SYSTEM

Use glow sparingly.

Three conceptual levels:

### Level 0 — Structural
No visible glow.

Used for:

- Ordinary borders.
- Inactive labels.
- Secondary metadata.
- Static structural elements.

### Level 1 — Ambient
Subtle glow.

Used for:

- Graph atmosphere.
- Orbital rings.
- Active system layers.
- Important visualization boundaries.

### Level 2 — Active
Noticeable but controlled glow.

Used for:

- Selected node.
- Active control.
- Primary action.
- Current state.
- Focused object.

Do NOT make every panel, border, icon, and label glow simultaneously.

The reference aesthetic depends on contrast between quiet structure and selective illumination.

---

# 5. GEOMETRY

Favor:

- Circles.
- Rings.
- Hexagons.
- Thin radial lines.
- Fine network edges.
- Compact rectangular/HUD controls.

Avoid excessive use of:

- Large rounded SaaS cards.
- Giant pill controls.
- Soft neumorphic surfaces.
- Conventional dashboard tiles with heavy shadows.

Panels may use subtle corner treatment and restrained rounding where technically useful, but the overall geometry should remain technical and structured.

---

# 6. TYPOGRAPHY

Typography should communicate technical/system-oriented information.

## 6.1 Primary UI Typography

Use a highly legible UI typeface.

Hierarchy should primarily come from:

- Size.
- Weight.
- Opacity.
- Letter spacing.
- Position.

Do not depend on many colors to establish hierarchy.

## 6.2 Display / Section Typography

Section labels should resemble the reference:

- Uppercase.
- Compact.
- Technical.
- Slightly expanded letter spacing.
- Strong but restrained weight.

Examples:

- `MICRO TOOLS`
- `PROJECT PULSE`
- `ATTENTION`
- `SKILLS DECK`
- `ROUTINES`
- `APPLICATIONS`
- `MEMORY`

## 6.3 Monospace

Use monospace/data-oriented typography for:

- IDs.
- Timestamps.
- Commands.
- Status values.
- Technical metadata.
- Model/effort indicators.
- System labels where appropriate.

Do not make the entire UI monospace if doing so damages readability.

---

# 7. MAIN COMMAND CENTER COMPOSITION

## 7.1 Overall Layout

Desktop composition:

```text
┌──────────────────────────────────────────────────────────────┐
│                         TOP HEADER                           │
├──────────────┬──────────────────────────────┬───────────────┤
│              │                              │               │
│    LEFT      │       CENTRAL CONTEXT        │     RIGHT     │
│ INTELLIGENCE │        VISUALIZER            │ INTELLIGENCE  │
│     RAIL     │                              │     RAIL      │
│              │                              │               │
│              │                              │               │
└──────────────┴──────────────────────────────┴───────────────┘
```

Target desktop proportions:

- Left: approximately 24%.
- Center: approximately 52%.
- Right: approximately 24%.

These proportions are visual targets, not permission to force a technically broken layout.

The center must remain visually dominant.

On large desktop/ultrawide displays, prioritize an immersive full-viewport command-center composition.

---

# 8. TOP HEADER

Keep the header visually restrained.

Potential elements:

- Product mark.
- Product name.
- Current workspace/project.
- Search trigger.
- Command palette trigger.
- Context/graph mode toggle.
- System/notification status.
- User/workspace control.

Do not build a tall conventional SaaS navbar.

The header should frame the command center rather than dominate it.

---

# 9. CENTRAL CONTEXT VISUALIZER

This is the visual centerpiece.

## 9.1 Composition

Target structure:

```text
                 ○ ○ ○ ○ ○ ○ ○
             ○                   ○
          ○                         ○
        ○       NETWORK FIELD         ○
       ○                              ○
       ○         PARTICLE CORE        ○
        ○                             ○
          ○                         ○
             ○                   ○
                 ○ ○ ○ ○ ○ ○ ○
```

## 9.2 Orbital Ring

The primary ring should contain circular nodes representing developer context and outputs.

Potential object types:

- Projects.
- Tasks.
- Notes.
- Decisions.
- Ideas.
- Resources.
- External activity.
- Generated artifacts.

Each node should have:

- Compact icon.
- Contextual accent.
- Optional metadata/badge.
- Hover state.
- Selection state.

The visual treatment should resemble the reference's circular orbital badges.

## 9.3 Internal Network

Inside the orbit:

- Fine relationship lines.
- Dense network structure.
- Particle/point-cloud field.
- Context clusters.
- Subtle depth/scale variation where supported.

Do not make all connections equally visible.

Inactive relationships should be low contrast.

When an object is focused, related connections should become more prominent.

## 9.4 Particle Core

The central point-cloud/constellation is a major visual motif.

It represents accumulated developer context.

It should feel:

- Dense.
- Organic.
- Computational.
- Alive.
- Data-driven.

It should not look like a generic 3D decorative sphere.

## 9.5 Interaction

Required behaviors:

- Hover node.
- Highlight node.
- Select node.
- Focus node.
- Zoom.
- Pan.
- Context inspection.
- Relationship highlighting.
- Search-to-node.
- Filtering.
- Expand/collapse where applicable.

Interaction should clarify context rather than simply animate.

---

# 10. LEFT INTELLIGENCE RAIL

The left rail adapts the reference's operational widgets to developer workflows.

## 10.1 Micro Tools

Reference concept: "Micro Apps."

Adapt to developer-oriented tools.

Example:

```text
MICRO TOOLS

⌘  Capture
   Save context instantly                         →

◈  GitHub
   Repository activity                            →

▣  Terminal
   Recent commands/context                        →

◇  Docs
   Project documentation                          →

＋ ADD TOOL
```

Each row should contain:

- Icon.
- Name.
- One-line description.
- Optional shortcut/status.
- Right-side action indicator.

The list should remain compact.

## 10.2 Developer Activity

Adapt the reference's calendar/time widget.

Display information such as:

- Current time.
- Current project.
- Current work session.
- Recent activity.
- Today/yesterday activity.
- "What's next."
- Recently touched context.

Example:

```text
TODAY

09:42   auth refactor
11:16   PR #184
13:02   database decision
15:41   captured note

WHAT'S NEXT

→ Review authentication PR
→ Resolve database migration task
```

The widget should preserve the reference's dense information character.

## 10.3 Project Pulse

Adapt the reference's analytics/studio widget.

Example:

```text
PROJECT PULSE

AUTH SERVICE

24      OPEN TASKS
07      ACTIVE
03      BLOCKED

CONTEXT ACTIVITY

● ● ● ○ ● ● ●
● ● ● ● ○ ● ○
● ● ● ● ● ● ●
```

Use:

- Large numeric values.
- Small category labels.
- Compact activity/status grids.
- Minimal explanatory prose.

---

# 11. RIGHT INTELLIGENCE RAIL

## 11.1 Developer Attention

Replace the reference's email panel.

Purpose: surface information requiring attention.

Potential sources:

- GitHub activity.
- Blocked tasks.
- Important decisions.
- Team activity.
- Stale work.
- AI-detected relevant changes.

Example:

```text
ATTENTION

12  ITEMS NEED REVIEW

⚡  PR #184 — authentication
    18m ago

◉  Decision conflict detected
    database architecture

◆  3 tasks blocked
    payment-service

TODAY'S MIX

████████████
TASKS  PROJECT  TEAM  SYSTEM
```

Use compact rows, timestamps, and semantic status markers.

## 11.2 Skills Deck

Preserve the reference's compact 2×N actionable-card structure.

Example:

```text
SKILLS DECK                         + ADD

┌────────────────┐ ┌────────────────┐
│ /summarize     │ │ /plan          │
│ OPUS · HIGH    │ │ SONNET · HIGH  │
│                │ │                │
│      ▶  ○      │ │      ▶  ○      │
└────────────────┘ └────────────────┘

┌────────────────┐ ┌────────────────┐
│ /capture       │ │ /handoff       │
│ SONNET · MED   │ │ OPUS · HIGH    │
│                │ │                │
│      ▶  ○      │ │      ▶  ○      │
└────────────────┘ └────────────────┘
```

Cards should be compact and information-dense.

The action trigger should eventually execute a real workspace action rather than remaining decorative.

Do not introduce arbitrary skills not supported by the product requirements merely to populate the UI. Seed data may use representative examples until real functionality exists.

## 11.3 Routines Monitor

Preserve the reference timeline-table pattern.

Example:

```text
ROUTINES

TIME     ROUTINE                  STATUS

09:00    context-index            ✓ FIRED
11:30    github-sync              ✓ FIRED
14:00    project-summary          NEXT
16:30    stale-task-check         QUEUED
18:00    daily-recap              QUEUED
```

Use:

- Compact rows.
- Status indicators.
- Runner/source badges.
- Highlighted next execution.
- Scrollable content where required.

---

# 12. SECOND-BRAIN / CONTEXT-GRAPH MODE

The second reference establishes a separate but related visualization mode.

The application should support a rich context graph experience.

## 12.1 Semantic Layers

Use the following conceptual hierarchy.

### Core

`WORKSPACE / ROOT CONTEXT`

This is the central router/root context.

### Inner Context Layer

Represent:

- Projects.
- Tasks.
- Decisions.
- Notes.
- Ideas.
- Resources.

### Memory Field

Individual context objects can appear as particles/nodes.

### Routine Orbit

Represents automated routines/workflows.

### Application Orbit

Represents connected tools and external systems, such as:

- GitHub.
- IDE.
- Terminal.
- Documentation.
- Communication systems.
- Other integrations once actually implemented.

Do not claim an integration is functional merely because its icon appears in seed data.

## 12.2 Visual Hierarchy

Conceptual arrangement:

```text
                    APPLICATIONS
               ─────────────────────
             ○   ○   ○   ○   ○   ○

                    ROUTINES
              ───────────────────

                     MEMORY
          ┌─────────────────────────┐
          │                         │
          │   departments/folders   │
          │                         │
          │      CONTEXT            │
          │        ↓                │
          │     PROJECTS            │
          │        ↓                │
          │     WORKSPACE           │
          └─────────────────────────┘
```

The exact number of rings, node counts, and physics behavior should be derived from the available data and technical implementation constraints. Do not invent additional semantic layers without a product reason.

---

# 13. GRAPH INTERACTION MODEL

A graph node is an entry point into context.

Example:

```text
CLICK DECISION

        ↓

Highlight related objects

        ↓

Project
   ↙       ↘
Tasks     Notes
   ↓
GitHub PR
```

Required interaction concepts:

- Pan.
- Zoom.
- Rotate/orbit where appropriate to the chosen rendering model.
- Node hover.
- Node selection.
- Focus.
- Expand/collapse.
- Relationship highlighting.
- Search-to-node.
- Filtering.
- Project/category filtering.
- Object inspection.
- Context traversal.

The exact implementation mechanism is a technical decision, not a visual decision.

The visual behavior must remain consistent with the reference.

---

# 14. GRAPH CONTROL PANEL

Replicate the reference's compact floating right-side control panel.

Conceptual structure:

```text
┌────────────────────────────┐
│ Search context...           │
├────────────────────────────┤
│ LAYOUT                      │
│ [Force] [Circle] [Hex] [Rings]
│                            │
│ VIEW                        │
│ [Projects] [Folders]        │
│                            │
│ PHYSICS                     │
│ Ring spin     ─────●──      │
│ Link spring   ─●──────      │
│ Node size     ───●───       │
│                            │
│ [EXPAND ALL] [COLLAPSE ALL] │
│                            │
│ [APPLY / BAKE SETTINGS]     │
└────────────────────────────┘
```

The exact physics controls should only be exposed if the underlying graph implementation actually supports them.

Do not create non-functional controls simply to imitate the screenshot.

---

# 15. CONTEXT INSPECTOR

Selecting a node should expose its actual context.

Example:

```text
DECISION

PostgreSQL chosen for persistence

PROJECT
payments-service

CREATED
Aug 21, 2026

RELATED
4 Tasks
7 Notes
2 PRs

WHY IT MATTERS
...
```

Potential actions:

- Open.
- Edit.
- Connect.
- Ask AI.
- Create task.

The inspector must be connected to the underlying object when real data exists.

Do not create separate inspector-only data.

---

# 16. VISUAL SEMANTICS OF DATA

The UI should communicate the distinction between:

### Developer Context
Projects, tasks, notes, decisions, ideas, resources.

### Memory
Stored context and relationships.

### Automation
Routines and scheduled/agentic actions.

### Applications
External systems and developer tools.

### Activity
Recent events and state changes.

Use the semantic color system consistently across these categories.

---

# 17. MOTION

Motion is part of the identity but must remain subtle.

## 17.1 Ambient Motion

Potential effects:

- Particle drift.
- Orbital rotation.
- Connection shimmer.
- Occasional node pulses.
- Ambient graph movement.

Motion should make the interface feel alive.

It must never interfere with reading or interaction.

## 17.2 Interaction Motion

Use motion for:

- Node focus.
- Panel transitions.
- Context expansion.
- Search-result focus.
- Filtering.
- Command execution feedback.
- Selection state.

Motion should communicate state changes, not exist merely as visual spectacle.

## 17.3 Reduced Motion

Respect user accessibility preferences such as reduced-motion settings.

When reduced motion is enabled:

- Disable or substantially reduce continuous particle movement.
- Disable unnecessary orbit animation.
- Preserve selection/focus transitions only when useful.
- Maintain the same information hierarchy without relying on animation.

---

# 18. RESPONSIVE BEHAVIOR

## 18.1 Desktop

Primary target:

- 1440p.
- 1600p.
- Ultrawide desktop displays.

The full command-center composition should be preserved where space allows.

## 18.2 Laptop

When width becomes constrained:

- Allow left rail to collapse.
- Allow right rail to collapse.
- Preserve the central visualization.
- Convert side panels into drawers/overlays where appropriate.

Do not simply shrink every element until it becomes unreadable.

## 18.3 Mobile

Do not force the full three-column command center onto a phone.

Use a sequential information model:

```text
Header
↓
Context summary
↓
Primary graph
↓
Attention
↓
Tasks
↓
Capture
```

Graph controls can become bottom-sheet or overlay controls.

The mobile interface should preserve the product's visual identity without attempting to reproduce desktop geometry literally.

---

# 19. COMPONENT BEHAVIOR

Common components should share a consistent language.

Examples:

- HUD panel.
- Section header.
- Metric block.
- Status dot.
- Timeline row.
- Skill/action card.
- Orbital node.
- Graph edge.
- Filter control.
- Slider.
- Search field.
- Context inspector.
- Activity row.
- Command trigger.

Do not create independent visual implementations of the same concept on different screens.

---

# 20. STATES

Every major component should account for:

- Default.
- Hover.
- Focus.
- Active.
- Selected.
- Disabled.
- Loading.
- Empty.
- Error.
- Success where applicable.

States should use the same semantic color/glow rules.

Do not use animation as the only indication of state.

---

# 21. ACCESSIBILITY

Preserve the aesthetic while maintaining usability.

Required considerations:

- Keyboard navigation.
- Visible focus state.
- Sufficient text contrast.
- Non-color state indicators.
- Accessible names for icon-only controls.
- Reduced-motion support.
- Logical reading/navigation order.
- Usable controls despite dense layout.

Do not sacrifice basic accessibility solely to reproduce a visual effect.

---

# 22. DATA AUTHENTICITY

The interface should progressively transition from representative data to real data.

During early visual development:

- Seed data is acceptable.
- Data should use realistic developer terminology.
- Avoid lorem ipsum.
- Avoid meaningless random numbers.

When functionality exists:

**Use the same underlying data object everywhere.**

For example, a project shown in:

- Dashboard.
- Graph.
- Search.
- Task view.
- AI assistant.

must represent the same project.

Do not maintain disconnected fake datasets merely because they make a widget easier to render.

---

# 23. PRODUCT-VISUAL RELATIONSHIP

The visualization must reinforce the product's core loop:

```text
CAPTURE
   ↓
CONNECT
   ↓
UNDERSTAND
   ↓
ACT
```

The UI should make these relationships visible.

Example:

```text
CAPTURE
Create note
   ↓
CONNECT
Associate with project/decision
   ↓
UNDERSTAND
See related context in graph / ask AI
   ↓
ACT
Create or complete task
```

This is the underlying product direction; the visual system must make it tangible.

---

# 24. SIGNATURE INTERACTION

The most important graph interaction should be:

> **Select any piece of developer context and see the network of things that gives it meaning.**

Example:

```text
AUTH DECISION
     │
 ┌───┼────────────┐
 │   │            │
Project        Notes
 │              │
Tasks          Resources
 │
GitHub PR
```

The value is not "having a beautiful graph."

The graph exists to answer:

- What am I working on?
- What is related?
- What changed?
- Why is this relevant?
- What should I do next?
- Where did this information come from?

If a visual effect does not improve comprehension, orientation, interaction, or system feedback, it should not be added solely for spectacle.

---

# 25. IMPLEMENTATION SEQUENCE

Implement visual development in the following order.

## Stage A — Static Visual Shell

Build:

- Near-black canvas.
- Three-column desktop composition.
- Header.
- Left panels.
- Right panels.
- Central graph placeholder.
- Typography.
- Borders.
- Semantic accent system.
- Glow system.
- Responsive behavior.

Acceptance:

The application should already look recognizably like the reference aesthetic before functional data exists.

## Stage B — Realistic Seed Data

Populate representative:

- Projects.
- Tasks.
- Notes.
- Decisions.
- Resources.
- Activities.
- Routines.
- External-system representations where relevant.

Do not represent unimplemented integrations as functional.

## Stage C — Interactive Graph

Replace placeholder graph with:

- Nodes.
- Relationships.
- Particles.
- Orbiting layers.
- Hover.
- Selection.
- Filtering.
- Zoom/pan.
- Context inspection.

## Stage D — Dashboard Integration

Connect all widgets to the same underlying data model.

Do not create independent widget-specific fake state when real data is available.

## Stage E — End-to-End Context Loop

Demonstrate:

```text
CAPTURE
   ↓
Create note
   ↓
CONNECT
   ↓
Associate with context
   ↓
UNDERSTAND
   ↓
See graph + relevant context
   ↓
ACT
   ↓
Create/complete task
```

---

# 26. STRICT NON-GOALS FOR VISUAL IMPLEMENTATION

Do not:

- Redesign the product concept.
- Turn the product into a generic productivity dashboard.
- Replace the graph with a conventional list-only UI.
- Add arbitrary features merely to fill empty space.
- Add decorative neon effects everywhere.
- Add fake integrations and imply they are functional.
- Create disconnected mock datasets once real data exists.
- Make every component glow.
- Make every component a rounded card.
- Sacrifice readability for visual density.
- Sacrifice accessibility for visual fidelity.
- Choose a technology stack solely because this design resembles a particular implementation.
- Rewrite existing application architecture without inspecting it first.
- Modify unrelated product functionality while implementing the visual system.

---

# 27. TECHNICAL DECISION BOUNDARY

This document specifies **visual intent and interaction behavior**, not a mandatory technology stack.

Do NOT assume:

- React.
- Next.js.
- Three.js.
- D3.
- WebGL.
- Canvas.
- SVG.
- A particular CSS framework.
- A particular database.
- A particular AI provider.

Select implementation technology only when required by the assigned task and based on the existing repository and project requirements.

For consequential technical decisions:

1. Inspect the existing repository.
2. Consider appropriate alternatives.
3. Choose the smallest suitable solution.
4. Record the decision briefly if it materially affects architecture or maintainability.
5. Do not alter the visual target merely to accommodate a technology preference.

---

# 28. CLAUDE CODE EXECUTION DIRECTIVE

When implementing this design:

1. Read this entire document before modifying UI.
2. Inspect the existing repository before making architectural assumptions.
3. Treat the supplied reference screens as the visual reference.
4. Treat this document as the written interpretation of that reference.
5. Preserve explicit visual decisions in this document.
6. Do not invent product behavior where the document does not specify it.
7. Do not silently introduce unrelated functionality.
8. If an implementation detail is genuinely unspecified, choose the smallest appropriate implementation consistent with the existing codebase and document the decision only if consequential.
9. Keep visual development aligned with the project's vertical-slice strategy.
10. Use realistic developer-oriented data.
11. Keep visual primitives reusable.
12. Verify the rendered result rather than relying only on source-code inspection.
13. Test responsive behavior.
14. Test keyboard/focus behavior.
15. Test reduced-motion behavior where applicable.
16. Run relevant project checks after implementation.
17. Stop when the assigned task is complete.
18. Do not automatically begin the next milestone.

---

# 29. VISUAL ACCEPTANCE CHECKLIST

A visual milestone is ready for review only when:

## Composition
- [ ] Three-column command-center composition is established.
- [ ] Central visualization is visually dominant.
- [ ] Left and right rails feel integrated rather than bolted on.
- [ ] Header remains restrained.

## Aesthetic
- [ ] Background is near-black.
- [ ] Structural borders are thin and restrained.
- [ ] Orange is the primary action accent.
- [ ] Cyan/blue identifies applications/external systems.
- [ ] Purple identifies memory/context.
- [ ] Amber identifies routines.
- [ ] Glow is selective.
- [ ] Typography has technical/HUD character.
- [ ] Interface remains information-dense but legible.

## Central Visualization
- [ ] Orbital structure exists.
- [ ] Context nodes are visually distinct.
- [ ] Network relationships are visible.
- [ ] Particle/point-cloud field establishes the second-brain character.
- [ ] Hover/selection states work.
- [ ] Focus/zoom/pan work where assigned.
- [ ] Context inspection works where assigned.

## Panels
- [ ] Micro Tools follows the reference's compact list structure.
- [ ] Developer Activity preserves the reference's dense temporal-widget character.
- [ ] Project Pulse uses compact metrics/status visualization.
- [ ] Developer Attention replaces the email concept without losing the reference structure.
- [ ] Skills Deck preserves the compact actionable-card structure.
- [ ] Routines preserves the compact timeline-table structure.

## Second Brain
- [ ] Semantic graph layers are distinguishable.
- [ ] Memory/context is visually differentiated.
- [ ] Routines have their own semantic layer.
- [ ] Applications have their own semantic layer.
- [ ] Control surface follows the reference's compact HUD treatment.
- [ ] Inspector exposes meaningful context for selected nodes.

## Interaction
- [ ] Search can focus/reveal relevant context when assigned.
- [ ] Selection highlights relationships.
- [ ] Filtering changes the graph meaningfully.
- [ ] Controls reflect actual supported behavior.
- [ ] No decorative controls falsely imply functionality.

## Responsive
- [ ] Desktop command center works at target resolutions.
- [ ] Laptop side rails can collapse appropriately.
- [ ] Mobile uses a sequential information model rather than a shrunken desktop layout.

## Quality
- [ ] Keyboard/focus behavior is usable.
- [ ] Reduced-motion behavior is respected.
- [ ] Empty/loading/error states do not break the visual system.
- [ ] No major visual regressions.
- [ ] Real data replaces mock data wherever functionality exists.

---

# 30. RELATIONSHIP TO THE MASTER PROJECT BLUEPRINT

The product's underlying concept is a persistent developer context layer:

**Capture → Connect → Understand → Act**

It serves individual developers and small development teams.

The system is intended to connect:

- Ideas.
- Tasks.
- Notes.
- Decisions.
- Projects.
- Learning/resources.
- Project context.
- Eventually external developer activity.

Example:

```text
GitHub issue
     ↓
Project
     ↓
Technical decision
     ↓
Relevant notes
     ↓
Next action
```

The visual design must make this connected-context model tangible without prematurely implementing every future capability.

The design therefore exists to support the product strategy, not replace it.

---

# 31. DEFAULT IMPLEMENTATION PRINCIPLE

When forced to choose between:

A. A visually impressive effect that adds little product value.

B. A less flashy interaction that makes developer context easier to understand.

Choose **B**.

When forced to choose between:

A. A conventional SaaS pattern that is easier to implement.

B. The established command-center/HUD interaction pattern that is explicitly defined here.

Choose **B**, unless accessibility, performance, or technical constraints make it materially harmful.

When something is unspecified:

**Do not invent a product decision. Inspect the repository, preserve the established direction, and make the smallest reversible implementation choice.**

---

# 32. FINAL VISUAL TARGET

The finished product should feel like a **living operating environment for a developer's accumulated context**.

At a glance:

- The central graph communicates relationships.
- The surrounding rails communicate current operational state.
- Orange communicates action.
- Purple communicates memory.
- Amber communicates automation.
- Cyan communicates external systems.
- Dense particles communicate accumulated context.
- Orbital structures communicate connected layers.
- Compact HUD panels communicate system state.

The user should be able to move from:

**"What is happening?"**

to:

**"What is this connected to?"**

to:

**"Why does it matter?"**

to:

**"What should I do?"**

without leaving the environment.

The visual language should remain coherent across the command center and second-brain views.

Do not reduce the design to a collection of screenshots recreated as static components. Reproduce the underlying visual grammar, hierarchy, semantic color system, density, geometry, and interaction model.
