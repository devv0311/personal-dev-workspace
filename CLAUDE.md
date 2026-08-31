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

## Current task: T3.3 — Live Data + Reference-System Integration (implemented, awaiting review)

Replace synthetic/demo/preview data with real project data while preserving the reference-replicated UI. Delivered: live GitHub activity for `devv0311/personal-dev-workspace` behind a read-only `ExternalActivityProvider` seam; demo identities (`Alice`/`Bob`) removed from all production data and UI; Routines connected to real outbox-worker execution records; Skills Deck executability made a state; the internal ↔ external join through `object.attributes.externalRef`. See `docs/PROGRESS.md` § *T3.3* for the full record and verification.

The composition itself is locked: do not redesign the rails, the central visualisation, the second-brain projection, the Skills Deck, the micro-app surfaces or the particle atmosphere, and do not simplify any of it toward a conventional SaaS dashboard.

## Standing data-honesty rules

These now govern every surface and must not regress:

- **GitHub supplies external activity only.** DEVWORKSPACE remains authoritative for notes, tasks, decisions, captured context, relationships and AI-generated context. Join the two through stable source references (`github:<kind>:<id>`), never by importing one into the other.
- **Every displayed value has a real source.** No fabricated counts, activity, identities, artifacts, routine history, model badges, email rows or repository state.
- **A count is printed only when it is exact**; an unknown total is rendered as an absence, not as the size of the page in hand.
- **Unavailable ≠ empty.** A surface that could not read its source says so, with the reason; it never degrades into an empty list.
- **Executability is a state.** A control is pressable only while the thing behind it can actually run.
- **Every semantic node in the Second Brain is traceable to a real object.** Decorative particles carry no id, count, label or handler.
- **Authorization is never bypassed for a new surface.** Every read composes the one `VisibilityPolicy` fragment — including counts, which leak volume if left unscoped.

## Worktree safety

- The checkout may contain intentional uncommitted source, test, documentation, and screenshot changes. Preserve them; never reset, discard, or overwrite unrelated work.
- Do not expose, commit, or modify secrets. `app/.env` is ignored and must remain untracked. `GITHUB_TOKEN` is read server-side only and must never reach a response or the browser.
- Keep the reference videos and derived reference frames read-only during implementation.
- Complete only the assigned task, then stop and report verification results. A milestone is COMPLETED only when the user explicitly accepts it — never self-accept.
