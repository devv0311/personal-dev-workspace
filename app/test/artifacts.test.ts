// T3.3-CORRECTION — THE ARTIFACT ORBIT.
//
// The command view's perimeter used to carry six static capability circles.
// They were duplicates of the Skills Deck and they were not data. What replaces
// them is a feed of OUTPUTS — things this system produced by doing work — and
// the properties that make that feed trustworthy are asserted here:
//
//   1. NOTHING IS SEEDED. An empty system produces an empty orbit. A capture
//      that has not been delivered yet is a queued event, not an output, and
//      does not appear. Only after the worker really runs does an artifact
//      exist.
//   2. EVERY NODE IS TRACEABLE. Each artifact carries a stable id, a real
//      instant, the system that produced it, and — where one exists — the
//      internal object or the external URL behind it.
//   3. AUTHORIZATION HOLDS. An artifact derived from an object is only visible
//      to a principal who may see that object.
//   4. READ STATE IS PERSONAL. One member opening an artifact does not mark it
//      read for anyone else.
//   5. UNAVAILABLE ≠ EMPTY. A source that could not be read is reported as
//      unavailable with its reason, alongside what the others produced.

import test from 'node:test';
import assert from 'node:assert/strict';

import { resetDatabase, shutdown, baseFixture, IDS } from './helpers.ts';
import { buildContainer } from '../src/adapters/http/container.ts';
import { captureNote } from '../src/application/capture-note.ts';
import { createTask } from '../src/application/create-task.ts';
import { readWorkerActivity } from '../src/application/worker-activity.ts';
import { readArtifactFeed, markArtifactRead } from '../src/application/artifacts.ts';
import { drainOnce } from '../src/worker/index.ts';
import { asPrincipalId } from '../src/domain/ids.ts';
import type { ExternalActivityProvider } from '../src/ports/external-activity.ts';
import type { ExternalSnapshot } from '../src/domain/external.ts';
import type { ResolvedScope } from '../src/domain/visibility.ts';

const POLL = 1000;
const REPO = 'devv0311/personal-dev-workspace';

/** A snapshot in which every section is unavailable — the offline case. */
const DOWN: ExternalSnapshot = {
  source: 'github',
  repository: REPO,
  authMode: 'anonymous',
  fetchedAt: '2026-08-31T00:00:00.000Z',
  stale: true,
  staleReason: 'network unreachable',
  sections: {
    pull_request: { ok: false, kind: 'pull_request', error: 'network unreachable' },
    issue: { ok: false, kind: 'issue', error: 'network unreachable' },
    workflow_run: { ok: false, kind: 'workflow_run', error: 'network unreachable' },
  },
};

/** A snapshot carrying one real-shaped entity per artifact-bearing kind. */
const UP: ExternalSnapshot = {
  source: 'github',
  repository: REPO,
  authMode: 'anonymous',
  fetchedAt: '2026-08-31T12:00:00.000Z',
  stale: false,
  staleReason: null,
  sections: {
    pull_request: {
      ok: true,
      kind: 'pull_request',
      total: 1,
      entities: [
        {
          ref: 'github:pull_request:18',
          source: 'github',
          kind: 'pull_request',
          externalId: '18',
          title: 'Repository cleanup and current-state sync',
          actor: 'devv0311',
          at: '2026-08-31T11:00:00.000Z',
          state: 'merged',
          url: `https://github.com/${REPO}/pull/18`,
          detail: { number: 18 },
        },
      ],
    },
    workflow_run: {
      ok: true,
      kind: 'workflow_run',
      total: 1,
      entities: [
        {
          ref: 'github:workflow_run:99',
          source: 'github',
          kind: 'workflow_run',
          externalId: '99',
          title: 'CI',
          actor: null,
          at: '2026-08-31T11:30:00.000Z',
          state: 'failure',
          url: `https://github.com/${REPO}/actions/runs/99`,
          detail: { branch: 'feature/x' },
        },
      ],
    },
    issue: { ok: true, kind: 'issue', total: 0, entities: [] },
  },
};

