// Deterministic development seed (P2.7 §7, §13; identities revised at T3.3.2,
// headship corrected at T3.3-CORRECTION).
// Fixed UUIDs so the dev UI and docs can reference stable ids.
// Idempotent: safe to run repeatedly.
//
// T3.3.2 — DEMO IDENTITY REMOVAL.
// The seed previously created two demo principals, "Alice" and "Bob", and made
// Alice the owner of everything. They are gone. Every principal this seed
// creates is a real member of the project group.
//
// T3.3-CORRECTION — HEADSHIP.
// Dev is the HEAD of DEVWORKSPACE, and that is now a fact in the data rather
// than a label in the client: Dev's workspace membership carries the `owner`
// role (the schema permits exactly one per workspace), Dev owns the seeded
// projects, and Dev is the identity the dev shell opens as. The other group
// members remain real members with no share except the one demonstrated below —
// so "member of the workspace" and "can see this project" stay visibly
// different, and headship is visibly different from both.
//
// Nothing here makes the head privileged over anyone's mail: a mail account
// belongs to the principal who connected it, and no seed connects one.
//
// What is still NOT recorded about anyone: e-mail, avatar, permission tier,
// external account, contribution count or activity. The schema has no column
// for them, so the seed writes none and no surface can imply otherwise.
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

/**
 * Principals a PREVIOUS version of this seed created and this one does not.
 *
 * `dev:alice` and `dev:bob` were the T3.3.2 demo principals. They are no longer
 * created, but a database seeded before that milestone still holds them, and a
 * stale demo identity in the members list is exactly the production-facing demo
 * state this correction removes.
 *
 * The removal is deliberately NARROW and guarded: only these two known
 * subjects, only in the seeded workspace, and only when they own nothing and
 * authored nothing. A principal that owns an object is left alone and reported,
 * because deleting it would delete real work — and because a real person must
 * never be removed by a seed on a name match.
 */
const RETIRED_SUBJECTS = ['dev:alice', 'dev:bob'] as const;

const memberId = (name: string): string => {
  const row = GROUP_MEMBERS.find((m) => m[1] === name);
  if (!row) throw new Error(`seed: no such workspace member: ${name}`);
  return row[0];
};

/**
 * The HEAD of the workspace: Dev.
 *
 * This is the identity the dev shell opens as, the owner of the seeded
 * projects, and the principal whose workspace membership carries the `owner`
 * role. It is one real person, recorded once, and every surface that names the
 * workspace's head reads it back from that membership row — never from a
 * constant in the browser.
 */
export const WORKSPACE_HEAD = memberId('Dev');

/**
 * The principal that owns the seeded project objects. The head owns what the
 * seed creates; objects captured later are owned by whoever captures them.
 */
export const PRIMARY_PRINCIPAL = WORKSPACE_HEAD;

/**
 * The second party in the authorization demonstration. A real member who is NOT
 * the head: they hold a workspace membership and exactly one project share, so
 * the difference between "member of the workspace", "can see this project" and
 * "heads this workspace" stays visible end to end without a demo identity.
 */
