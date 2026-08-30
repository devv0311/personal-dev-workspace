// The Context Engine — ContextSet assembly (P2.6 §10, P2.2 §6–7).
//
// This is the TRUSTED half of the trust chain (P2.3 §15):
//   User → Assistant (untrusted generator) → Context Engine (trusted) → Workspace
//
// The assistant has no datastore access and no graph traversal of its own; a
// ContextSet is the ONLY context input it ever receives (P2.3 §6). Everything
// that protects the user's privacy therefore has to hold HERE, not in the
// assistant and not in the UI.
//
// Pipeline order (P2.6 §10.4, non-negotiable — no step operates on unfiltered
// data):
//   resolve ResolvedScope  (done by the caller, once per request)
//     → retrieval, pre-restricted to that scope by the provider
//     → re-check every hit with canSee            (defence in depth)
//     → expand one hop through visibility-filtered relationships
//     → dedupe to the strongest path
//     → assign layers → per-layer caps
//     → rank with a TOTAL order (deterministic)
//     → attach factor traces + provenance → return
//
// Scope of this milestone: `direct` / `recent` / `high_confidence` layers over
// a 1-hop expansion. The 2-hop recursive CTE, ranking_weight_set rows and
// suggestion-derived candidates stay deferred (P2.6 §10.4/§10.5) — none of them
// is needed for the P3.4 slice, and building them speculatively is exactly what
// the milestone brief rules out.

import type { ObjectRepository, RelationshipRepository } from '../ports/repositories.ts';
import type { RetrievalProvider } from '../ports/retrieval.ts';
import type { ResolvedScope } from '../domain/visibility.ts';
import { canSeeObject } from '../domain/visibility.ts';
import type { WorkspaceObject } from '../domain/objects.ts';
import type { RelationshipEdge } from '../domain/relationships.ts';
import { asObjectId, asProjectId } from '../domain/ids.ts';

export interface ContextSetDeps {
  objects: ObjectRepository;
  relationships: RelationshipRepository;
  retrieval: RetrievalProvider;
}

export type ContextPurpose = 'question' | 'summarize' | 'extract_tasks';
export type ContextLayer = 'direct' | 'recent' | 'high_confidence';

/** The version of the assembly + ranking rules. Bump when either changes. */
export const WEIGHT_SET_VERSION = 'p3.4-lexical-1';

/** Bounded sets — there is no user-facing pagination (P2.6 §10.6). */
export const LAYER_CAPS: Readonly<Record<ContextLayer, number>> = {
  direct: 8,
  high_confidence: 6,
  recent: 6,
};

/**
 * The score ladder. Ordering these coherently is what makes the ranked set
 * mean something: the thing the user asked about must outrank the thing that
 * merely CONTAINS it, and a direct match must outrank context reached through
 * it. Discovered by the evaluation set — before this, the home project
 * outranked the recent work for "what was I working on?", so the anchor
 * answered a question nobody asked.
 */
const SCORE = {
  /** The user explicitly selected this object. Nothing outranks that. */
  target: 1,
  /** A direct retrieval match; the provider's opaque score refines within band. */
  retrievalBase: 0.7,
  /** Recent work, when nothing else anchors the turn. Decays by position. */
  recencyBase: 0.5,
  /** Reached by a known / user-confirmed relationship. */
  relationshipStrong: 0.4,
  /** Reached by a weaker relationship. */
  relationshipWeak: 0.25,
  /** The containing project: supporting context, never the answer itself. */
  anchor: 0.2,
} as const;

export interface RankingFactor {
  readonly factor: 'retrieval' | 'anchor' | 'relationship' | 'recency' | 'target';
  readonly weight: number;
}

export interface ContextItemRef {
  readonly id: string;
  readonly type: string;
  readonly title: string;
}

export interface ContextItem {
  readonly object: {
    readonly id: string;
    readonly type: string;
    readonly title: string;
    readonly body: string;
    readonly homeProjectId: string | null;
    readonly ownerId: string;
    readonly createdAt: string;
    readonly updatedAt: string;
  };
  /** Typed edges that placed this item, each with its confidence + provenance. */
  readonly viaRelationships: ReadonlyArray<{
    readonly verb: string;
    readonly direction: 'out' | 'in';
    readonly confidenceState: string;
    readonly origin: string;
    readonly provenanceKind: string;
    readonly other: ContextItemRef | null;
  }>;
  readonly layer: ContextLayer;
  readonly rank: number;
  readonly factorTrace: readonly RankingFactor[];
}

export interface ContextSet {
  readonly ok: true;
  readonly weightSetVersion: string;
  readonly purpose: ContextPurpose;
  readonly layersPresent: readonly ContextLayer[];
  readonly items: readonly ContextItem[];
  readonly generatedAt: string;
  /** What the engine understood the request to be about, for the UI + audit. */
  readonly resolved: {
    readonly queryText: string;
    readonly targetId: string | null;
    readonly projectId: string | null;
  };
}

