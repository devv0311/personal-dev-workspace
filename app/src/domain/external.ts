// External activity domain (T3.3.1). Pure — no I/O, no driver, no fetch.
//
// DEVWORKSPACE owns its own objects. An external system (here: GitHub) supplies
// ACTIVITY that happened somewhere else, and nothing more. The rules this module
// exists to enforce:
//
//   1. External activity is NEVER promoted into the authoritative object model.
//      A commit is not a Note; a pull request is not a Task. Nothing in this
//      file constructs a WorkspaceObject, and no writer imports it.
//   2. Every external entity keeps the identity its own system gave it, in a
//      canonical, stable form (`sourceRef`), so the same commit is the same
//      commit across a refetch, a restart and a rename.
//   3. Internal and external objects are joined ONLY through that reference —
//      an internal object records the ref it is anchored to
//      (`object.attributes.externalRef`), and the join is a lookup, not a copy.
//   4. Absence is a first-class state. A section that could not be read says so;
//      it never degrades into an empty list that reads as "nothing happened".

/** The only external source this milestone integrates. */
export const EXTERNAL_SOURCES = ['github'] as const;
export type ExternalSource = (typeof EXTERNAL_SOURCES)[number];

/**
 * The kinds of external entity we normalise. Deliberately closed: a kind is
 * added here only when something real is fetched for it.
 */
export const EXTERNAL_KINDS = [
  'repository',
  'contributor',
  'commit',
  'branch',
  'pull_request',
  'issue',
  'workflow_run',
] as const;
export type ExternalKind = (typeof EXTERNAL_KINDS)[number];

/**
 * A stable external identity: `github:commit:<sha>`, `github:pull_request:42`.
 *
 * The external id is whatever the source system considers permanent (a SHA, a
 * number, a login, `owner/repo`) — never a title, never a position in a list,
 * never something we minted. Two fetches of the same entity produce the same
 * ref, which is what makes the internal ↔ external join stable.
 */
export function sourceRef(
  source: ExternalSource,
  kind: ExternalKind,
  externalId: string,
): string {
  return `${source}:${kind}:${externalId}`;
}

/** Parse a ref back into its parts, or null when it is not one of ours. */
export function parseSourceRef(
  ref: unknown,
): { source: ExternalSource; kind: ExternalKind; externalId: string } | null {
  if (typeof ref !== 'string') return null;
  const first = ref.indexOf(':');
  if (first < 0) return null;
  const second = ref.indexOf(':', first + 1);
  if (second < 0) return null;
  const source = ref.slice(0, first);
  const kind = ref.slice(first + 1, second);
  const externalId = ref.slice(second + 1);
  if (!externalId) return null;
  if (!(EXTERNAL_SOURCES as readonly string[]).includes(source)) return null;
  if (!(EXTERNAL_KINDS as readonly string[]).includes(kind)) return null;
  return {
    source: source as ExternalSource,
    kind: kind as ExternalKind,
    externalId,
  };
}

/**
 * One normalised external entity.
 *
 * Every field is copied from the source payload or omitted. There is no default
 * that invents a value: an unknown author is `null`, not "unknown"; an absent
 * timestamp is `null`, not `now()`. A consumer that renders a null must render
 * the absence.
 */
export interface ExternalEntity {
  /** Canonical stable identity — `sourceRef(...)`. */
  readonly ref: string;
  readonly source: ExternalSource;
  readonly kind: ExternalKind;
  /** The id in the source system (SHA, number, login, `owner/repo`). */
  readonly externalId: string;
  /** The source system's own title/subject line. Never synthesised. */
  readonly title: string;
  /** Who did it, as the source system names them. `null` when it does not. */
  readonly actor: string | null;
  /** ISO instant the source system recorded, or null when it recorded none. */
  readonly at: string | null;
  /** The source system's own state word (`open`, `merged`, `success`, …). */
  readonly state: string | null;
  /** Canonical URL in the source system, so any row is verifiable by a human. */
  readonly url: string | null;
  /**
   * Extra source-reported facts, copied verbatim. Only values the source
   * actually returned appear here.
   */
  readonly detail: Readonly<Record<string, string | number | boolean | null>>;
}

/**
 * The outcome of reading ONE section of an external source.
 *
 * `ok: false` is not an empty section. A caller must be able to tell "the
 * repository has no issues" from "we could not read the issues", because
 * rendering the second as the first is exactly the fabrication this milestone
 * removes.
 */
export type ExternalSection =
  | {
      readonly ok: true;
      readonly kind: ExternalKind;
      readonly entities: readonly ExternalEntity[];
      /** Total the source reports, when it reports one and it exceeds the page. */
      readonly total: number | null;
    }
  | {
      readonly ok: false;
      readonly kind: ExternalKind;
      /** Why it is unavailable, in words a user can act on. Never a stack trace. */
      readonly error: string;
    };

/** How the snapshot was authenticated. Reported so a rate limit is explicable. */
export type ExternalAuthMode = 'authenticated' | 'anonymous';

/**
 * A whole read of an external source at one instant.
 *
 * `fetchedAt` is the instant the network read completed — it is the freshness
 * the UI displays, and it is never advanced by serving a cached copy. `stale`
 * says a refetch was attempted and failed, so the reader knows the age is now
 * unbounded rather than bounded by the cache TTL.
 */
export interface ExternalSnapshot {
  readonly source: ExternalSource;
  /** `owner/repo` — the repository this snapshot describes. */
  readonly repository: string;
  readonly authMode: ExternalAuthMode;
  readonly fetchedAt: string;
  readonly stale: boolean;
  /** Present only when a refetch failed and a previous snapshot is being served. */
  readonly staleReason: string | null;
  readonly sections: Readonly<Record<string, ExternalSection>>;
}

/** A section, or a typed absence — never an exception at the call site. */
export function sectionOf(
  snapshot: ExternalSnapshot,
  kind: ExternalKind,
): ExternalSection {
  return (
    snapshot.sections[kind] ?? {
      ok: false,
      kind,
      error: 'Not requested.',
    }
  );
}

/** Entities of a section, or `[]` when the section is unavailable. Callers that
 *  must distinguish the two read `.ok` first — this is for counting displays
 *  that already render the unavailable state separately. */
export function entitiesOf(
  snapshot: ExternalSnapshot,
  kind: ExternalKind,
): readonly ExternalEntity[] {
  const s = sectionOf(snapshot, kind);
  return s.ok ? s.entities : [];
}