export const SHAREE_PRINCIPAL = memberId('Sanchit');

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

    // The real project group, and nobody else. Membership plus a role — see
    // GROUP_MEMBERS. No demo principal is created (T3.3.2).
    //
    // The role is the headship correction: Dev's membership is `owner`, every
    // other member's is `member`, and the schema's partial unique index means
    // the workspace cannot end up with two heads. Re-running the seed
    // re-asserts the role, so an older database is corrected rather than left
    // with whatever it happened to have.
    for (const [id, name, subject] of GROUP_MEMBERS) {
      await client.query(
        `INSERT INTO principal (id, workspace_id, auth_subject, display_name)
         VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO NOTHING`,
        [id, SEED.workspaceId, subject, name],
      );
    }
    // Demote first, then promote, so the one-owner index can never be violated
    // mid-seed by two rows briefly claiming the role.
    for (const [id] of GROUP_MEMBERS) {
      await client.query(
        `INSERT INTO workspace_membership (workspace_id, principal_id, role)
         VALUES ($1, $2, 'member')
         ON CONFLICT (workspace_id, principal_id) DO UPDATE SET role = 'member'`,
        [SEED.workspaceId, id],
      );
    }
    await client.query(
      `UPDATE workspace_membership SET role = 'owner'
        WHERE workspace_id = $1 AND principal_id = $2`,
      [SEED.workspaceId, WORKSPACE_HEAD],
    );

    // The head owns the seeded projects. Other members hold a workspace
    // membership but no share, so they must not see them (deny-by-default) —
    // headship grants ownership of what the head created, not sight of
    // everything.
    //
    // Ownership is RE-ASSERTED on conflict, so a database seeded before this
    // correction converges instead of keeping the previous owner. `created_by`
    // is deliberately NOT rewritten: authorship is immutable (R8), and who
    // originally wrote a row stays true even when ownership moves.
    for (const [id, title] of [
      [SEED.projectApi, 'API Gateway Rework'],
      [SEED.projectPrivate, 'Personal Scratch'],
      [SEED.projectShared, 'Context Engine'],
    ] as const) {
      await client.query(
        `INSERT INTO object (id, workspace_id, type, title, body, owner_id, created_by)
         VALUES ($1, $2, 'project', $3, '', $4, $4)
         ON CONFLICT (id) DO UPDATE SET owner_id = EXCLUDED.owner_id`,
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
         ON CONFLICT (id) DO UPDATE SET owner_id = EXCLUDED.owner_id`,
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

    // Retire the superseded demo principals, where it is safe to.
    //
    // The guard covers EVERY table that references a principal, not just
    // ownership: a demo identity that authored an edge, recorded activity, was
    // granted a share or connected a mailbox is history in that database, and
    // deleting it would either destroy that history or fail on a restricting
    // foreign key. Such a row is kept and reported instead. A database seeded
    // from empty has no references, so the retired identities simply never
    // exist there.
    const retired: string[] = [];
    const kept: string[] = [];
    for (const subject of RETIRED_SUBJECTS) {
      const { rows } = await client.query<{ display_name: string }>(
        `DELETE FROM principal p
          WHERE p.workspace_id = $1 AND p.auth_subject = $2
            AND NOT EXISTS (SELECT 1 FROM object o WHERE o.owner_id = p.id OR o.created_by = p.id)
            AND NOT EXISTS (SELECT 1 FROM relationship r WHERE r.author_id = p.id)
            AND NOT EXISTS (SELECT 1 FROM activity a WHERE a.actor_id = p.id)
            AND NOT EXISTS (SELECT 1 FROM audit_event e WHERE e.actor_id = p.id)
            AND NOT EXISTS (SELECT 1 FROM project_share s
                             WHERE s.principal_id = p.id OR s.granted_by = p.id)
            AND NOT EXISTS (SELECT 1 FROM mail_account m WHERE m.principal_id = p.id)
          RETURNING p.display_name`,
        [SEED.workspaceId, subject],
      );
      if (rows[0]) {
        retired.push(rows[0].display_name);
        continue;
      }
      const { rows: still } = await client.query<{ display_name: string }>(
        `SELECT display_name FROM principal WHERE workspace_id = $1 AND auth_subject = $2`,
        [SEED.workspaceId, subject],
      );
      if (still[0]) kept.push(still[0].display_name);
    }

    await client.query('COMMIT');
    if (retired.length) {
      console.log(`Retired superseded demo principals: ${retired.join(', ')}`);
    }
    if (kept.length) {
      console.log(
        `Kept (they hold real rows in this database, which a seed must not destroy): ${kept.join(', ')}`,
      );
    }
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
      `  head      : ${nameOf(WORKSPACE_HEAD)} ${WORKSPACE_HEAD}\n` +
      `              (workspace owner — use as: Authorization: Dev ${WORKSPACE_HEAD})\n` +
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
