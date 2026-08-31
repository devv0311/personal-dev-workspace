// Use case: external repository activity, joined to the objects it concerns
// (T3.3.1).
//
// The contract, restated where it is enforced rather than only where it is
// documented:
//
//   • GitHub is NOT the system of record. This use case reads external activity
//     and reads internal objects. It writes nothing, creates nothing, and
//     cannot cause an object to exist. There is no import, no sync and no
//     reconciliation path anywhere in the codebase.
//   • The two worlds meet at ONE place: an internal object may record the
//     external identity it is anchored to (`object.attributes.externalRef`),
//     and `links` resolves those anchors. External activity therefore points at
//     internal objects; internal objects are never derived from it.
//   • The join is authorized. Anchors are resolved through the ordinary
//     visibility-filtered repository, so a link can only ever name an object the
//     caller could already open. A public repository does not become a side
//     channel into a private project.
//   • Nothing is fabricated when the source is unavailable. The snapshot's own
//     per-section `ok` / `error` states are passed through untouched, so the UI
//     can distinguish "the repository has no open issues" from "we could not
//     read the issues".

import type {
  ExternalAuthMode,
  ExternalSection,
  ExternalSnapshot,
  ExternalSource,
} from '../domain/external.ts';
import { entitiesOf, sectionOf } from '../domain/external.ts';
import type { ExternalActivityProvider } from '../ports/external-activity.ts';
import type { ObjectRepository } from '../ports/repositories.ts';
import type { ResolvedScope } from '../domain/visibility.ts';

export interface ExternalActivityDeps {
  objects: ObjectRepository;
  external: ExternalActivityProvider;
}

/** One resolved internal ↔ external anchor. */
export interface ExternalLink {
  /** The external identity, e.g. `github:repository:owner/name`. */
  readonly ref: string;
  readonly objectId: string;
  readonly objectType: string;
  readonly objectTitle: string;
}

export interface ExternalActivityView {
  readonly source: ExternalSource;
  readonly repository: string;
  /** Canonical URL of the repository itself, when the source reported one. */
  readonly repositoryUrl: string | null;
  readonly configured: boolean;
  readonly authMode: ExternalAuthMode;
  /** When the underlying network read completed. Never advanced by a cache hit. */
  readonly fetchedAt: string;
  readonly stale: boolean;
  readonly staleReason: string | null;
  readonly sections: Readonly<Record<string, ExternalSection>>;
  readonly links: readonly ExternalLink[];
}

/** Every stable reference the snapshot mentions, de-duplicated. */
function refsIn(snapshot: ExternalSnapshot): string[] {
  const refs = new Set<string>();
  for (const section of Object.values(snapshot.sections)) {
    if (!section.ok) continue;
    for (const e of section.entities) refs.add(e.ref);
  }
  return [...refs];
}

export async function readExternalActivity(
  deps: ExternalActivityDeps,
  scope: ResolvedScope,
): Promise<ExternalActivityView> {
  const snapshot = await deps.external.snapshot();

  // The internal side of the join, filtered by the same policy as every other
  // read. An unmatched reference simply produces no link — an external entity
  // is never asserted to correspond to an internal object on a guess.
  const anchors = await deps.objects.listVisibleByExternalRef(scope, refsIn(snapshot));
  const links: ExternalLink[] = anchors.flatMap((o) => {
    const ref = o.attributes['externalRef'];
    return typeof ref === 'string'
      ? [{ ref, objectId: o.id, objectType: o.type, objectTitle: o.title }]
      : [];
  });

  const repo = sectionOf(snapshot, 'repository');

  return {
    source: snapshot.source,
    repository: snapshot.repository,
    repositoryUrl: repo.ok ? (repo.entities[0]?.url ?? null) : null,
    configured: deps.external.describe().configured,
    authMode: snapshot.authMode,
    fetchedAt: snapshot.fetchedAt,
    stale: snapshot.stale,
    staleReason: snapshot.staleReason,
    sections: snapshot.sections,
    links,
  };
}

/**
 * Open pull requests, counted only when the count is knowable.
 *
 * The pull-request section is fetched with `state=all` on one page. When that
 * page is provably the whole set (`total` is exact) the open ones can be
 * counted exactly. When it is not, the honest answer is `null` — "we are
 * looking at part of the list" — and the caller must render an unknown, never a
 * partial count dressed up as a total.
 */
export function openPullRequestCount(snapshot: ExternalSnapshot): number | null {
  const section = sectionOf(snapshot, 'pull_request');
  if (!section.ok || section.total === null) return null;
  return entitiesOf(snapshot, 'pull_request').filter((p) => p.state === 'open').length;
}