const stub = (snapshot: ExternalSnapshot, configured = true): ExternalActivityProvider => ({
  describe: () => ({ source: 'github', repository: REPO, configured, authenticated: false }),
  snapshot: async () => snapshot,
});

const container = (snapshot: ExternalSnapshot = DOWN, configured = true) =>
  buildContainer(undefined, stub(snapshot, configured));

async function scopes(): Promise<{ alice: ResolvedScope; bob: ResolvedScope }> {
  const c = buildContainer();
  const alice = await c.scopeResolver.resolve(asPrincipalId(IDS.alice));
  const bob = await c.scopeResolver.resolve(asPrincipalId(IDS.bob));
  assert.ok(alice && bob);
  return { alice, bob };
}

async function feed(deps: ReturnType<typeof container>, scope: ResolvedScope) {
  const worker = await readWorkerActivity(deps, scope, POLL);
  return readArtifactFeed(deps, scope, worker);
}

test('a workspace that has produced nothing has an empty orbit', async () => {
  await resetDatabase();
  await baseFixture();
  const { alice } = await scopes();
  const deps = container();

  const result = await feed(deps, alice);
  assert.deepEqual(result.items, [], 'nothing is invented to fill the ring');
  assert.equal(result.unread, 0);
  // And the forge's failure is REPORTED rather than read as "no artifacts".
  const failed = result.sources.filter((s) => !s.ok);
  assert.equal(failed.length, 3);
  for (const s of failed) assert.match(s.reason ?? '', /network unreachable/);
});

test('a queued event is not an output; a delivered run is', async () => {
  await resetDatabase();
  await baseFixture();
  const { alice } = await scopes();
  const deps = container();

  await captureNote(deps, {
    scope: alice,
    projectId: IDS.projectA,
    title: 'Rate limiter: token bucket',
    body: 'O(1) per request.',
  });

  // The capture wrote a real outbox event. It has NOT run yet, so there is no
  // output — and the orbit does not pretend there is one.
  assert.deepEqual((await feed(deps, alice)).items, []);

  // The worker really runs.
  await drainOnce();

  const after = await feed(deps, alice);
  assert.equal(after.items.length, 1);
  const artifact = after.items[0]!;
  assert.equal(artifact.category, 'routine');
  assert.equal(artifact.source, 'outbox-worker');
  assert.equal(artifact.state, 'delivered');
  // Traceable: the consumer that actually ran, and the object it concerned.
  assert.match(artifact.title, /fts-maintenance/);
  assert.match(artifact.title, /token bucket/i);
  assert.equal(artifact.detail.consumer, 'fts-maintenance');
  assert.equal(artifact.detail.event, 'object.created');
  assert.ok(artifact.objectId, 'the artifact names the real object it concerned');
  assert.ok(Number.isFinite(Date.parse(artifact.createdAt)), 'a real instant');
  assert.ok(artifact.id.startsWith('worker:'), 'a stable reference, not a position');
});

test('forge activity becomes artifacts, each keeping its own identity and URL', async () => {
  await resetDatabase();
  await baseFixture();
  const { alice } = await scopes();

  const result = await feed(container(UP), alice);
  const byId = new Map(result.items.map((a) => [a.id, a]));

  const pr = byId.get('github:pull_request:18');
  assert.ok(pr);
  assert.equal(pr.category, 'pull_request');
  assert.equal(pr.source, 'github');
  assert.equal(pr.state, 'merged');
  assert.equal(pr.url, `https://github.com/${REPO}/pull/18`);
  assert.equal(pr.objectId, null, 'a forge entity is not an internal object');

  const ci = byId.get('github:workflow_run:99');
  assert.ok(ci);
  assert.equal(ci.category, 'ci');
  assert.equal(ci.state, 'failure');
  assert.equal(ci.detail.branch, 'feature/x');

  // Newest first, deterministically.
  assert.deepEqual(
    result.items.map((a) => a.id),
    ['github:workflow_run:99', 'github:pull_request:18'],
  );
  // An empty-but-readable section contributes nothing and is not an error.
  assert.equal(result.sources.find((s) => s.source === 'github:issue')?.ok, true);
});

