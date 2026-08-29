// First-class relationship edges (INV-2): a real stored edge round-trips through
// the read model, is filtered by visibility, and coexists with the synthesised
// belongs_to edge.

import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { resetDatabase, shutdown, baseFixture, IDS } from './helpers.ts';
import { getPool, db } from '../src/adapters/persistence/db.ts';
import { buildContainer } from '../src/adapters/http/container.ts';
import { captureNote } from '../src/application/capture-note.ts';
import { asPrincipalId, asObjectId } from '../src/domain/ids.ts';

let container: ReturnType<typeof buildContainer>;

before(async () => {
  await resetDatabase();
  container = buildContainer();
});
beforeEach(async () => {
  await getPool().query('TRUNCATE workspace CASCADE');
  await baseFixture();
});
after(async () => {
  await shutdown();
});

test('a note carries a synthesised belongs_to edge, not a bare FK', async () => {
  const scope = await container.scopeResolver.resolve(asPrincipalId(IDS.alice));
  assert.ok(scope);
  const note = await captureNote(container, { scope, projectId: IDS.projectA, body: 'n' });

  const edges = await container.relationships.forObject(scope, note.id);
  const belongs = edges.find((e) => e.verb === 'belongs_to');
  assert.ok(belongs, 'belongs_to edge should be present in the read model');
  assert.equal(belongs.toObjectId, IDS.projectA);
  assert.equal(belongs.synthesised, true);
  assert.equal(belongs.id, null); // synthesised: not a persisted row
  assert.equal(belongs.origin, 'explicit');
});

test('a real stored edge round-trips with typed verb, provenance, author, visibility', async () => {
  const scope = await container.scopeResolver.resolve(asPrincipalId(IDS.alice));
  assert.ok(scope);
  const a = await captureNote(container, { scope, projectId: IDS.projectA, body: 'a' });
  const b = await captureNote(container, { scope, projectId: IDS.projectA, body: 'b' });

  const created = await db.transaction((tx) =>
    container.relationships.create(tx, {
      workspaceId: scope.workspaceId,
      fromObjectId: a.id,
      toObjectId: b.id,
      verb: 'related_to',
      origin: 'explicit',
      confidenceState: 'user_confirmed',
      authorId: scope.principalId,
      visibilityScope: 'shared',
      provenance: { kind: 'manual', detail: { via: 'test' } },
    }),
  );
  assert.notEqual(created.id, null);
  assert.equal(created.synthesised, false);

  const edges = await container.relationships.forObject(scope, a.id);
  const real = edges.find((e) => e.verb === 'related_to');
  assert.ok(real);
  assert.equal(real.toObjectId, b.id);
  assert.equal(real.authorId, IDS.alice);
  assert.equal(real.provenance.kind, 'manual');
  assert.equal(real.origin, 'explicit');
});

test('the belongs_to singular constraint rejects a second anchor edge', async () => {
  const scope = await container.scopeResolver.resolve(asPrincipalId(IDS.alice));
  assert.ok(scope);
  const a = await captureNote(container, { scope, projectId: IDS.projectA, body: 'a' });

  await db.transaction((tx) =>
    container.relationships.create(tx, {
      workspaceId: scope.workspaceId,
      fromObjectId: a.id,
      toObjectId: asObjectId(IDS.projectB),
      verb: 'belongs_to',
      origin: 'explicit',
      confidenceState: 'known',
      authorId: scope.principalId,
      visibilityScope: 'shared',
      provenance: { kind: 'test', detail: {} },
    }),
  );

  await assert.rejects(
    db.transaction((tx) =>
      container.relationships.create(tx, {
        workspaceId: scope.workspaceId,
        fromObjectId: a.id,
        toObjectId: asObjectId(IDS.projectA),
        verb: 'belongs_to',
        origin: 'explicit',
        confidenceState: 'known',
        authorId: scope.principalId,
        visibilityScope: 'shared',
        provenance: { kind: 'test', detail: {} },
      }),
    ),
    /relationship_one_belongs_to_per_object|duplicate key/,
  );
});
