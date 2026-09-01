// P3.4 — the AI boundary.
//
// These tests are about the properties the MODEL CANNOT BE TRUSTED TO HAVE:
// authorization, grounding, provenance integrity, refusal, and inertness of
// proposals. Each is asserted against a provider whose output we control, so a
// failure means the pipeline is wrong — not that a model had an off day.

import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { resetDatabase, shutdown, baseFixture, IDS } from './helpers.ts';
import { getPool, db } from '../src/adapters/persistence/db.ts';
import { createApp } from '../src/adapters/http/server.ts';
import { buildContainer } from '../src/adapters/http/container.ts';
import { captureNote } from '../src/application/capture-note.ts';
import { createTask } from '../src/application/create-task.ts';
import { assembleContextSet } from '../src/application/context-set.ts';
import { makeLexicalRetrievalProvider } from '../src/adapters/retrieval/lexical.pg.ts';
import { makeContextClient } from '../assistant/context-client.ts';
import { makeFakeLLMProvider } from '../assistant/adapters/fake-llm.ts';
import { runAsk, resolveIntent, toQueryText } from '../assistant/pipeline.ts';
import type { LLMProvider } from '../assistant/ports/llm.ts';
import { asPrincipalId, asWorkspaceId } from '../src/domain/ids.ts';
import { config } from '../src/config.ts';
import type { ResolvedScope } from '../src/domain/visibility.ts';

let container: ReturnType<typeof buildContainer>;
let server: ReturnType<typeof createApp>;
let baseUrl = '';

before(async () => {
  await resetDatabase();
  container = buildContainer();
  server = createApp(container);
  await new Promise<void>((r) => server.listen(0, r));
  const a = server.address();
  baseUrl = `http://127.0.0.1:${typeof a === 'object' && a ? a.port : 0}`;
});
beforeEach(async () => {
  await getPool().query('TRUNCATE workspace CASCADE');
  await baseFixture();
});
after(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  await shutdown();
});

const cred = (id: string) => `Dev ${id}`;

async function scopeFor(principal: string): Promise<ResolvedScope> {
  const s = await container.scopeResolver.resolve(asPrincipalId(principal));
  assert.ok(s);
  return s;
}
const reindex = () => makeLexicalRetrievalProvider(db).rebuild(asWorkspaceId(IDS.workspace));

function clientFor() {
  return makeContextClient({ baseUrl, serviceToken: config.contextApiServiceToken });
}

/** Seeds one project with two notes, indexed and ready to retrieve. */
async function seedContext() {
  const alice = await scopeFor(IDS.alice);
  const decision = await captureNote(container, {
    scope: alice,
    projectId: IDS.projectA,
    title: 'Chose token bucket over sliding window',
    body: 'Sliding-window needs per-key sorted sets. We should revisit if burst complaints appear.',
  });
  const other = await captureNote(container, {
    scope: alice,
    projectId: IDS.projectA,
    title: 'Retry budget per upstream',
    body: 'A global retry budget hides which upstream is failing.',
  });
  await reindex();
  return { alice, decision, other };
}

/* ============================ Context API auth ========================== */

test('the Context API requires BOTH a service token and an end-user credential', async () => {
  await seedContext();
  const body = JSON.stringify({ purpose: 'question', queryText: 'token bucket' });

  // Neither credential.
  assert.equal(
    (await fetch(`${baseUrl}/ctx/context-set`, { method: 'POST', body })).status,
    401,
  );

  // Service token ONLY — there is no user to act for. This is the confused
  // deputy the two-credential rule exists to prevent (P2.6 §14.1).
  const serviceOnly = await fetch(`${baseUrl}/ctx/context-set`, {
    method: 'POST',
    headers: { 'x-service-token': config.contextApiServiceToken },
    body,
  });
  assert.equal(serviceOnly.status, 401);

  // End-user credential only — the caller is not authorised to reach the surface.
  const userOnly = await fetch(`${baseUrl}/ctx/context-set`, {
    method: 'POST',
    headers: { authorization: cred(IDS.alice) },
    body,
  });
  assert.equal(userOnly.status, 401);

  // Both — allowed.
  const both = await fetch(`${baseUrl}/ctx/context-set`, {
    method: 'POST',
    headers: {
      'x-service-token': config.contextApiServiceToken,
      authorization: cred(IDS.alice),
      'content-type': 'application/json',
    },
    body,
  });
  assert.equal(both.status, 200);
});

