// Deterministic development seed (P2.7 §7, §13; identities revised at T3.3.2).
// Fixed UUIDs so the dev UI and docs can reference stable ids.
// Idempotent: safe to run repeatedly.
//
// T3.3.2 — DEMO IDENTITY REMOVAL.
// The seed previously created two demo principals, "Alice" and "Bob", and made
// Alice the owner of everything. They are gone. Every principal this seed
// creates is a real member of the project group, and the authorization
// demonstration that Alice/Bob existed for is preserved using those real
// people instead: the workspace's primary member owns the projects, one project
// is shared with a second real member, and the rest stay invisible to them.
// Deny-by-default is demonstrated by real membership, not by invented users.
//
// What is still NOT recorded about anyone: e-mail, avatar, role, permission
// tier, external account, contribution count or activity. The schema has no
// column for them, so the seed writes none and no surface can imply otherwise.
//
// `Alice` and `Bob` remain in `test/helpers.ts`. That is a two-party
// authorization FIXTURE inside the test suite, not production state, and
// T3.3.12 preserves legitimate fixtures rather than deleting them.

import { getPool, closePool } from './adapters/persistence/db.ts';
import { config } from './config.ts';
import { sourceRef } from './domain/external.ts';

export const SEED = {
  workspaceId: '00000000-0000-4000-8000-000000000001',
  projectApi: '00000000-0000-4000-8000-000000000010',
  projectPrivate: '00000000-0000-4000-8000-000000000011',
  projectShared: '00000000-0000-4000-8000-000000000012',
  /** The workspace's own repository, anchored to its real GitHub identity. */
  projectRepo: '00000000-0000-4000-8000-000000000013',
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

const memberId = (name: string): string => {
  const row = GROUP_MEMBERS.find((m) => m[1] === name);
  if (!row) throw new Error(`seed: no such workspace member: ${name}`);
  return row[0];
};

/**
 * The workspace's primary principal — the identity the dev shell opens as, and
 * the owner of the seeded projects. A real member of the group, not a stand-in.
 */
export const PRIMARY_PRINCIPAL = memberId('Sanchit');

/**
 * The second party in the authorization demonstration. Also a real member: they
 * hold a workspace membership and exactly one project share, so the difference
 * between "member of the workspace" and "can see this project" stays visible
 * end to end without a demo identity.
 */
export const SHAREE_PRINCIPAL = memberId('Shourya');

/**
 * The external identity of this workspace's own repository (T3.3.1).
 *
 * This is the ONE join between the internal object model and external activity:
 * a real Project object records this reference, and the repository surface
 * resolves it back to that project. Nothing about the repository's activity is
 * seeded — commits, branches, pull requests and CI are read live from GitHub at
 * request time, or reported as unavailable. Only the anchor is persisted.
 */
export const REPO_SOURCE_REF = sourceRef('github', 'repository', config.githubRepository);

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
      `INSERT INTO workspace (id, name) VALUES ($1, 'DEVWORKSPACE')
       ON CONFLICT (id) DO NOTHING`,
      [SEED.workspaceId],
    );

    // The real project group, and nobody else. Membership only — see
    // GROUP_MEMBERS. No demo principal is created (T3.3.2).
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

    // The primary member owns the projects. Other members hold a workspace
    // membership but no share, so they must not see them (deny-by-default).
    for (const [id, title] of [
      [SEED.projectApi, 'API Gateway Rework'],
      [SEED.projectPrivate, 'Personal Scratch'],
      [SEED.projectShared, 'Context Engine'],
    ] as const) {
      await client.query(
        `INSERT INTO object (id, workspace_id, type, title, body, owner_id, created_by)
         VALUES ($1, $2, 'project', $3, '', $4, $4)
         ON CONFLICT (id) DO NOTHING`,
        [id, SEED.workspaceId, title, PRIMARY_PRINCIPAL],
      );
    }

    // The workspace's own repository, as a real Project carrying the external
    // identity it is anchored to (T3.3.1). This row is the ONLY thing about
    // GitHub that is ever persisted: it is the join target, not a copy of the
    // repository. Its commits, branches, pull requests and CI state are read
    // live from GitHub when the surface is opened, and reported as unavailable
    // when they cannot be — never seeded, never replayed from a fixture.
    await client.query(
      `INSERT INTO object (id, workspace_id, type, title, body, attributes, owner_id, created_by)
       VALUES ($1, $2, 'project', $3, '', $4::jsonb, $5, $5)
       ON CONFLICT (id) DO UPDATE SET attributes = EXCLUDED.attributes`,
      [
        SEED.projectRepo,
        SEED.workspaceId,
        config.githubRepository.split('/').pop() ?? config.githubRepository,
        JSON.stringify({
          externalRef: REPO_SOURCE_REF,
          externalUrl: `https://github.com/${config.githubRepository}`,
        }),
        PRIMARY_PRINCIPAL,
      ],
    );

    // Captured context, so the graph has real nodes and real anchors from the
    // first load. Every one is an ordinary object row created the same way the
    // capture use case creates them.
    for (const [id, projectId, title, body] of SEED_NOTES) {
      await client.query(
        `INSERT INTO object (id, workspace_id, type, title, body, home_project_id, owner_id, created_by)
         VALUES ($1, $2, 'note', $3, $4, $5, $6, $6)
         ON CONFLICT (id) DO NOTHING`,
        [id, SEED.workspaceId, title, body, projectId, PRIMARY_PRINCIPAL],
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
        [SEED.workspaceId, from, to, verb, PRIMARY_PRINCIPAL, scope],
      );
    }

    // Exactly one project is shared with the second member. The others must
    // stay invisible to them — that asymmetry is what makes the authorization
    // boundary visible, and it is now demonstrated between two real members
    // rather than between two invented ones (T3.3.2).
    await client.query(
      `INSERT INTO project_share (workspace_id, project_id, principal_id, granted_by)
       VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
      [SEED.workspaceId, SEED.projectShared, SHAREE_PRINCIPAL, PRIMARY_PRINCIPAL],
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

  const nameOf = (id: string) => GROUP_MEMBERS.find((m) => m[0] === id)?.[1] ?? id;
  console.log(
    `Seeded ${config.databaseUrl}\n` +
      `  workspace : ${SEED.workspaceId}\n` +
      `  members   : ${GROUP_MEMBERS.map((m) => m[1]).join(', ')}\n` +
      `  primary   : ${nameOf(PRIMARY_PRINCIPAL)} ${PRIMARY_PRINCIPAL}\n` +
      `              (owns the projects — use as: Authorization: Dev ${PRIMARY_PRINCIPAL})\n` +
      `  sharee    : ${nameOf(SHAREE_PRINCIPAL)} ${SHAREE_PRINCIPAL}\n` +
      `              (member; sees ONLY the shared project)\n` +
      `  projects  : ${SEED.projectApi}  "API Gateway Rework"\n` +
      `              ${SEED.projectPrivate}  "Personal Scratch"\n` +
      `              ${SEED.projectShared}  "Context Engine"   (shared)\n` +
      `              ${SEED.projectRepo}  repository anchor → ${REPO_SOURCE_REF}`,
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