test('an object kept from an assistant proposal is an AI result artifact', async () => {
  await resetDatabase();
  await baseFixture();
  const { alice } = await scopes();
  const deps = container();

  const note = await captureNote(deps, {
    scope: alice,
    projectId: IDS.projectA,
    title: 'Open question: idempotency keys',
    body: 'Do we require them on every mutating route?',
  });
  const task = await createTask(deps, {
    scope: alice,
    projectId: IDS.projectA,
    title: 'Decide the idempotency-key policy',
    body: '',
    sourceObjectId: note.id,
    assistantAssisted: true,
  });

  const items = (await feed(deps, alice)).items;
  const ai = items.find((a) => a.category === 'ai_result');
  assert.ok(ai, 'the kept proposal is an artifact');
  assert.equal(ai.id, `object:${task.id}`);
  assert.equal(ai.objectId, task.id);
  assert.equal(ai.source, 'devworkspace');
  assert.equal(ai.detail.createdVia, 'assistant_proposal');
  // An ordinary capture is NOT an AI result — the category is read from the
  // object's own attribute, never guessed from its type.
  assert.equal(items.some((a) => a.objectId === note.id && a.category === 'ai_result'), false);
});

test('artifacts derived from objects honour the authorization boundary', async () => {
  await resetDatabase();
  await baseFixture();
  const { alice, bob } = await scopes();
  const deps = container();

  const note = await captureNote(deps, {
    scope: alice,
    projectId: IDS.projectA,
    title: 'Auth header parsing is the boundary',
    body: 'Derive the principal once, at the edge.',
  });
  await createTask(deps, {
    scope: alice,
    projectId: IDS.projectA,
    title: 'Move principal derivation to the edge',
    body: '',
    sourceObjectId: note.id,
    assistantAssisted: true,
  });
  await drainOnce();

  const mine = await feed(deps, alice);
  assert.ok(mine.items.length > 0);

  // Bob is a member with no share: he learns nothing about Alice's outputs —
  // not their titles, not their ids, not even how many there are.
  const theirs = await feed(deps, bob);
  assert.deepEqual(theirs.items, []);
  assert.equal(JSON.stringify(theirs).includes('Auth header parsing'), false);
});

test('read state is per person: opening an artifact marks it read for you alone', async () => {
  await resetDatabase();
  await baseFixture();
  const { alice, bob } = await scopes();
  const deps = container(UP);

  // Both principals can see the same forge artifacts (they are not objects).
  const before = await feed(deps, alice);
  assert.ok(before.items.every((a) => a.unread), 'nothing is read before it is opened');
  assert.equal(before.unread, before.items.length);

  await markArtifactRead(deps, alice, 'github:pull_request:18');

  const afterAlice = await feed(deps, alice);
  assert.equal(afterAlice.items.find((a) => a.id === 'github:pull_request:18')?.unread, false);
  assert.equal(afterAlice.unread, before.items.length - 1);

  const afterBob = await feed(deps, bob);
  assert.equal(
    afterBob.items.find((a) => a.id === 'github:pull_request:18')?.unread,
    true,
    'one member reading it does not mark it read for another',
  );

  // Marking twice is idempotent rather than an error.
  await markArtifactRead(deps, alice, 'github:pull_request:18');
  assert.equal((await feed(deps, alice)).unread, before.items.length - 1);
});

test('an unconfigured forge says so, and still reports what the other sources made', async () => {
  await resetDatabase();
  await baseFixture();
  const { alice } = await scopes();
  const deps = container(DOWN, false);

  await captureNote(deps, {
    scope: alice,
    projectId: IDS.projectA,
    title: 'Retry budget per upstream',
    body: 'Budget per upstream, surface the breach.',
  });
  await drainOnce();

  const result = await feed(deps, alice);
  assert.equal(result.items.length, 1, 'the routine output is still there');
  assert.equal(result.items[0]?.category, 'routine');
  for (const s of result.sources.filter((x) => !x.ok)) {
    assert.match(s.reason ?? '', /No repository is configured/);
  }
  // The worker source is reported as fine — its silence is not the forge's.
  assert.equal(result.sources.find((s) => s.source === 'outbox-worker')?.ok, true);
});

test.after(shutdown);
