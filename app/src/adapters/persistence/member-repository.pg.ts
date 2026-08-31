// MemberRepository — workspace membership, read-only (T3.2).
//
// Scoped like every other read: a principal may only enumerate the members of
// the workspace their own ResolvedScope resolved to (INV-3). The projection is
// deliberately two columns wide. `principal` carries no e-mail, no avatar, no
// role and no external account, and this read invents none of them, so a
// people surface built on it cannot state anything the model does not hold.

import type {
  MemberRepository,
  UnitOfWork,
  WorkspaceMember,
} from '../../ports/repositories.ts';
import type { ResolvedScope } from '../../domain/visibility.ts';

export function makeMemberRepository(uow: UnitOfWork): MemberRepository {
  return {
    async listMembers(scope: ResolvedScope): Promise<WorkspaceMember[]> {
      const { rows } = await uow.query<{ id: string; display_name: string }>(
        `SELECT pr.id, pr.display_name
           FROM principal pr
           JOIN workspace_membership m
             ON m.principal_id = pr.id AND m.workspace_id = pr.workspace_id
          WHERE pr.workspace_id = $1
          ORDER BY pr.display_name ASC, pr.id ASC`,
        [scope.workspaceId],
      );
      return rows.map((r) => ({ id: r.id, displayName: r.display_name }));
    },
  };
}
