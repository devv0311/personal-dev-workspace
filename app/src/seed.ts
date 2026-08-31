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
  projectShared: '00000000-0000-4000-8000-000000000012',
  noteSeed: '00000000-0000-4000-8000-000000000100',
} as const;

/**
 * The real project group (T3.2 §13).
 *
 * A principal row plus a workspace membership is the whole of what the model
 * records about a person, so it is the whole of what is seeded: a display name
 * and the fact of membership. No e-mail, avatar, external account, role,
 * permission, contribution or activity is fabricated for any of them — the
 * schema has no column for those, and the people surface must not imply
 * otherwise.
 */
export const GROUP_MEMBERS: ReadonlyArray<readonly [string, string, string]> = [
  ['00000000-0000-4000-8000-0000000000d1', 'Dev', 'dev:dev'],
  ['00000000-0000-4000-8000-0000000000d2', 'Sanchit', 'dev:sanchit'],
  ['00000000-0000-4000-8000-0000000000d3', 'Shourya', 'dev:shourya'],
  ['00000000-0000-4000-8000-0000000000d4', 'Aatika', 'dev:aatika'],
  ['00000000-0000-4000-8000-0000000000d5', 'Ananya', 'dev:ananya'],
] as const;

const SEED_PROJECT = {
  api: SEED.projectApi,
  private: SEED.projectPrivate,
  shared: SEED.projectShared,
} as const;

/**
 * Development seed context. Real objects through the real schema — the graph
 * has no dataset of its own. Fixed ids so screenshots and docs stay stable.
 */
const SEED_NOTES: ReadonlyArray<readonly [string, string, string, string]> = [
  ['00000000-0000-4000-8000-000000000101', SEED_PROJECT.api,
   'Rate limiter: token bucket',
   'Sliding-window needs per-key sorted sets; token-bucket is O(1) and good enough for our RPS. Revisit if burst tolerance complaints appear.'],
  ['00000000-0000-4000-8000-000000000102', SEED_PROJECT.api,
   'Auth header parsing is the boundary',
   'The principal must never come from the request body. Derive it once, at the edge, from a credential the server validates.'],
  ['00000000-0000-4000-8000-000000000103', SEED_PROJECT.api,
   'Retry budget per upstream',
   'A global retry budget hides which upstream is actually failing. Budget per upstream, surface the breach as an event.'],
  ['00000000-0000-4000-8000-000000000104', SEED_PROJECT.api,
   'Gateway timeouts must be shorter than client timeouts',
   'Otherwise the client gives up first and we keep burning an upstream connection for nothing.'],
  ['00000000-0000-4000-8000-000000000105', SEED_PROJECT.api,
   'Open question: idempotency keys',
   'Do we require them on every mutating route, or only on payment-adjacent ones? Cost is storage plus a lookup on the hot path.'],
  ['00000000-0000-4000-8000-000000000110', SEED_PROJECT.private,
   'Weekend reading list',
   'Two papers on CRDT convergence and one on transactional outbox failure modes.'],
  ['00000000-0000-4000-8000-000000000111', SEED_PROJECT.private,
   'Desk setup: second monitor arrives Thursday',
   'Move the terminal to the vertical panel once it lands.'],
  ['00000000-0000-4000-8000-000000000120', SEED_PROJECT.shared,
   'Lexical retrieval first, vectors later',
   'Postgres FTS covers the MVP. The RetrievalProvider seam keeps the vector option open without committing to a second datastore.'],
  ['00000000-0000-4000-8000-000000000121', SEED_PROJECT.shared,
   'Confidence must be a state, not a float',
   'A number invites false precision. known / user_confirmed / inferred_high / weak is honest and actionable.'],
  ['00000000-0000-4000-8000-000000000122', SEED_PROJECT.shared,
   'Ranking is deterministic before it is smart',
   'Same inputs, same order. A ranker we cannot reproduce is a ranker we cannot debug.'],
] as const;

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

    // The real project group. Membership only — see GROUP_MEMBERS.
    for (const [id, name, subject] of GROUP_MEMBERS) {
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
      [SEED.projectShared, 'Context Engine'],
    ] as const) {
      await client.query(
        `INSERT INTO object (id, workspace_id, type, title, body, owner_id, created_by)
         VALUES ($1, $2, 'project', $3, '', $4, $4)
         ON CONFLICT (id) DO NOTHING`,
        [id, SEED.workspaceId, title, SEED.alice],
      );
    }

    // Captured context, so the graph has real nodes and real anchors from the
    // first load. Every one is an ordinary object row created the same way the
    // capture use case creates them.
    for (const [id, projectId, title, body] of SEED_NOTES) {
      await client.query(
        `INSERT INTO object (id, workspace_id, type, title, body, home_project_id, owner_id, created_by)
         VALUES ($1, $2, 'note', $3, $4, $5, $6, $6)
         ON CONFLICT (id) DO NOTHING`,
        [id, SEED.workspaceId, title, body, projectId, SEED.alice],
      );
    }

    // Real stored relationship rows (not synthesised): the graph draws these as
    // authored edges, distinct from the belongs_to anchor.
    for (const [from, to, verb, scope] of [
      ['00000000-0000-4000-8000-000000000102', '00000000-0000-4000-8000-000000000121',
       'references', 'shared'],
      ['00000000-0000-4000-8000-000000000104', '00000000-0000-4000-8000-000000000103',
       'explains', 'shared'],
      ['00000000-0000-4000-8000-000000000105', '00000000-0000-4000-8000-000000000101',
       'follows_from', 'private'],
    ] as const) {
      await client.query(
        `INSERT INTO relationship
           (workspace_id, from_object_id, to_object_id, verb, origin,
            confidence_state, author_id, visibility_scope, provenance_kind)
         SELECT $1, $2, $3, $4, 'explicit', 'user_confirmed', $5, $6, 'seed'
         WHERE NOT EXISTS (
           SELECT 1 FROM relationship
            WHERE from_object_id = $2 AND to_object_id = $3 AND verb = $4
         )`,
        [SEED.workspaceId, from, to, verb, SEED.alice, scope],
      );
    }

    // Exactly one project is shared with Bob. The other two must stay invisible
    // to him — that asymmetry is what makes the authorization boundary visible.
    await client.query(
      `INSERT INTO project_share (workspace_id, project_id, principal_id, granted_by)
       VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
      [SEED.workspaceId, SEED.projectShared, SEED.bob, SEED.alice],
    );

    for (const [id] of SEED_NOTES) {
      await client.query(
        `INSERT INTO outbox_event (workspace_id, type, payload)
         SELECT $1, 'object.created', jsonb_build_object('objectId', $2::text, 'kind', 'created')
         WHERE NOT EXISTS (
           SELECT 1 FROM outbox_event
           WHERE type = 'object.created' AND payload->>'objectId' = $2::text
         )`,
        [SEED.workspaceId, id],
      );
    }

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
      `  Bob       : ${SEED.bob}   (member; sees ONLY the shared project)\n` +
      `  projects  : ${SEED.projectApi}  "API Gateway Rework"      (Alice only)\n` +
      `              ${SEED.projectPrivate}  "Personal Scratch"        (Alice only)\n` +
      `              ${SEED.projectShared}  "Context Engine"          (shared with Bob)`,
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
