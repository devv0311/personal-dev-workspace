// Artifact domain (T3.3-CORRECTION). Pure.
//
// An ARTIFACT is an OUTPUT: something the system produced by doing work —
// a background routine that ran, a CI run that finished, a pull request that
// exists on the forge, an object the assistant proposed and a user kept.
//
// What an artifact is NOT:
//   • It is not a capability. The command centre's perimeter used to carry six
//     static capability circles (CAPTURE / SEARCH / CONNECT / ASK / EXTRACT
//     TASKS / SUMMARIZE). Those are things you can DO, they duplicated the
//     Skills Deck, and they are gone — from the geometry and from the model.
//   • It is not a decorative particle. A particle carries no id, no title, no
//     timestamp and no handler; an artifact carries all four and every one of
//     them came from a real record.
//   • It is not seeded. If a source produced nothing, the orbit is empty and
//     says so. Nothing here manufactures an artifact to fill a ring.

/**
 * The categories that actually exist in this system, and the source that
 * produces each. A category is added here only when something real emits it.
 */
export const ARTIFACT_CATEGORIES = [
  'routine', // an outbox-worker consumer ran and the event was delivered
  'ci', // a workflow run recorded by the forge
  'pull_request', // a pull request on the forge
  'issue', // an issue on the forge
  'ai_result', // an object created from an assistant proposal, kept by a user
] as const;
export type ArtifactCategory = (typeof ARTIFACT_CATEGORIES)[number];

/** Human wording for a category. Colour never carries the class alone (§4.13). */
export const ARTIFACT_CATEGORY_LABEL: Readonly<Record<ArtifactCategory, string>> = {
  routine: 'Routine output',
  ci: 'CI run',
  pull_request: 'Pull request',
  issue: 'Issue',
  ai_result: 'AI result',
};

/**
 * One produced artifact.
 *
 * `id` is a stable reference, not a position: `worker:<eventId>`,
 * `github:pull_request:18`, `object:<uuid>`. The same artifact keeps the same
 * id across reloads, which is what makes per-person read state meaningful and
 * what ties an orbit node to the object or the source it came from.
 */
export interface Artifact {
  readonly id: string;
  readonly title: string;
  readonly category: ArtifactCategory;
  /** The system that produced it, in its own name: `outbox-worker`, `github`. */
  readonly source: string;
  /** ISO instant the artifact was produced. Never synthesised. */
  readonly createdAt: string;
  /** The internal object this artifact concerns, when it concerns one. */
  readonly objectId: string | null;
  /** A URL a human can open to verify it, when the source has one. */
  readonly url: string | null;
  /** The source's own state word (`success`, `open`, `merged`, `delivered`). */
  readonly state: string | null;
  /** Extra source-reported facts, copied verbatim. Only real fields appear. */
  readonly detail: Readonly<Record<string, string | number | boolean | null>>;
  /** Whether THIS principal has opened it. Per person, never global. */
  readonly unread: boolean;
}

/** Stable reference for an artifact produced by the outbox worker. */
export const workerArtifactRef = (eventId: string): string => `worker:${eventId}`;
/** Stable reference for an artifact that IS an internal object. */
export const objectArtifactRef = (objectId: string): string => `object:${objectId}`;

/**
 * Newest first, with a stable tie-break so two artifacts produced in the same
 * millisecond never swap places between renders.
 */
export function orderArtifacts(items: readonly Artifact[]): Artifact[] {
  return [...items].sort(
    (a, b) => String(b.createdAt).localeCompare(String(a.createdAt)) || a.id.localeCompare(b.id),
  );
}