test('the principal comes from the credential, never from the body (INV-4a)', async () => {
  const { decision } = await seedContext();

  // Bob authenticates, but asks the Context API to act as Alice via the body.
  const res = await fetch(`${baseUrl}/ctx/context-set`, {
    method: 'POST',
    headers: {
      'x-service-token': config.contextApiServiceToken,
      authorization: cred(IDS.bob),
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      purpose: 'question',
      queryText: 'token bucket',
      principalId: IDS.alice,
      principal: { id: IDS.alice },
    }),
  });
  const set = (await res.json()) as { ok: boolean; items: Array<{ object: { id: string } }> };
  assert.equal(set.ok, true);
  assert.ok(
    !set.items.some((i) => i.object.id === decision.id),
    "a body-supplied principal is ignored; Bob still gets Bob's context",
  );
  assert.equal(set.items.length, 0);
});

/* ========================= Context Set assembly ========================= */

test('the ContextSet carries real objects, provenance and a deterministic order', async () => {
  const { alice, decision } = await seedContext();

  const set = await assembleContextSet(container, alice, {
    purpose: 'question',
    queryText: 'token bucket',
  });
  assert.ok(set.ok);
  assert.ok(set.items.length > 0);

  const item = set.items.find((i) => i.object.id === decision.id);
  assert.ok(item, 'the retrieved object is the real persisted object');
  assert.equal(item.object.title, 'Chose token bucket over sliding window');
  assert.ok(item.factorTrace.length > 0, 'every item records why it was placed');
  assert.ok(item.rank >= 1);

  // The project it belongs to is pulled in as an anchor via a real edge.
  const project = set.items.find((i) => i.object.id === IDS.projectA);
  assert.ok(project, 'the home project is in scope');

  // Determinism: same inputs ⇒ identical ranked output (P2.6 §10.5).
  const again = await assembleContextSet(container, alice, {
    purpose: 'question',
    queryText: 'token bucket',
  });
  assert.ok(again.ok);
  assert.deepEqual(
    again.items.map((i) => [i.object.id, i.rank, i.layer]),
    set.items.map((i) => [i.object.id, i.rank, i.layer]),
  );
  assert.equal(again.weightSetVersion, set.weightSetVersion);
});

test('an empty result and an unavailable engine are DIFFERENT outcomes', async () => {
  const alice = await scopeFor(IDS.alice);
  await reindex();

  // Nothing matches: a fact about the workspace. Still ok.
  const empty = await assembleContextSet(container, alice, {
    purpose: 'question',
    queryText: 'kubernetes helm chart',
  });
  assert.ok(empty.ok, 'no matches is an EMPTY SET, not a failure');
  assert.equal(empty.items.length, 0);

  // A target the principal cannot see is not disclosed as existing.
  const bob = await scopeFor(IDS.bob);
  const denied = await assembleContextSet(container, bob, {
    purpose: 'question',
    queryText: 'anything',
    targetId: IDS.projectA,
  });
  assert.equal(denied.ok, false);
  assert.equal(denied.ok === false && denied.reason, 'target_not_found');

  // A retrieval failure is Unavailable — never silently an empty set.
  const broken = await assembleContextSet(
    { ...container, retrieval: { ...container.retrieval, findSimilar: async () => { throw new Error('index offline'); } } },
    alice,
    { purpose: 'question', queryText: 'token bucket' },
  );
  assert.equal(broken.ok, false);
  assert.equal(broken.ok === false && broken.reason, 'retrieval_failed');
});

/* ====================== Authorization through the AI ==================== */

test('Bob cannot reach Alice\'s context through the assistant', async () => {
  const { decision } = await seedContext();
  const deps = { context: clientFor(), llm: makeFakeLLMProvider() };

  const alice = await runAsk(deps, {
    question: 'Why did we choose token bucket?',
    userCredential: cred(IDS.alice),
  });
  assert.ok(alice.ok);
  assert.ok(alice.evidenceCount > 0, 'Alice gets her own context');
  assert.ok(alice.citations.some((c) => c.objectId === decision.id));

  const bob = await runAsk(deps, {
    question: 'Why did we choose token bucket?',
    userCredential: cred(IDS.bob),
  });
  assert.ok(bob.ok);
  assert.equal(bob.evidenceCount, 0, 'Bob gets nothing — enforced at the data boundary');
  assert.deepEqual(bob.citations, []);
  // And the answer must not contain Alice's content in any form.
  assert.ok(!bob.answer.includes('token bucket') || !bob.answer.includes('sorted sets'));
  assert.ok(!bob.answer.includes('Sliding-window'));
});

