// InMemoryRetrievalProvider — the reference second implementation (P2.6 §11).
//
// Its whole purpose is to keep the seam honest (INV-11, INV-14): if the
// RetrievalProvider contract ever leaks a SQL fragment, a query object or a
// driver type, THIS file stops compiling. It is also what proves eligibility
// rule 1 is a property of the CONTRACT and not of Postgres — it pre-restricts
// using `canSeeObject`, the in-memory interpreter of the same VisibilityPolicy
// rule the SQL fragment is generated from (INV-3: one rule source, two
// interpreters).
//
// Not wired into the running system; used by the test suite and available to
// any consumer that needs retrieval without a datastore.

import type {
  FindSimilarInput,
  RetrievalHit,
  RetrievalProvider,
  TermEvidence,
} from '../../ports/retrieval.ts';
import type { ObjectId, WorkspaceId } from '../../domain/ids.ts';
import { canSeeObject, type ObjectVisibilityRow } from '../../domain/visibility.ts';

export interface InMemoryDocument extends ObjectVisibilityRow {
  readonly title: string;
  readonly body: string;
  readonly created_at: string;
}

const terms = (text: string): string[] => {
  const out = new Set<string>();
  for (const t of text.toLowerCase().split(/[^a-z0-9]+/)) if (t.length > 2) out.add(t);
  return [...out];
};

export function makeInMemoryRetrievalProvider(
  docs: readonly InMemoryDocument[],
): RetrievalProvider {
  let corpus = [...docs];
  return {
    async findSimilar({ scope, queryText, k }: FindSimilarInput): Promise<RetrievalHit[]> {
      const q = terms(String(queryText ?? ''));
      if (q.length === 0) return [];

      const hits: Array<RetrievalHit & { createdAt: string }> = [];
      for (const doc of corpus) {
        // Eligibility rule 1: pre-restrict to the scope. Same policy source as
        // the SQL provider, different interpreter.
        if (!canSeeObject(scope, doc)) continue;

        const title = (doc.title ?? '').toLowerCase();
        const body = (doc.body ?? '').toLowerCase();
        const evidence: TermEvidence[] = [];
        let score = 0;
        for (const term of q) {
          if (title.includes(term)) {
            evidence.push({ term, field: 'title' });
            score += 2; // title matches weigh more, as ts_rank also does
          } else if (body.includes(term)) {
            evidence.push({ term, field: 'body' });
            score += 1;
          }
        }
        if (score > 0) {
          hits.push({
            objectId: doc.id as ObjectId,
            score: score / (q.length * 2),
            evidence,
            createdAt: doc.created_at,
          });
        }
      }

      hits.sort(
        (a, b) =>
          b.score - a.score ||
          a.createdAt.localeCompare(b.createdAt) ||
          a.objectId.localeCompare(b.objectId),
      );
      return hits.slice(0, Math.max(1, k)).map(({ objectId, score, evidence }) => ({
        objectId,
        score,
        evidence,
      }));
    },

    /** No derived state to rebuild: the corpus handed in IS the source here. */
    async rebuild(_workspaceId: WorkspaceId): Promise<void> {
      corpus = [...corpus];
    },

    describe() {
      return { kind: 'lexical', version: 'in-memory-1' };
    },
  };
}
