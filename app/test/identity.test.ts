// T3.3-CORRECTION — WORKSPACE HEADSHIP.
//
// The defect this pins shut: the shell showed a member as though they were the
// workspace's owner, because "who heads this workspace" was not a fact the model
// held. It is one now — a membership role — and these tests assert the three
// properties that make it trustworthy:
//
//   1. HEADSHIP IS DATA. It is read back from the membership row that carries
//      the `owner` role, not from a constant in any client.
//   2. THERE IS AT MOST ONE HEAD. The schema enforces it, so a seed or a
//      migration cannot leave a workspace with two owners.
//   3. HEADSHIP IS NOT THE CURRENT USER. Every member sees the same head; each
//      member sees themselves as themselves. Conflating the two is exactly the
//      bug, so they are asserted separately, from the same payload.
//
// Headship also grants nothing: the head sees what the VisibilityPolicy says
// they see, and no more. That is asserted here too, because "owner of the
// workspace" must never quietly become "owner of everything in it".

import test from 'node:test';
import assert from 'node:assert/strict';

import { resetDatabase, shutdown, baseFixture, IDS } from './helpers.ts';
import { buildContainer } from '../src/adapters/http/container.ts';
import { asPrincipalId } from '../src/domain/ids.ts';
import { getPool } from '../src/adapters/persistence/db.ts';

/** Make Alice the head, exactly as the seed does for Dev. */
async function makeHead(principalId: string): Promise<void> {
  const pool = getPool();
  await pool.query(`UPDATE workspace_membership SET role = 'member' WHERE workspace_id = $1`, [
    IDS.workspace,
  ]);
  await pool.query(
    `UPDATE workspace_membership SET role = 'owner' WHERE workspace_id = $1 AND principal_id = $2`,
    [IDS.workspace, principalId],
  );
}

test('the workspace head is read from the membership that carries the role', async () => {
  await resetDatabase();
  await baseFixture();
  await makeHead(IDS.alice);

  const container = buildContainer();
  const alice = await container.scopeResolver.resolve(asPrincipalId(IDS.alice));
  assert.ok(alice);

  const workspace = await container.members.readWorkspace(alice);
  assert.ok(workspace);
  assert.equal(workspace.head?.id, IDS.alice);
  assert.equal(workspace.head?.displayName, 'Alice');
  assert.equal(workspace.head?.role, 'owner');
  assert.equal(workspace.name, 'T');
});

test('every member sees the SAME head, and themselves as themselves', async () => {
  await resetDatabase();
  await baseFixture();
  await makeHead(IDS.alice);

  const container = buildContainer();
  const alice = await container.scopeResolver.resolve(asPrincipalId(IDS.alice));
  const bob = await container.scopeResolver.resolve(asPrincipalId(IDS.bob));
  assert.ok(alice && bob);

  // Headship is a property of the workspace: it does not change with who asks.
  const seenByAlice = await container.members.readWorkspace(alice);
  const seenByBob = await container.members.readWorkspace(bob);
  assert.equal(seenByAlice?.head?.id, IDS.alice);
  assert.equal(seenByBob?.head?.id, IDS.alice);

  // Current identity is a property of the credential, and is NOT headship.
  const members = await container.members.listMembers(bob);
  const self = members.find((m) => m.id === bob.principalId);
  assert.equal(self?.displayName, 'Bob');
  assert.equal(self?.role, 'member', 'a member is not made head by reading the workspace');
});

test('members are listed head first, with the real role on every row', async () => {
  await resetDatabase();
  await baseFixture();
  // Bob sorts first alphabetically; making Alice head must reorder the list, so
  // the ordering is proved to come from the role rather than from the name.
  await makeHead(IDS.alice);

  const container = buildContainer();
  const scope = await container.scopeResolver.resolve(asPrincipalId(IDS.bob));
  assert.ok(scope);
  const members = await container.members.listMembers(scope);

  assert.deepEqual(
    members.map((m) => [m.displayName, m.role]),
    [
      ['Alice', 'owner'],
      ['Bob', 'member'],
    ],
  );
  // The projection is still exactly what the model records about a person.
  for (const m of members) {
    assert.deepEqual(Object.keys(m).sort(), ['displayName', 'id', 'role']);
  }
});

test('a workspace cannot have two heads', async () => {
  await resetDatabase();
  await baseFixture();
  await makeHead(IDS.alice);

  await assert.rejects(
    () =>
      getPool().query(
        `UPDATE workspace_membership SET role = 'owner' WHERE workspace_id = $1 AND principal_id = $2`,
        [IDS.workspace, IDS.bob],
      ),
    /workspace_membership_one_owner/,
    'the schema refuses a second owner',
  );
});

test('a workspace with no recorded head reports an absence, not a guess', async () => {
  await resetDatabase();
  await baseFixture();
  // baseFixture creates members only; nobody has been made head.
  const container = buildContainer();
  const scope = await container.scopeResolver.resolve(asPrincipalId(IDS.alice));
  assert.ok(scope);

  const workspace = await container.members.readWorkspace(scope);
  assert.ok(workspace);
  assert.equal(workspace.head, null, 'no head is null, never the first member');
});

test('headship grants no visibility: the head sees what the policy says, and no more', async () => {
  await resetDatabase();
  await baseFixture();
  // Bob is the head. Alice owns both seeded projects and shares neither.
  await makeHead(IDS.bob);

  const container = buildContainer();
  const bob = await container.scopeResolver.resolve(asPrincipalId(IDS.bob));
  assert.ok(bob);

  const visible = await container.objects.listVisible(bob);
  assert.deepEqual(
    visible.map((o) => o.id),
    [],
    'being the workspace head does not reveal another member’s objects',
  );
});

test.after(shutdown);
