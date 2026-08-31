// Outbox consumer: maintain the derived object_fts index (P2.6 §12, §16).
//
// STATE-BASED, not delta-based (P2.6 §16): given "object X changed", read X's
// current authoritative row and recompute. Absent row ⇒ delete the derived row.
// This converges under duplicate / out-of-order / replayed delivery (INV-13),
// and never resurrects a deleted object's index entry.
//
// The derived index is never authoritative (INV-6): it is rebuildable from
// `object` alone, which is exactly what this consumer does per row.

import type { Tx } from '../../ports/repositories.ts';

/** The consumer's own name, used wherever a run has to be attributed. */
export const CONSUMER_NAME = 'fts-maintenance';

export const CONSUMES = new Set(['object.created', 'object.updated', 'object.deleted']);

interface Payload {
  objectId?: string;
}

export async function handleObjectChange(tx: Tx, payload: Payload): Promise<void> {
  const objectId = payload.objectId;
  if (!objectId) return;

  const { rows } = await tx.query<{ workspace_id: string; title: string; body: string }>(
    `SELECT workspace_id, title, body FROM object WHERE id = $1`,
    [objectId],
  );
  const current = rows[0];

  if (!current) {
    await tx.query(`DELETE FROM object_fts WHERE object_id = $1`, [objectId]);
    return;
  }

  await tx.query(
    `INSERT INTO object_fts (object_id, workspace_id, fts)
     VALUES ($1, $2, to_tsvector('english', coalesce($3,'') || ' ' || coalesce($4,'')))
     ON CONFLICT (object_id)
     DO UPDATE SET fts = EXCLUDED.fts, workspace_id = EXCLUDED.workspace_id`,
    [objectId, current.workspace_id, current.title, current.body],
  );
}
