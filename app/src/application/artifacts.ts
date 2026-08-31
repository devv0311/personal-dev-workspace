// Use case: the artifact feed behind the command centre's output orbit
// (T3.3-CORRECTION).
//
// WHAT REPLACED WHAT. The command view's perimeter used to carry six static
// capability circles — CAPTURE, SEARCH, CONNECT, ASK, EXTRACT TASKS,
// SUMMARIZE. They duplicated the Skills Deck, they were not data, and they are
// gone from the geometry and from the model. The orbit now carries OUTPUTS:
// things this system produced by doing work.
//
// Every artifact below is assembled from a record that already exists:
//
//   routine       ← outbox_event rows the worker actually delivered, named by
//                   the consumer that is genuinely registered for that type.
//   ci            ← workflow runs the forge reported.
//   pull_request  ← pull requests the forge reported.
//   issue         ← issues the forge reported.
//   ai_result     ← objects whose `attributes.createdVia` says a user kept an
//                   assistant proposal. The object is ours; the proposal was
//                   the model's; the decision to keep it was the user's.
//
// Three properties this file is responsible for:
//
//   1. NOTHING IS SEEDED. A source that produced nothing contributes nothing,
//      and an empty orbit is rendered as an empty orbit.
//   2. AUTHORIZATION HOLDS. Worker records and objects come from reads already
//      filtered by the one VisibilityPolicy; forge activity is public to the
//      workspace by configuration and carries no internal identifier unless an
//      anchor resolves through that same policy.
//   3. UNAVAILABLE ≠ EMPTY. A source that could not be read is reported as
//      unavailable with its own reason, alongside whatever the other sources
//      did produce.

import {
  objectArtifactRef,
  orderArtifacts,
  workerArtifactRef,
  type Artifact,
  type ArtifactCategory,
} from '../domain/artifacts.ts';
import { sectionOf, type ExternalKind } from '../domain/external.ts';
import type { ArtifactReadRepository, ObjectRepository } from '../ports/repositories.ts';
import type { ExternalActivityProvider } from '../ports/external-activity.ts';
import type { ResolvedScope } from '../domain/visibility.ts';
import type { WorkerActivityView } from './worker-activity.ts';

export interface ArtifactDeps {
  objects: ObjectRepository;
  external: ExternalActivityProvider;
  artifactReads: ArtifactReadRepository;
}

/** One source's condition, so the orbit can explain a gap rather than imply none. */
export interface ArtifactSourceStatus {
  readonly source: string;
  readonly ok: boolean;
  readonly reason: string | null;
}

export interface ArtifactFeed {
  readonly items: readonly Artifact[];
  readonly sources: readonly ArtifactSourceStatus[];
  /** How many of `items` this principal has not opened. Exact by construction. */
  readonly unread: number;
}

/** How many artifacts the orbit may carry. A view bound, never a security one. */
const DEFAULT_LIMIT = 14;

const FORGE_CATEGORY: Partial<Record<ExternalKind, ArtifactCategory>> = {
  workflow_run: 'ci',
  pull_request: 'pull_request',
  issue: 'issue',
};

/**
 * Assemble the feed.
 *
 * `worker` is passed in rather than re-read so the orbit and the Routines rail
 * are guaranteed to be describing the same execution records — one read, two
 * surfaces, no chance of the centre disagreeing with the panel beside it.
 */
export async function readArtifactFeed(
  deps: ArtifactDeps,
  scope: ResolvedScope,
  worker: WorkerActivityView,
  limit: number = DEFAULT_LIMIT,
): Promise<ArtifactFeed> {
  const items: Artifact[] = [];
  const sources: ArtifactSourceStatus[] = [];

  // --- background routines --------------------------------------------------
  // Only DELIVERED runs are outputs. A pending row is a queued event, not
  // something the system produced, and it is not dressed up as one.
  for (const run of worker.runs) {
    if (run.state !== 'delivered' || !run.routine) continue;
    items.push({
      id: workerArtifactRef(run.id),
      title: run.objectTitle ? `${run.routine} · ${run.objectTitle}` : run.routine,
      category: 'routine',
      source: 'outbox-worker',
      createdAt: run.at,
      objectId: run.objectId,
      url: null,
      state: 'delivered',
      detail: {
        event: run.event,
        consumer: run.routine,
        attempts: run.attempts,
      },
      unread: false,
    });
  }
  sources.push({ source: 'outbox-worker', ok: true, reason: null });

  // --- forge activity -------------------------------------------------------
  const snapshot = await deps.external.snapshot();
  const configured = deps.external.describe().configured;
  for (const kind of ['workflow_run', 'pull_request', 'issue'] as const) {
    const section = sectionOf(snapshot, kind);
    if (!section.ok) {
      sources.push({
        source: `${snapshot.source}:${kind}`,
        ok: false,
        reason: configured ? section.error : 'No repository is configured for this workspace.',
      });
      continue;
    }
    sources.push({ source: `${snapshot.source}:${kind}`, ok: true, reason: null });
    for (const e of section.entities) {
      // An entity with no instant cannot be placed on a time-ordered orbit and
      // is left out rather than given a fabricated one.
      if (!e.at) continue;
      items.push({
        id: e.ref,
        title: e.title,
        category: FORGE_CATEGORY[kind] ?? 'ci',
        source: snapshot.source,
        createdAt: e.at,
        objectId: null,
        url: e.url,
        state: e.state,
        detail: { ...e.detail, ...(e.actor ? { actor: e.actor } : {}) },
        unread: false,
      });
    }
  }

  // --- AI results -----------------------------------------------------------
  // Objects a user kept from an assistant proposal. Read through the ordinary
  // visibility-filtered repository, so this can never surface another
  // principal's object.
  const objects = await deps.objects.listVisible(scope);
  for (const o of objects) {
    if (o.attributes['createdVia'] !== 'assistant_proposal') continue;
    items.push({
      id: objectArtifactRef(o.id),
      title: o.title || '(untitled)',
      category: 'ai_result',
      source: 'devworkspace',
      createdAt: o.createdAt,
      objectId: o.id,
      url: null,
      state: o.type,
      detail: {
        type: o.type,
        createdVia: 'assistant_proposal',
        ...(typeof o.attributes['sourceObjectId'] === 'string'
          ? { sourceObjectId: o.attributes['sourceObjectId'] }
          : {}),
      },
      unread: false,
    });
  }
  sources.push({ source: 'devworkspace', ok: true, reason: null });

  const ordered = orderArtifacts(items).slice(0, Math.max(1, limit));
  // Read state is personal: this is the caller's own row set, keyed by the
  // artifact's stable ref, so opening one marks it read for them alone.
  const read = await deps.artifactReads.readRefs(
    scope,
    ordered.map((a) => a.id),
  );
  const withState = ordered.map((a) => ({ ...a, unread: !read.has(a.id) }));

  return {
    items: withState,
    sources,
    unread: withState.filter((a) => a.unread).length,
  };
}

export async function markArtifactRead(
  deps: ArtifactDeps,
  scope: ResolvedScope,
  ref: string,
): Promise<void> {
  await deps.artifactReads.markRead(scope, ref);
}
