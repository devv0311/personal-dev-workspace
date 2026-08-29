// Deterministic development seed (P2.7 §7, §13).
// Fixed UUIDs so the dev UI and docs can reference stable ids.
// Idempotent: safe to run repeatedly.

import { getPool, closePool } from './adapters/persistence/db.ts';
import { config } from './config.ts';

export const SEED = {
  workspaceId: '00000000-0000-4000-8000-000000000001',
  // Alice — owner of the seeded project. Bob — a member with NO access to it.
  alice: '00000000-0000-4000-8000-0000000000a1',
  bob: '00000000-0000-4000-8000-0000000000b0',
  projectApi: '00000000-0000-4000-8000-000000000010',
  projectPrivate: '00000000-0000-4000-8000-000000000011',
  noteSeed: '00000000-0000-4000-8000-000000000100',
} as const;

export async function seed(): Promise<void> {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(
      `INSERT INTO workspace (id, name) VALUES ($1, 'Demo Workspace')
       ON CONFLICT (id) DO NOTHING`,
      [SEED.workspaceId],
    );

    for (const [id, name, subject] of [
      [SEED.alice, 'Alice', 'dev:alice'],
      [SEED.bob, 'Bob', 'dev:bob'],
    ] as const) {
      await client.query(
        `INSERT INTO principal (id, workspace_id, auth_subject, display_name)
         VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO NOTHING`,
        [id, SEED.workspaceId, subject, name],
      );
      await client.query(
        `INSERT INTO workspace_membership (workspace_id, principal_id)
         VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [SEED.workspaceId, id],
      );
    }

    // Alice owns two projects. Bob is a workspace member but shares neither,
    // so Bob must not see them (deny-by-default).
    for (const [id, title] of [
      [SEED.projectApi, 'API Gateway Rework'],
      [SEED.projectPrivate, 'Personal Scratch'],
    ] as const) {
      await client.query(
        `INSERT INTO object (id, workspace_id, type, title, body, owner_id, created_by)
         VALUES ($1, $2, 'project', $3, '', $4, $4)
         ON CONFLICT (id) DO NOTHING`,
        [id, SEED.workspaceId, title, SEED.alice],
      );
    }

    // One pre-existing captured note so the project view is immediately non-empty.
    await client.query(
      `INSERT INTO object (id, workspace_id, type, title, body, home_project_id, owner_id, created_by)
       VALUES ($1, $2, 'note', $3, $4, $5, $6, $6)
       ON CONFLICT (id) DO NOTHING`,
      [
        SEED.noteSeed,
        SEED.workspaceId,
        'Chose token-bucket over sliding-window',
        'Sliding-window needs per-key sorted sets; token-bucket is O(1) and good enough for our RPS. Revisit if burst tolerance complaints appear.',
        SEED.projectApi,
        SEED.alice,
      ],
    );

    await client.query(
      `INSERT INTO outbox_event (workspace_id, type, payload)
       SELECT $1, 'object.created', jsonb_build_object('objectId', $2::text, 'kind', 'created')
       WHERE NOT EXISTS (
         SELECT 1 FROM outbox_event
         WHERE type = 'object.created' AND payload->>'objectId' = $2::text
       )`,
      [SEED.workspaceId, SEED.noteSeed],
    );

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  console.log(
    `Seeded ${config.databaseUrl}\n` +
      `  workspace : ${SEED.workspaceId}\n` +
      `  Alice     : ${SEED.alice}   (owns the projects — use as: Authorization: Dev ${SEED.alice})\n` +
      `  Bob       : ${SEED.bob}   (member, no project access — use to see deny-by-default)\n` +
      `  project   : ${SEED.projectApi}  "API Gateway Rework"`,
  );
}

if (import.meta.main) {
  seed()
    .then(() => closePool())
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