test('an assistant answer cites only objects the principal can actually see', async () => {
  const { decision } = await seedContext();

  // A hostile provider that fabricates a citation to a real but invisible id.
  const liar: LLMProvider = {
    async complete() {
      return {
        answer: 'Here is an answer.',
        citedRefs: [decision.id, IDS.projectB, 'not-a-real-id'],
        proposedTasks: [],
      };
    },
    describe: () => ({
      kind: 'fake' as const,
      model: 'liar',
      tier: null,
      defaultEffort: null,
      models: [],
      efforts: [],
    }),
  };

  const bob = await runAsk(
    { context: clientFor(), llm: liar },
    { question: 'anything', userCredential: cred(IDS.bob) },
  );
  assert.ok(bob.ok);
  assert.deepEqual(
    bob.citations,
    [],
    'a fabricated citation cannot become a citation: refs are re-validated against the evidence supplied',
  );
  assert.equal(bob.grounded, false);
});

/* ============================== Grounding ============================== */

test('with no evidence the assistant refuses instead of answering', async () => {
  await reindex();
  const result = await runAsk(
    { context: clientFor(), llm: makeFakeLLMProvider() },
    { question: 'Why did we choose Kubernetes?', userCredential: cred(IDS.bob) },
  );
  assert.ok(result.ok);
  assert.equal(result.evidenceCount, 0);
  assert.equal(result.grounded, false);
  assert.match(result.answer, /don't have any context|nothing/i);
});

test('a context failure stops the turn — no answer from model priors', async () => {
  const failing = {
    async fetchContextSet() {
      return { ok: false as const, reason: 'context_unavailable', detail: 'core down' };
    },
  };
  const result = await runAsk(
    { context: failing, llm: makeFakeLLMProvider() },
    { question: 'Why did we choose token bucket?', userCredential: cred(IDS.alice) },
  );
  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.stage, 'context');
});

test('a malformed or unavailable model response is reported, not rendered', async () => {
  await seedContext();
  const broken: LLMProvider = {
    async complete() {
      throw new Error('model returned malformed JSON');
    },
    describe: () => ({
      kind: 'fake' as const,
      model: 'broken',
      tier: null,
      defaultEffort: null,
      models: [],
      efforts: [],
    }),
  };
  const result = await runAsk(
    { context: clientFor(), llm: broken },
    { question: 'Why token bucket?', userCredential: cred(IDS.alice) },
  );
  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.stage, 'model');
  assert.equal(result.ok === false && result.reason, 'model_unavailable');
});

/* ========================= Intent + query terms ======================== */

test('intent resolution and query reduction are deterministic', () => {
  assert.equal(resolveIntent('What was I working on?'), 'answer');
  assert.equal(resolveIntent('Why did we choose this?'), 'answer');
  assert.equal(resolveIntent('Summarize this project'), 'summarize');
  assert.equal(resolveIntent('Give me a recap'), 'summarize');
  assert.equal(resolveIntent('Extract tasks from this note'), 'extract_tasks');
  assert.equal(resolveIntent('what are the action items here'), 'extract_tasks');

  // Question words carry no retrieval signal and are dropped.
  assert.equal(toQueryText('Why did we choose the token bucket?'), 'choose token bucket');
  // A pure recency question reduces to nothing — which is the signal to anchor
  // the turn on recency rather than search.
  assert.equal(toQueryText('What was I working on?'), '');
});

/* =========================== Task extraction ========================== */

test('extracted tasks are inert proposals anchored to real objects', async () => {
  const { decision } = await seedContext();
  const result = await runAsk(
    { context: clientFor(), llm: makeFakeLLMProvider() },
    {
      question: 'Extract tasks from this',
      userCredential: cred(IDS.alice),
      targetId: decision.id,
    },
  );
  assert.ok(result.ok);
  assert.equal(result.intent, 'extract_tasks');
  assert.ok(result.proposedTasks.length > 0, 'the note contains a "we should revisit" action');

  const proposal = result.proposedTasks[0]!;
  assert.ok(proposal.title.length > 0);
  assert.equal(proposal.sourceObjectId, decision.id, 'anchored to the real source object');
  assert.equal(proposal.projectId, IDS.projectA);

  // Nothing was written. Proposals are inert until the user confirms (INV-8).
  const count = await getPool().query(`SELECT count(*)::int AS n FROM object WHERE type='task'`);
  assert.equal((count.rows[0] as { n: number }).n, 0, 'the assistant created nothing');
});

