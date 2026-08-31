// MemberRepository — workspace membership and headship, read-only
// (T3.2; headship added at T3.3-CORRECTION).
//
// Scoped like every other read: a principal may only enumerate the members of
// the workspace their own ResolvedScope resolved to (INV-3). The projection is
// three columns wide — id, display name, membership role — and every one of
// them is a real column. `principal` still carries no e-mail, no avatar, no
// permission tier and no external account, and this read invents none of them,
// so a people surface built on it cannot state anything the model does not hold.
//
// The role is what makes "who heads this workspace" answerable from data rather
// than from a constant in the client. The schema allows at most one `owner` per
// workspace (a partial unique index), so `readWorkspace().head` is either that
// one real member or a truthful null.

import type {
  MemberRepository,
  MemberRole,
  UnitOfWork,
  WorkspaceIdentity,
  WorkspaceMember,
} from '../../ports/repositories.ts';
import type { ResolvedScope } from '../../domain/visibility.ts';

interface MemberRow {
  id: string;
  display_name: string;
  role: string;
}

const toMember = (r: MemberRow): WorkspaceMember => ({
  id: r.id,
  displayName: r.display_name,
  role: (r.role === 'owner' ? 'owner' : 'member') satisfies MemberRole,
});

export function makeMemberRepository(uow: UnitOfWork): MemberRepository {
  return {
    async listMembers(scope: ResolvedScope): Promise<WorkspaceMember[]> {
      const { rows } = await uow.query<MemberRow>(
        `SELECT pr.id, pr.display_name, m.role
           FROM principal pr
           JOIN workspace_membership m
             ON m.principal_id = pr.id AND m.workspace_id = pr.workspace_id
          WHERE pr.workspace_id = $1
          ORDER BY (m.role = 'owner') DESC, pr.display_name ASC, pr.id ASC`,
        [scope.workspaceId],
      );
      return rows.map(toMember);
    },

    async readWorkspace(scope: ResolvedScope): Promise<WorkspaceIdentity | null> {
      const { rows } = await uow.query<{
        id: string;
        name: string;
        head_id: string | null;
        head_name: string | null;
      }>(
        `SELECT w.id, w.name,
                head.id           AS head_id,
                head.display_name AS head_name
           FROM workspace w
           LEFT JOIN workspace_membership hm
             ON hm.workspace_id = w.id AND hm.role = 'owner'
           LEFT JOIN principal head
             ON head.id = hm.principal_id
          WHERE w.id = $1`,
        [scope.workspaceId],
      );
      const row = rows[0];
      if (!row) return null;
      return {
        id: row.id,
        name: row.name,
        head:
          row.head_id && row.head_name
            ? { id: row.head_id, displayName: row.head_name, role: 'owner' }
            : null,
      };
    },
  };
}
