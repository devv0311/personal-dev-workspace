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

## Current task: T3.1 — Reference UI Reconstruction

Reconstruct the supplied reference interface as closely as practical in composition, proportions, spacing, density, hierarchy, geometry, typography, borders, controls, panels, graph/radial treatment, interaction patterns, transitions, and overall visual character. The visual source of truth is the material under `reference/` plus `docs/reference-video-analysis.md`.

Keep the product context as DEVWORKSPACE: translate reference-specific labels and content into the developer workspace domain without inventing new capabilities. Read the blueprints and progress constraints before changing UI. Inspect the existing app first, verify rendered states and responsive behaviour, and use `docs/visual-qa/T3.1-reference-ui-checklist.md` as the acceptance gate.

## Worktree safety

- The checkout may contain intentional uncommitted source, test, documentation, and screenshot changes. Preserve them; never reset, discard, or overwrite unrelated work.
- Do not expose, commit, or modify secrets. `app/.env` is ignored and must remain untracked.
- Keep the reference videos and derived reference frames read-only during implementation.
- Complete only the assigned T3.1 task, then stop and report verification results.
