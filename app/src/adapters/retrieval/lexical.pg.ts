// LexicalRetrievalProvider — PostgreSQL FTS (P2.6 §11, P2.5 §13.3).
//
// Queries the DERIVED `object_fts` index that the outbox worker has been
// maintaining since P2.7 but which nothing has ever read. This milestone gives
// it its first consumer; it does NOT introduce a second knowledge store.
//
// Eligibility rule 1 (P2.5 §13.3) is satisfied structurally: the same
// `objectSqlFragment` every other read composes is composed into the retrieval
// query itself, so the provider pre-restricts to the scope and never returns a
// global top-K for the caller to filter afterwards. The engine additionally
// re-checks each hit with `canSee` (defence in depth, P2.6 §9 / P2.5 §15.5).
//
// Why lexical and not a vector store: P2.5 selected lexical-only MVP retrieval
// with this seam as the upgrade path, contingent on the G1–G4 gates. Adding an
// embedding store now would contradict an accepted architecture decision and
// duplicate the context model. Semantic behaviour in P3.4 comes from query
// UNDERSTANDING at the assistant boundary (natural language → search terms),
// not from a second index. Swapping to a semantic provider later touches only
// this directory and its wiring.

import type { UnitOfWork } from '../../ports/repositories.ts';
import type {
  FindSimilarInput,
  RetrievalHit,
  RetrievalProvider,
  TermEvidence,
} from '../../ports/retrieval.ts';
import type { WorkspaceId } from '../../domain/ids.ts';
import { asObjectId } from '../../domain/ids.ts';
import { objectSqlFragment } from '../../domain/visibility.ts';

const MAX_K = 50;

/**
 * Postgres `websearch_to_tsquery` accepts free user text safely (no operator
 * injection), which is why it is used rather than `to_tsquery`.
 *
 * But it ANDs bare terms by default, and that is wrong for questions. A user
 * asking "why did we choose token bucket?" reduces to `choose token bucket`,
 * and requiring ALL of those to appear means the note actually titled "Chose
 * token bucket over sliding window" does not match at all — the answer then
 * silently falls back to whatever was most recent. (Found by running the real
 * system, not by a unit test: the pipeline was healthy, the recall was not.)
 *
 * So terms are OR-ed and `ts_rank` does the discriminating: documents matching
 * more of the query rank higher, and partial matches stay reachable instead of
 * being dropped. Phrase queries are the trade-off; recall matters more here.
 */
const TS_QUERY = `websearch_to_tsquery('english', $QP)`;

/** Free text → an OR expression websearch_to_tsquery understands. */
export function toOrQuery(queryText: string): string {
  const terms = [
    ...new Set(
      String(queryText ?? '')
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((t) => t.length > 2),
    ),
  ];
  return terms.join(' or ');
}

interface HitRow {
  object_id: string;
  score: number;
  title: string;
  body: string;
}

/** Lowercased distinct alphanumeric terms in the query, for evidence marking. */
function queryTerms(queryText: string): string[] {
  const seen = new Set<string>();
  for (const raw of queryText.toLowerCase().split(/[^a-z0-9]+/)) {
    if (raw.length > 2) seen.add(raw);
  }
  return [...seen];
}

/** Which query terms actually appear in the matched text — provider-shaped. */
function evidenceFor(terms: readonly string[], row: HitRow): TermEvidence[] {
  const title = (row.title ?? '').toLowerCase();
  const body = (row.body ?? '').toLowerCase();
  const out: TermEvidence[] = [];
  for (const term of terms) {
    if (title.includes(term)) out.push({ term, field: 'title' });
    else if (body.includes(term)) out.push({ term, field: 'body' });
  }
  return out;
}

export function makeLexicalRetrievalProvider(uow: UnitOfWork): RetrievalProvider {
  return {
    async findSimilar({ scope, queryText, k }: FindSimilarInput): Promise<RetrievalHit[]> {
      const text = toOrQuery(queryText);
      if (!text) return [];
      const limit = Math.min(Math.max(Math.trunc(k) || 1, 1), MAX_K);

      // $1 = query text. The visibility fragment's params follow, then the limit.
      const vis = objectSqlFragment(scope, 'o', 2);
      const limitParam = `$${2 + vis.params.length}`;
      const { rows } = await uow.query<HitRow>(
        `SELECT o.id AS object_id,
                ts_rank(f.fts, ${TS_QUERY.replace('$QP', '$1')}) AS score,
                o.title, o.body
           FROM object_fts f
           JOIN object o ON o.id = f.object_id
          WHERE f.fts @@ ${TS_QUERY.replace('$QP', '$1')}
            AND ${vis.text}
          ORDER BY score DESC, o.created_at ASC, o.id ASC
          LIMIT ${limitParam}`,
        [text, ...vis.params, limit],
      );

      const terms = queryTerms(queryText);
      return rows.map((r) => ({
        objectId: asObjectId(r.object_id),
        score: Number(r.score),
        evidence: evidenceFor(terms, r),
      }));
    },

    /**
     * INV-6: rebuild the derived index from authoritative `object` rows alone.
     * Mirrors the worker consumer's projection exactly, so an on-demand rebuild
     * and incremental maintenance cannot drift.
     */
    async rebuild(workspaceId: WorkspaceId): Promise<void> {
      await uow.query(`DELETE FROM object_fts WHERE workspace_id = $1`, [workspaceId]);
      await uow.query(
        `INSERT INTO object_fts (object_id, workspace_id, fts)
         SELECT o.id, o.workspace_id,
                to_tsvector('english', coalesce(o.title,'') || ' ' || coalesce(o.body,''))
           FROM object o
          WHERE o.workspace_id = $1`,
        [workspaceId],
      );
    },

    describe() {
      return { kind: 'lexical', version: 'pg-fts-english-1' };
    },
  };
}
