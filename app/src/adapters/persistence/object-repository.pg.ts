// ObjectRepository — PostgreSQL. The VisibilityPolicy SQL fragment is composed
// into every read (filter-first, INV-3). Storage-shaped assertions belong to
// this layer only (INV-14).

import type {
  ObjectRepository,
  NewObject,
  Tx,
  UnitOfWork,
} from '../../ports/repositories.ts';
import type { ObjectId, ProjectId } from '../../domain/ids.ts';
import {
  asObjectId,
  asWorkspaceId,
  asPrincipalId,
  asProjectId,
} from '../../domain/ids.ts';
import type { WorkspaceObject, ObjectType } from '../../domain/objects.ts';
import { objectSqlFragment, type ResolvedScope } from '../../domain/visibility.ts';

interface ObjectRow {
  id: string;
  workspace_id: string;
  type: string;
  title: string;
  body: string;
  attributes: Record<string, unknown>;
  home_project_id: string | null;
  owner_id: string;
  created_by: string;
  created_at: string;
  updated_at: string;
}

function toDomain(r: ObjectRow): WorkspaceObject {
  return {
    id: asObjectId(r.id),
    workspaceId: asWorkspaceId(r.workspace_id),
    type: r.type as ObjectType,
    title: r.title,
    body: r.body,
    attributes: r.attributes ?? {},
    homeProjectId: r.home_project_id ? asProjectId(r.home_project_id) : null,
    ownerId: asPrincipalId(r.owner_id),
    createdBy: asPrincipalId(r.created_by),
    createdAt: new Date(r.created_at).toISOString(),
    updatedAt: new Date(r.updated_at).toISOString(),
  };
}

const COLS =
  'id, workspace_id, type, title, body, attributes, home_project_id, owner_id, created_by, created_at, updated_at';

export function makeObjectRepository(uow: UnitOfWork): ObjectRepository {
  return {
    async findVisible(scope: ResolvedScope, id: ObjectId) {
      const vis = objectSqlFragment(scope, 'o', 2);
      const { rows } = await uow.query<ObjectRow>(
        `SELECT ${COLS} FROM object o WHERE o.id = $1 AND ${vis.text}`,
        [id, ...vis.params],
      );
      return rows[0] ? toDomain(rows[0]) : null;
    },

    async listByHomeProject(scope: ResolvedScope, projectId: ProjectId) {
      // FILTER (visibility) is in the WHERE clause; assembly/ordering follows.
      const vis = objectSqlFragment(scope, 'o', 2);
      const { rows } = await uow.query<ObjectRow>(
        `SELECT ${COLS} FROM object o
          WHERE o.home_project_id = $1 AND ${vis.text}
          ORDER BY o.created_at ASC, o.id ASC`,
        [projectId, ...vis.params],
      );
      return rows.map(toDomain);
    },

    async listProjects(scope: ResolvedScope) {
      const vis = objectSqlFragment(scope, 'o', 1);
      const { rows } = await uow.query<ObjectRow>(
        `SELECT ${COLS} FROM object o
          WHERE o.type = 'project' AND ${vis.text}
          ORDER BY o.created_at ASC, o.id ASC`,
        [...vis.params],
      );
      return rows.map(toDomain);
    },

    async create(tx: Tx, input: NewObject): Promise<WorkspaceObject> {
      const { rows } = await tx.query<ObjectRow>(
        `INSERT INTO object
           (workspace_id, type, title, body, attributes, home_project_id, owner_id, created_by)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8)
         RETURNING ${COLS}`,
        [
          input.workspaceId,
          input.type,
          input.title,
          input.body,
          JSON.stringify(input.attributes ?? {}),
          input.homeProjectId,
          input.ownerId,
          input.createdBy,
        ],
      );
      return toDomain(rows[0]!);
    },
  };
}