test('a proposal citing an invented source loses the attribution, not just the text', async () => {
  await seedContext();
  const inventive: LLMProvider = {
    async complete() {
      return {
        answer: 'Found actions.',
        citedRefs: [],
        proposedTasks: [
          { title: 'Do the thing', body: '', sourceRef: '00000000-0000-4000-8000-00000000dead' },
        ],
      };
    },
    describe: () => ({
      kind: 'fake' as const,
      model: 'inventive',
      tier: null,
      defaultEffort: null,
      models: [],
      efforts: [],
    }),
  };
  const result = await runAsk(
    { context: clientFor(), llm: inventive },
    { question: 'extract tasks', userCredential: cred(IDS.alice) },
  );
  assert.ok(result.ok);
  assert.equal(result.proposedTasks.length, 1);
  assert.equal(
    result.proposedTasks[0]!.sourceObjectId,
    null,
    'an unverifiable source becomes null rather than a false provenance claim',
  );
});

/* ======================== Confirmed task creation ===================== */

test('task creation is a user action, authorized like any other write', async () => {
  const { alice, decision } = await seedContext();

  const task = await createTask(container, {
    scope: alice,
    projectId: IDS.projectA,
    title: 'Revisit burst tolerance',
    body: 'From the rate limiting decision.',
    sourceObjectId: decision.id,
    assistantAssisted: true,
  });
  assert.equal(task.type, 'task');
  assert.equal(task.homeProjectId, IDS.projectA);
  assert.equal(task.createdBy, IDS.alice, 'attributed to the USER, never the model');
  assert.equal((task.attributes as Record<string, unknown>)['createdVia'], 'assistant_proposal');

  // A real relationship records where it came from (INV-2).
  const edges = await container.relationships.forObject(alice, task.id);
  const derived = edges.find((e) => e.verb === 'derived_from');
  assert.ok(derived, 'the task links back to the context it was extracted from');
  assert.equal(derived.toObjectId, decision.id);
  assert.equal(derived.confidenceState, 'user_confirmed');

  // It is now an ordinary graph object.
  const graphNode = await container.objects.findVisible(alice, task.id);
  assert.ok(graphNode);
});

test('Bob cannot create a task in a project he cannot see', async () => {
  await seedContext();
  const bob = await scopeFor(IDS.bob);

  await assert.rejects(
    createTask(container, { scope: bob, projectId: IDS.projectA, title: 'sneaky' }),
    /not found/i,
  );
  const n = await getPool().query(`SELECT count(*)::int AS n FROM object WHERE type='task'`);
  assert.equal((n.rows[0] as { n: number }).n, 0);

  // Over HTTP too.
  const res = await fetch(`${baseUrl}/api/projects/${IDS.projectA}/tasks`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: cred(IDS.bob) },
    body: JSON.stringify({ title: 'sneaky' }),
  });
  assert.equal(res.status, 404);
});

/* ====================== Summarization scope ========================== */

test('summarization is bounded by the scope it was asked for', async () => {
  const { alice, decision } = await seedContext();
  // A second project with its own context that must not bleed in.
  await captureNote(container, {
    scope: alice,
    projectId: IDS.projectB,
    title: 'Unrelated project note',
    body: 'Nothing to do with rate limiting.',
  });
  await reindex();

  const result = await runAsk(
    { context: clientFor(), llm: makeFakeLLMProvider() },
    {
      question: 'Summarize this',
      userCredential: cred(IDS.alice),
      targetId: decision.id,
    },
  );
  assert.ok(result.ok);
  assert.equal(result.intent, 'summarize');
  assert.ok(result.citations.length > 0, 'a summary cites the objects it synthesised');
  assert.ok(
    result.citations.every((c) => c.objectId !== undefined),
    'every citation is a real navigable object id',
  );
  assert.ok(!result.answer.includes('Unrelated project note'), 'out-of-scope context is not summarised');
});
