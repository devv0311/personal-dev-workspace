// RetrievalProvider port (P2.6 §11, P2.5 §13.3, INV-1).
//
// The seam that makes lexical → hybrid → semantic a swap of implementation and
// nothing else. Storage-neutral BY CONSTRUCTION: no SQL fragment, no query
// object, no driver type appears here, so an out-of-process provider could
// implement it without knowing the datastore.
//
// Binding eligibility rules carried over from P2.5 §13.3:
//   1. The provider RECEIVES the visibility scope and MUST pre-restrict its
//      results to it. A provider that can only return a global top-K the caller
//      must filter afterwards is ineligible.
//   2. `score` is opaque and never enters the ContextSet contract — it is one
//      input to the engine ranker, nothing more.
//   3. `evidence` is provider-shaped and optional to consumers.
//   4. Swapping providers changes only adapters/retrieval/ and its wiring.

import type { ObjectId, WorkspaceId } from '../domain/ids.ts';
import type { ResolvedScope } from '../domain/visibility.ts';

/** Provider-shaped support for why a hit matched. Consumers may ignore it. */
export interface TermEvidence {
  readonly term: string;
  readonly field: 'title' | 'body';
}

export interface RetrievalHit {
  readonly objectId: ObjectId;
  /** Opaque provider score. NEVER surfaced in the ContextSet contract. */
  readonly score: number;
  readonly evidence: readonly TermEvidence[];
}

export interface FindSimilarInput {
  /** The caller's per-request visibility snapshot (P2.6 §9.2). */
  readonly scope: ResolvedScope;
  readonly queryText: string;
  readonly k: number;
}

export interface RetrievalProvider {
  /** MUST return only object ids the given visibility scope admits. */
  findSimilar(input: FindSimilarInput): Promise<RetrievalHit[]>;

  /** INV-6: documented, runnable rebuild from authoritative rows. */
  rebuild(workspaceId: WorkspaceId): Promise<void>;

  describe(): { kind: 'lexical' | 'hybrid' | 'semantic'; version: string };
}
