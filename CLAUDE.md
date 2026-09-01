# Claude Project Routing

## Read first

1. `Claude_Project_Blueprint.md` — master execution blueprint and project contract.
2. `Design_Dashboard_Aesthetic_Claude_Blueprint.md` — canonical visual and interaction direction.
3. `docs/reference-video-analysis.md` — evidence and observed reference behaviour.
4. `reference/REFERENCE.md` — curated reference inventory, video locations, and extracted frames.
5. `docs/PROGRESS.md` — current decisions, constraints, and readiness state.

## Implementation and evidence

- `app/` — application source, package scripts, and runtime boundaries.
- `app/test/` — automated tests; preserve and extend them only when the assigned task requires it.
- `app/docs/screenshots/` — existing implementation screenshots and milestone evidence; these are not substitutes for the reference assets.
- `docs/visual-qa/` — visual acceptance checklist for the current task.
- `docs/design/` — design-document index; canonical design content remains in the root blueprint to avoid duplication.

## Current task: T3.3-CORRECTION — Command Centre Architecture, Identity, Attention, Mail (implemented, awaiting review)

A correction pass over T3.3. The composition is unchanged; four architectures
and the identity model underneath them were corrected. Delivered:

- **Dev is the workspace head**, as data — a `workspace_membership.role` of
  `owner`, at most one per workspace, read back through `/api/me`. The current
  user and the head are two different facts and the UI states both. Headship
  grants no extra visibility and no access to anyone's mailbox.
- **The six static capability circles are removed** from the command view's
  orbit — from the geometry and from the model — and replaced by real
  **artifacts** (delivered routines, CI runs, pull requests, issues, kept
  assistant proposals) with stable ids, real timestamps, per-person read state,
  hover timestamps and a detail modal.
- **The Second Brain is a radial sector tree**: a hub, a skills ring, one
  angular sector per real project, and that project's context on its own spokes.
  Sector Focus dims unrelated branches to 0.15 from hover, selection or keyboard.
- **The Attention Stack** replaces the dead e-mail placeholder: one triage queue
  fed by many sources, each stating its own condition.
- **Per-user mail accounts** — provider-agnostic OAuth 2.0 + PKCE, credentials
  sealed at rest, multiple accounts per user, scoped so headship grants nothing.
- **Skills model/effort configuration** that reflects what the runtime can
  actually execute and refuses what it cannot.

See `docs/PROGRESS.md` § *T3.3-CORRECTION* for the full record and verification.

The composition itself is locked: do not redesign the rails, the central
visualisation, the second-brain projection, the Skills Deck, the micro-app
surfaces or the particle atmosphere, and do not simplify any of it toward a
conventional SaaS dashboard.

## Standing data-honesty rules

These now govern every surface and must not regress:

- **GitHub supplies external activity only.** DEVWORKSPACE remains authoritative for notes, tasks, decisions, captured context, relationships and AI-generated context. Join the two through stable source references (`github:<kind>:<id>`), never by importing one into the other.
- **Every displayed value has a real source.** No fabricated counts, activity, identities, artifacts, routine history, model badges, email rows or repository state.
- **A count is printed only when it is exact**; an unknown total is rendered as an absence, not as the size of the page in hand.
- **Unavailable ≠ empty.** A surface that could not read its source says so, with the reason; it never degrades into an empty list.
- **Executability is a state.** A control is pressable only while the thing behind it can actually run.
- **Every semantic node in the Second Brain is traceable to a real object.** Decorative particles carry no id, count, label or handler.
- **Authorization is never bypassed for a new surface.** Every read composes the one `VisibilityPolicy` fragment — including counts, which leak volume if left unscoped.
- **Identity is two facts, never one.** Who heads the workspace and who is signed in are read separately from real rows, and headship confers no visibility.
- **A mailbox belongs to the person who connected it.** Mail reads are scoped by principal, never by workspace membership or headship, and a credential is sealed before storage and never returned.
- **A configuration control shows what will actually run.** A model or effort the runtime does not support is visibly unavailable and is refused server-side.

## Worktree safety

- The checkout may contain intentional uncommitted source, test, documentation, and screenshot changes. Preserve them; never reset, discard, or overwrite unrelated work.
- Do not expose, commit, or modify secrets. `app/.env` is ignored and must remain untracked. `GITHUB_TOKEN` is read server-side only and must never reach a response or the browser.
- Keep the reference videos and derived reference frames read-only during implementation.
- Complete only the assigned task, then stop and report verification results. A milestone is COMPLETED only when the user explicitly accepts it — never self-accept.
