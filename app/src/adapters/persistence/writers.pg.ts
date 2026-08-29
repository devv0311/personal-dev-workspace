// Append-only writers: activity (R22), audit (R15), outbox (INV-13).
// All write inside the caller's transaction (P2.6 §12.4 atomic set).

import type {
  ActivityWriter,
  AuditWriter,
  OutboxWriter,
} from '../../ports/repositories.ts';

export const activityWriter: ActivityWriter = {
  async append(tx, e) {
    await tx.query(
      `INSERT INTO activity (object_id, workspace_id, kind, actor_id, detail)
       VALUES ($1, $2, $3, $4, $5::jsonb)`,
      [e.objectId, e.workspaceId, e.kind, e.actorId, JSON.stringify(e.detail ?? {})],
    );
  },
};

export const auditWriter: AuditWriter = {
  async append(tx, e) {
    await tx.query(
      `INSERT INTO audit_event (workspace_id, actor_id, action, supporting_refs)
       VALUES ($1, $2, $3, $4::jsonb)`,
      [e.workspaceId, e.actorId, e.action, JSON.stringify(e.supportingRefs ?? [])],
    );
  },
};

export const outboxWriter: OutboxWriter = {
  async append(tx, e) {
    // payload carries identifiers + change kind only — never denormalised content.
    await tx.query(
      `INSERT INTO outbox_event (workspace_id, type, payload)
       VALUES ($1, $2, $3::jsonb)`,
      [e.workspaceId, e.type, JSON.stringify(e.payload)],
    );
  },
};
