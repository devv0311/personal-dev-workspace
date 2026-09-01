// ArtifactReadRepository — PostgreSQL (T3.3-CORRECTION).
//
// Read/unread on an artifact is PERSONAL. The primary key is
// (principal_id, artifact_ref), every statement here names the caller's own
// principal from the ResolvedScope, and there is no method that reads or writes
// another principal's state. One member opening an artifact therefore cannot
// change what another member sees as new.
//
// The ref is the artifact's own stable identity (`worker:<id>`,
// `github:pull_request:18`, `object:<uuid>`), so the state survives a refetch of
// the source that produced the artifact and does not depend on its position.

import type {
  ArtifactReadRepository,
  UnitOfWork,
} from '../../ports/repositories.ts';
import type { ResolvedScope } from '../../domain/visibility.ts';

/** Bound on one lookup. The orbit reads far fewer than this. */
const MAX_REFS = 500;

export function makeArtifactReadRepository(uow: UnitOfWork): ArtifactReadRepository {
  return {
    async readRefs(scope: ResolvedScope, refs: readonly string[]): Promise<Set<string>> {
      if (refs.length === 0) return new Set();
      const { rows } = await uow.query<{ artifact_ref: string }>(
        `SELECT artifact_ref FROM artifact_read
          WHERE principal_id = $1 AND artifact_ref = ANY($2::text[])`,
        [scope.principalId, refs.slice(0, MAX_REFS)],
      );
      return new Set(rows.map((r) => r.artifact_ref));
    },

    async markRead(scope: ResolvedScope, ref: string): Promise<void> {
      await uow.query(
        `INSERT INTO artifact_read (principal_id, artifact_ref)
         VALUES ($1, $2)
         ON CONFLICT (principal_id, artifact_ref) DO NOTHING`,
        [scope.principalId, ref],
      );
    },
  };
}