export interface ContextUnavailable {
  readonly ok: false;
  readonly reason: 'retrieval_failed' | 'target_not_found';
  readonly detail: string;
}

export type ContextSetResult = ContextSet | ContextUnavailable;

export interface ContextSetRequest {
  readonly purpose: ContextPurpose;
  readonly queryText: string;
  /** Optional anchor: an object the user already has selected. */
  readonly targetId?: string | null;
}

interface Candidate {
  object: WorkspaceObject;
  layer: ContextLayer;
  score: number;
  factors: RankingFactor[];
  via: ContextItem['viaRelationships'][number][];
}

const LAYER_PRIORITY: Record<ContextLayer, number> = {
  direct: 0,
  high_confidence: 1,
  recent: 2,
};

const toItemObject = (o: WorkspaceObject): ContextItem['object'] => ({
  id: o.id,
  type: o.type,
  title: o.title,
  body: o.body,
  homeProjectId: o.homeProjectId,
  ownerId: o.ownerId,
  createdAt: o.createdAt,
  updatedAt: o.updatedAt,
});

/**
 * Assemble the evidence set for one assistant turn.
 *
 * Returns `Unavailable` — a DISTINCT result from an empty set (P2.6 §10.3).
 * An empty set means "nothing matched, and that is a fact about the workspace";
 * Unavailable means "the engine could not answer". The assistant must treat
 * them differently: it may answer "I found nothing" for the first, and must
 * refuse to answer at all for the second.
 */
