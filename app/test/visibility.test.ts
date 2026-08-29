// INV-3 rule-source consistency: the SQL fragment and canSee() are generated
// from one Node tree and must agree. Plus relationship-level visibility (R9a).

import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { resetDatabase, shutdown, baseFixture, IDS } from './helpers.ts';
import { getPool } from '../src/adapters/persistence/db.ts';
import {
  objectSqlFragment,
  canSeeObject,
  canSeeRelationship,
  type ResolvedScope,
} from '../src/domain/visibility.ts';
import {
  asWorkspaceId,
  asPrincipalId,
  asProjectId,
} from '../src/domain/ids.ts';

before(async () => {
  await resetDatabase();
});
beforeEach(async () => {
  await getPool().query('TRUNCATE workspace CASCADE');
  await baseFixture();
});
after(async () => {
  await shutdown();
});

function scopeFor(principal: string, shared: string[] = []): ResolvedScope {
  return {
    workspaceId: asWorkspaceId(IDS.workspace),
    principalId: asPrincipalId(principal),
    sharedProjectIds: shared.map(asProjectId),
  };
}

test('SQL fragment and canSee() agree for every object in the store', async () => {
  // Seed a spread: Alice-owned in project A, Bob-owned inbox note, note in shared B.
  await getPool().query(
    `INSERT INTO object (workspace_id, type, title, home_project_id, owner_id, created_by)
     VALUES ($1,'note','a1',$2,$3,$3), ($1,'note','bob-inbox',NULL,$4,$4),
            ($1,'note','b1',$5,$3,$3)`,
    [IDS.workspace, IDS.projectA, IDS.alice, IDS.bob, IDS.projectB],
  );

  const scopes = [
    scopeFor(IDS.alice),
    scopeFor(IDS.bob),
    scopeFor(IDS.bob, [IDS.projectB]),
  ];

  const all = await getPool().query<{
    id: string;
    workspace_id: string;
    owner_id: string;
    home_project_id: string | null;
  }>(`SELECT id, workspace_id, owner_id, home_project_id FROM object`);

  for (const scope of scopes) {
    const frag = objectSqlFragment(scope, 'o', 1);
    const visibleViaSql = new Set(
      (
        await getPool().query<{ id: string }>(
          `SELECT id FROM object o WHERE ${frag.text}`,
          frag.params as unknown[],
        )
      ).rows.map((r) => r.id),
    );

    for (const row of all.rows) {
      const viaJs = canSeeObject(scope, {
        id: row.id,
        workspace_id: row.workspace_id,
        owner_id: row.owner_id,
        home_project_id: row.home_project_id,
      });
      assert.equal(
        viaJs,
        visibleViaSql.has(row.id),
        `disagreement for object ${row.id} under principal ${scope.principalId}`,
      );
    }
  }
});

test('a shared Project container is itself visible to the sharee (P2.7 §16 refinement)', () => {
  const project = {
    id: IDS.projectA,
    workspace_id: IDS.workspace,
    owner_id: IDS.alice,
    home_project_id: null, // projects are top-level
  };
  assert.equal(canSeeObject(scopeFor(IDS.bob), project), false, 'not shared → hidden');
  assert.equal(
    canSeeObject(scopeFor(IDS.bob, [IDS.projectA]), project),
    true,
    'shared → the project record itself is visible',
  );
});

test('an Inbox object (no home project) is visible only to its owner', () => {
  const row = {
    id: '00000000-0000-4000-8000-00000000e001',
    workspace_id: IDS.workspace,
    owner_id: IDS.alice,
    home_project_id: null,
  };
  assert.equal(canSeeObject(scopeFor(IDS.alice), row), true);
  assert.equal(canSeeObject(scopeFor(IDS.bob, [IDS.projectA, IDS.projectB]), row), false);
});

test('a private relationship edge is visible only to its author (R9a)', () => {
  const endpoints = {
    from: {
      id: '00000000-0000-4000-8000-00000000e010',
      workspace_id: IDS.workspace,
      owner_id: IDS.alice,
      home_project_id: IDS.projectA,
    },
    to: {
      id: '00000000-0000-4000-8000-00000000e011',
      workspace_id: IDS.workspace,
      owner_id: IDS.alice,
      home_project_id: IDS.projectA,
    },
  };
  // Both endpoints are visible to Bob once Project A is shared with him...
  const bobShared = scopeFor(IDS.bob, [IDS.projectA]);
  // ...but a private edge authored by Alice is still not visible to Bob.
  assert.equal(
    canSeeRelationship(bobShared, {
      visibility_scope: 'private',
      author_id: IDS.alice,
      ...endpoints,
    }),
    false,
  );
  // A shared edge is visible to Bob.
  assert.equal(
    canSeeRelationship(bobShared, {
      visibility_scope: 'shared',
      author_id: IDS.alice,
      ...endpoints,
    }),
    true,
  );
  // Alice sees her own private edge.
  assert.equal(
    canSeeRelationship(scopeFor(IDS.alice), {
      visibility_scope: 'private',
      author_id: IDS.alice,
      ...endpoints,
    }),
    true,
  );
});
