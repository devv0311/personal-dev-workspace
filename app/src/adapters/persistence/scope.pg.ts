// ScopeResolver — resolves the per-request ResolvedScope snapshot once (P2.6 §9.2).

import type { UnitOfWork, ScopeResolver } from '../../ports/repositories.ts';
import type { PrincipalId } from '../../domain/ids.ts';
import {
  asWorkspaceId,
  asPrincipalId,
  asProjectId,
} from '../../domain/ids.ts';
import type { ResolvedScope } from '../../domain/visibility.ts';

export function makeScopeResolver(uow: UnitOfWork): ScopeResolver {
  return {
    async resolve(principalId: PrincipalId): Promise<ResolvedScope | null> {
      const p = await uow.query<{ id: string; workspace_id: string }>(
        `SELECT pr.id, pr.workspace_id
           FROM principal pr
           JOIN workspace_membership m
             ON m.principal_id = pr.id AND m.workspace_id = pr.workspace_id
          WHERE pr.id = $1`,
        [principalId],
      );
      const row = p.rows[0];
      if (!row) return null;

      const shares = await uow.query<{ project_id: string }>(
        `SELECT project_id FROM project_share WHERE principal_id = $1`,
        [principalId],
      );

      return {
        workspaceId: asWorkspaceId(row.workspace_id),
        principalId: asPrincipalId(row.id),
        sharedProjectIds: shares.rows.map((r) => asProjectId(r.project_id)),
      };
    },
  };
}
