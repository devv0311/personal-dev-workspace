// Relationship domain model (P2.6 §8, INV-2). Pure.
//
// Relationships are first-class: typed, directional, with author, provenance,
// confidence, and their own visibility scope. They are NOT foreign keys.
//
// P2.6 §8.2 — `belongs_to` has two uses:
//   • "home context" (target = Project): stored as object.home_project_id (FK),
//     and *surfaced* through the relationship read model as a synthesised edge
//     so no consumer special-cases the FK.
//   • "anchor to the active work item" (target = Task or Project): a real
//     relationship row. (Not exercised by this slice — no Tasks yet — but the
//     read model and storage support it.)
//
// P2.6 §8.3 — structural edges (shared project, same owner, …) are computed on
// read, never stored. The authoritative table stores 'explicit'/'user_confirmed'.

import type { ObjectId, PrincipalId, RelationshipId, WorkspaceId } from './ids.ts';

export const RELATIONSHIP_VERBS = [
  'belongs_to',
  'derived_from',
  'explains',
  'caused_by',
  'blocked_by',
  'next_action_for',
  'follows_from',
  'related_to',
  'references',
  'supersedes',
] as const;
export type RelationshipVerb = (typeof RELATIONSHIP_VERBS)[number];

export type RelationshipOrigin = 'explicit' | 'user_confirmed' | 'structural';
export type ConfidenceState =
  | 'known'
  | 'user_confirmed'
  | 'inferred_high'
  | 'weak';
export type VisibilityScope = 'shared' | 'private';

export interface Provenance {
  readonly kind: string;
  readonly detail: Readonly<Record<string, unknown>>;
}

export interface RelationshipEdge {
  readonly id: RelationshipId | null; // null ⇒ synthesised (not persisted as a row)
  readonly workspaceId: WorkspaceId;
  readonly fromObjectId: ObjectId;
  readonly toObjectId: ObjectId;
  readonly verb: RelationshipVerb;
  readonly origin: RelationshipOrigin;
  readonly confidenceState: ConfidenceState;
  readonly authorId: PrincipalId | null;
  readonly visibilityScope: VisibilityScope;
  readonly provenance: Provenance;
  readonly createdAt: string;
  readonly synthesised: boolean;
}