export async function assembleContextSet(
  deps: ContextSetDeps,
  scope: ResolvedScope,
  request: ContextSetRequest,
): Promise<ContextSetResult> {
  const queryText = String(request.queryText ?? '').trim();
  const candidates = new Map<string, Candidate>();

  const add = (
    object: WorkspaceObject,
    layer: ContextLayer,
    score: number,
    factors: RankingFactor[],
    via: ContextItem['viaRelationships'][number][] = [],
  ) => {
    const existing = candidates.get(object.id);
    if (!existing) {
      candidates.set(object.id, { object, layer, score, factors, via });
      return;
    }
    // Dedupe to the STRONGEST path: keep the best layer and the best score,
    // but never lose provenance — merge the edges that reached it.
    if (LAYER_PRIORITY[layer] < LAYER_PRIORITY[existing.layer]) existing.layer = layer;
    if (score > existing.score) existing.score = score;
    for (const f of factors) {
      if (!existing.factors.some((e) => e.factor === f.factor)) existing.factors.push(f);
    }
    for (const v of via) {
      if (!existing.via.some((e) => e.verb === v.verb && e.other?.id === v.other?.id)) {
        existing.via.push(v);
      }
    }
  };

  // --- anchor: an explicitly selected object -------------------------------
  let target: WorkspaceObject | null = null;
  if (request.targetId) {
    target = await deps.objects.findVisible(scope, asObjectId(request.targetId));
    if (!target) {
      // Deny-by-default: invisible and absent are indistinguishable, and we do
      // not disclose which it was (P2.3 §11 — "not available to you").
      return {
        ok: false,
        reason: 'target_not_found',
        detail: 'The selected context is not available to you.',
      };
    }
    add(target, 'direct', SCORE.target, [{ factor: 'target', weight: SCORE.target }]);
  }

  // --- retrieval: pre-restricted to the scope by the provider --------------
  let hits: Awaited<ReturnType<RetrievalProvider['findSimilar']>> = [];
  if (queryText) {
    try {
      hits = await deps.retrieval.findSimilar({ scope, queryText, k: 12 });
    } catch (err) {
      // A retrieval failure is Unavailable, never an empty set: the assistant
      // must not answer from model priors in this case (P2.3 §6).
      return {
        ok: false,
        reason: 'retrieval_failed',
        detail: err instanceof Error ? err.message : 'retrieval failed',
      };
    }
  }

  for (const hit of hits) {
    const object = await deps.objects.findVisible(scope, hit.objectId);
    // Defence in depth (P2.5 §15.5): re-check every provider hit against the
    // policy. A provider bug must not be able to widen the set.
    if (!object) continue;
    if (!canSeeObject(scope, { id: object.id, workspace_id: object.workspaceId, owner_id: object.ownerId, home_project_id: object.homeProjectId })) {
      continue;
    }
    add(object, 'direct', SCORE.retrievalBase + hit.score, [
      { factor: 'retrieval', weight: hit.score },
    ]);
  }

  // --- one-hop expansion through visibility-filtered relationships ---------
  // `forObject` already applies visible(from) ∧ visible(to) ∧ edge-rule, so the
  // expansion cannot pull in an object the principal may not see.
  const seeds = [...candidates.values()].map((c) => c.object);
  for (const seed of seeds) {
    let edges: RelationshipEdge[];
    try {
      edges = await deps.relationships.forObject(scope, seed.id);
    } catch {
      continue;
    }
    for (const edge of edges) {
      const outgoing = edge.fromObjectId === seed.id;
      const otherId = outgoing ? edge.toObjectId : edge.fromObjectId;
      if (candidates.has(otherId)) {
        // Already present — still record the edge so provenance is complete.
        const existing = candidates.get(otherId)!;
        const ref: ContextItemRef = { id: seed.id, type: seed.type, title: seed.title };
        if (!existing.via.some((v) => v.verb === edge.verb && v.other?.id === seed.id)) {
          existing.via.push({
            verb: edge.verb,
            direction: outgoing ? 'in' : 'out',
            confidenceState: edge.confidenceState,
            origin: edge.origin,
            provenanceKind: edge.provenance.kind,
            other: ref,
          });
        }
        continue;
      }
      const other = await deps.objects.findVisible(scope, otherId);
      if (!other) continue;
      const strong = edge.confidenceState === 'known' || edge.confidenceState === 'user_confirmed';
      const relScore = strong ? SCORE.relationshipStrong : SCORE.relationshipWeak;
      add(
        other,
        strong ? 'high_confidence' : 'recent',
        relScore,
        [{ factor: 'relationship', weight: relScore }],
        [
          {
            verb: edge.verb,
            direction: outgoing ? 'out' : 'in',
            confidenceState: edge.confidenceState,
            origin: edge.origin,
            provenanceKind: edge.provenance.kind,
            other: { id: seed.id, type: seed.type, title: seed.title },
          },
        ],
      );
    }
  }

  // --- recent context, when nothing else anchored the turn ------------------
  // "What was I working on?" has no useful search terms; recency IS the signal.
  if (candidates.size === 0) {
    const visible = await deps.objects.listVisible(scope);
    const recent = visible
      .filter((o) => o.type !== 'project')
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.id.localeCompare(a.id))
      .slice(0, LAYER_CAPS.recent);
    // Decay by position so the most recent work leads, deterministically.
    recent.forEach((o, i) => {
      const score = SCORE.recencyBase - i * 0.01;
      add(o, 'recent', score, [{ factor: 'recency', weight: score }]);
    });
  }

  // --- project anchor: the home project of what we found --------------------
  const projectId =
    target?.type === 'project'
      ? target.id
      : ([...candidates.values()].find((c) => c.object.homeProjectId)?.object.homeProjectId ?? null);
  if (projectId && !candidates.has(projectId)) {
    const project = await deps.objects.findVisible(scope, asObjectId(projectId));
    if (project) {
      add(project, 'high_confidence', SCORE.anchor, [{ factor: 'anchor', weight: SCORE.anchor }]);
    }
  }

  // --- layer caps, then a deterministic TOTAL order --------------------------
  const byLayer = new Map<ContextLayer, Candidate[]>();
  for (const c of candidates.values()) {
    const list = byLayer.get(c.layer) ?? [];
    list.push(c);
    byLayer.set(c.layer, list);
  }

  const kept: Candidate[] = [];
  for (const [layer, list] of byLayer) {
    list.sort(
      (a, b) =>
        b.score - a.score ||
        a.object.createdAt.localeCompare(b.object.createdAt) ||
        a.object.id.localeCompare(b.object.id),
    );
    kept.push(...list.slice(0, LAYER_CAPS[layer]));
  }

  // Determinism requires a total order (P2.6 §10.5). The final id term
  // guarantees totality, so the same inputs always produce the same set.
  kept.sort(
    (a, b) =>
      b.score - a.score ||
      LAYER_PRIORITY[a.layer] - LAYER_PRIORITY[b.layer] ||
      a.object.createdAt.localeCompare(b.object.createdAt) ||
      a.object.id.localeCompare(b.object.id),
  );

  const items: ContextItem[] = kept.map((c, i) => ({
    object: toItemObject(c.object),
    viaRelationships: c.via,
    layer: c.layer,
    rank: i + 1,
    factorTrace: c.factors,
  }));

  const layersPresent = [...new Set(items.map((i) => i.layer))].sort(
    (a, b) => LAYER_PRIORITY[a] - LAYER_PRIORITY[b],
  );

  return {
    ok: true,
    weightSetVersion: WEIGHT_SET_VERSION,
    purpose: request.purpose,
    layersPresent,
    items,
    generatedAt: new Date().toISOString(),
    resolved: {
      queryText,
      targetId: target?.id ?? null,
      projectId: projectId ? asProjectId(projectId) : null,
    },
  };
}
