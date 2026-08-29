// RelationshipRepository — PostgreSQL.
//
// forObject() returns, filter-first:
//   • real `relationship` rows touching the object, visible per relationshipSqlFragment
//     (visible(from) ∧ visible(to) ∧ edge rule), UNION
//   • the synthesised `belongs_to` edge derived from object.home_project_id
//     (P2.6 §8.2) — so no consumer special-cases the FK (INV-2).

import type {
  RelationshipRepository,
  Tx,
  UnitOfWork,
} from '../../ports/repositories.ts';
import type { ObjectId } from '../../domain/ids.ts';
import {
  asObjectId,
  asWorkspaceId,
  asPrincipalId,
  asRelationshipId,
} from '../../domain/ids.ts';
import type { RelationshipEdge } from '../../domain/relationships.ts';
import {
  objectSqlFragment,
  relationshipSqlFragment,
  type ResolvedScope,
} from '../../domain/visibility.ts';
import { DEFAULT_GRAPH_LIMIT, clampLimit } from './object-repository.pg.ts';

interface RelRow {
  id: string;
  workspace_id: string;
  from_object_id: string;
  to_object_id: string;
  verb: string;
  origin: string;
  confidence_state: string;
  author_id: string | null;
  visibility_scope: string;
  provenance_kind: string;
  provenance_detail: Record<string, unknown>;
  created_at: string;
}

function rowToEdge(r: RelRow): RelationshipEdge {
  return {
    id: asRelationshipId(r.id),
    workspaceId: asWorkspaceId(r.workspace_id),
    fromObjectId: asObjectId(r.from_object_id),
    toObjectId: asObjectId(r.to_object_id),
    verb: r.verb as RelationshipEdge['verb'],
    origin: r.origin as RelationshipEdge['origin'],
    confidenceState: r.confidence_state as RelationshipEdge['confidenceState'],
    authorId: r.author_id ? asPrincipalId(r.author_id) : null,
    visibilityScope: r.visibility_scope as RelationshipEdge['visibilityScope'],
    provenance: { kind: r.provenance_kind, detail: r.provenance_detail ?? {} },
    createdAt: new Date(r.created_at).toISOString(),
    synthesised: false,
  };
}

const REL_COLS =
  'r.id, r.workspace_id, r.from_object_id, r.to_object_id, r.verb, r.origin, r.confidence_state, r.author_id, r.visibility_scope, r.provenance_kind, r.provenance_detail, r.created_at';

interface HomeRow {
  object_id: string;
  project_id: string;
  workspace_id: string;
  created_at: string;
}

/**
 * The synthesised `belongs_to` edge derived from object.home_project_id
 * (P2.6 §8.2). One builder, used by every read, so the two forms cannot drift.
 */
function homeRowToEdge(h: HomeRow): RelationshipEdge {
  return {
    id: null,
    workspaceId: asWorkspaceId(h.workspace_id),
    fromObjectId: asObjectId(h.object_id),
    toObjectId: asObjectId(h.project_id),
    verb: 'belongs_to',
    origin: 'explicit',
    confidenceState: 'known',
    authorId: null,
    visibilityScope: 'shared',
    provenance: { kind: 'synthesised:home_project', detail: {} },
    createdAt: new Date(h.created_at).toISOString(),
    synthesised: true,
  };
}

export function makeRelationshipRepository(uow: UnitOfWork): RelationshipRepository {
  return {
    async forObject(scope: ResolvedScope, objectId: ObjectId): Promise<RelationshipEdge[]> {
      // --- real edges (filter-first) ---
      const vis = relationshipSqlFragment(scope, 'r', 'ofrom', 'oto', 2);
      const { rows } = await uow.query<RelRow>(
        `SELECT ${REL_COLS}
           FROM relationship r
           JOIN object ofrom ON ofrom.id = r.from_object_id
           JOIN object oto   ON oto.id = r.to_object_id
          WHERE (r.from_object_id = $1 OR r.to_object_id = $1)
            AND ${vis.text}
          ORDER BY r.created_at ASC, r.id ASC`,
        [objectId, ...vis.params],
      );
      const edges = rows.map(rowToEdge);

      // --- synthesised belongs_to from home_project_id (P2.6 §8.2) ---
      // Only surfaced if BOTH the object and its home project are visible.
      const oVis = objectSqlFragment(scope, 'o', 2);
      const pVis = objectSqlFragment(scope, 'p', 2 + oVis.params.length);
      const home = await uow.query<{
        object_id: string;
        project_id: string;
        workspace_id: string;
        created_at: string;
      }>(
        `SELECT o.id AS object_id, p.id AS project_id, o.workspace_id, o.created_at
           FROM object o
           JOIN object p ON p.id = o.home_project_id
          WHERE o.id = $1 AND ${oVis.text} AND ${pVis.text}`,
        [objectId, ...oVis.params, ...pVis.params],
      );
      const h = home.rows[0];
      if (h) edges.push(homeRowToEdge(h));
      return edges;
    },

    async listVisible(scope: ResolvedScope, limit = DEFAULT_GRAPH_LIMIT): Promise<RelationshipEdge[]> {
      // Whole-workspace form of forObject(). Identical policy composition:
      // real rows are filtered by relationshipSqlFragment (visible(from) ∧
      // visible(to) ∧ edge rule); synthesised belongs_to edges are emitted only
      // when BOTH the object and its home project pass the object rule.
      const cap = clampLimit(limit);

      const vis = relationshipSqlFragment(scope, 'r', 'ofrom', 'oto', 1);
      const { rows } = await uow.query<RelRow>(
        `SELECT ${REL_COLS}
           FROM relationship r
           JOIN object ofrom ON ofrom.id = r.from_object_id
           JOIN object oto   ON oto.id = r.to_object_id
          WHERE ${vis.text}
          ORDER BY r.created_at ASC, r.id ASC
          LIMIT $${vis.params.length + 1}`,
        [...vis.params, cap],
      );

      const oVis = objectSqlFragment(scope, 'o', 1);
      const pVis = objectSqlFragment(scope, 'p', 1 + oVis.params.length);
      const home = await uow.query<HomeRow>(
        `SELECT o.id AS object_id, p.id AS project_id, o.workspace_id, o.created_at
           FROM object o
           JOIN object p ON p.id = o.home_project_id
          WHERE ${oVis.text} AND ${pVis.text}
          ORDER BY o.created_at ASC, o.id ASC
          LIMIT $${oVis.params.length + pVis.params.length + 1}`,
        [...oVis.params, ...pVis.params, cap],
      );

      return [...rows.map(rowToEdge), ...home.rows.map(homeRowToEdge)];
    },

    async create(tx: Tx, edge): Promise<RelationshipEdge> {
      const { rows } = await tx.query<RelRow>(
        `INSERT INTO relationship
           (workspace_id, from_object_id, to_object_id, verb, origin,
            confidence_state, author_id, visibility_scope, provenance_kind, provenance_detail)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)
         RETURNING ${REL_COLS.replace(/r\./g, '')}`,
        [
          edge.workspaceId,
          edge.fromObjectId,
          edge.toObjectId,
          edge.verb,
          edge.origin,
          edge.confidenceState,
          edge.authorId,
          edge.visibilityScope,
          edge.provenance.kind,
          JSON.stringify(edge.provenance.detail ?? {}),
        ],
      );
      return rowToEdge(rows[0]!);
    },
  };
}
