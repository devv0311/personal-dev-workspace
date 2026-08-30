// P3.4 — AI evaluation set (P2.3 §14).
//
// "The model returned plausible text" is not evidence of quality. This is a
// small, realistic, LABELLED set of developer-context questions, scored on the
// dimensions that actually matter for this system:
//
//   intent            — did query understanding route the turn correctly
//   retrieval         — did the object that ANSWERS the question get retrieved
//   provenance        — is every citation a real object the principal can see
//   grounding         — did an answer with evidence actually cite it
//   authorization     — did a principal get exactly their own context
//   extraction        — are proposed tasks anchored to real sources
//
// It runs against the deterministic provider, so a regression here is a
// regression in the PIPELINE. Swapping in a real provider changes answer prose
// but must not change the authorization, provenance or grounding columns —
// which is exactly why those are the ones asserted.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { resetDatabase, shutdown, baseFixture, IDS } from './helpers.ts';
import { getPool, db } from '../src/adapters/persistence/db.ts';
import { createApp } from '../src/adapters/http/server.ts';
import { buildContainer } from '../src/adapters/http/container.ts';
import { captureNote } from '../src/application/capture-note.ts';
import { makeLexicalRetrievalProvider } from '../src/adapters/retrieval/lexical.pg.ts';
import { makeContextClient } from '../assistant/context-client.ts';
import { makeFakeLLMProvider } from '../assistant/adapters/fake-llm.ts';
import { runAsk, toQueryText, type AskResult } from '../assistant/pipeline.ts';
import { assembleContextSet } from '../src/application/context-set.ts';
import { asPrincipalId, asWorkspaceId } from '../src/domain/ids.ts';
import { config } from '../src/config.ts';

let container: ReturnType<typeof buildContainer>;
let server: ReturnType<typeof createApp>;
let baseUrl = '';
const ids: Record<string, string> = {};

const cred = (id: string) => `Dev ${id}`;

before(async () => {
  await resetDatabase();
  container = buildContainer();
  server = createApp(container);
  await new Promise<void>((r) => server.listen(0, r));
  const a = server.address();
  baseUrl = `http://127.0.0.1:${typeof a === 'object' && a ? a.port : 0}`;

  await getPool().query('TRUNCATE workspace CASCADE');
  await baseFixture();
  const alice = await container.scopeResolver.resolve(asPrincipalId(IDS.alice));
  assert.ok(alice);

  // Realistic developer context, captured the way the app captures it.
  const seed = async (key: string, projectId: string, title: string, body: string) => {
    const o = await captureNote(container, { scope: alice, projectId, title, body });
    ids[key] = o.id;
  };
  await seed(
    'rateLimit',
    IDS.projectA,
    'Chose token bucket over sliding window',
    'Sliding-window needs per-key sorted sets; token bucket is O(1) and good enough for our RPS. We should revisit if burst tolerance complaints appear.',
  );
  await seed(
    'retry',
    IDS.projectA,
    'Retry budget per upstream',
    'A global retry budget hides which upstream is actually failing. Budget per upstream and surface the breach as an event.',
  );
  await seed(
    'auth',
    IDS.projectA,
    'Auth header parsing is the boundary',
    'The principal must never come from the request body. Derive it once, at the edge, from a credential the server validates.',
  );
  await seed(
    'postgres',
    IDS.projectB,
    'Postgres chosen for persistence',
    'One store keeps the index transactionally consistent with its source text. Revisit only if write volume forces a split.',
  );

  // Bob is a member with no share — his authorized context is empty.
  await makeLexicalRetrievalProvider(db).rebuild(asWorkspaceId(IDS.workspace));
});

after(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  await shutdown();
});

interface EvalCase {
  readonly question: string;
  readonly principal: string;
  readonly expectIntent: 'answer' | 'summarize' | 'extract_tasks';
  /** Retrieval is relevant if ANY of these reached the evidence set. */
  readonly shouldRetrieve?: readonly string[];
  /**
   * Stronger claim: the object must be placed by the RETRIEVAL factor, not by
   * recency or by the relationship expansion. Measuring citation alone hid a
   * real recall bug once — the pipeline cited the right note only because the
   * recency fallback happened to include it (see `toOrQuery`).
   */
  readonly shouldRetrieveByIndex?: readonly string[];
  /** These must never appear for this principal. */
  readonly mustNotRetrieve?: readonly string[];
  readonly expectEmpty?: boolean;
  readonly targetKey?: string;
  readonly expectProposals?: boolean;
}

const CASES: readonly EvalCase[] = [
  {
    question: 'Why did we choose token bucket?',
    principal: IDS.alice,
    expectIntent: 'answer',
    shouldRetrieve: ['rateLimit'],
    shouldRetrieveByIndex: ['rateLimit'],
  },
  {
    question: 'What do we know about retry budgets?',
    principal: IDS.alice,
    expectIntent: 'answer',
    shouldRetrieve: ['retry'],
    shouldRetrieveByIndex: ['retry'],
  },
  {
    question: 'What decisions are related to persistence?',
    principal: IDS.alice,
    expectIntent: 'answer',
    shouldRetrieve: ['postgres'],
    shouldRetrieveByIndex: ['postgres'],
  },
  {
    question: 'Where is the authorization boundary?',
    principal: IDS.alice,
    expectIntent: 'answer',
    shouldRetrieve: ['auth'],
    shouldRetrieveByIndex: ['auth'],
  },
  {
    question: 'What was I working on?',
    principal: IDS.alice,
    expectIntent: 'answer',
    // No usable search terms — recency must anchor the turn instead.
    shouldRetrieve: ['rateLimit', 'retry', 'auth', 'postgres'],
  },
  {
    question: 'Summarize this project',
    principal: IDS.alice,
    expectIntent: 'summarize',
    targetKey: 'rateLimit',
    shouldRetrieve: ['rateLimit'],
  },
  {
    question: 'Extract tasks from this note',
    principal: IDS.alice,
    expectIntent: 'extract_tasks',
    targetKey: 'rateLimit',
    expectProposals: true,
  },
  // --- authorization: the same questions, as a principal with no access ----
  {
    question: 'Why did we choose token bucket?',
    principal: IDS.bob,
    expectIntent: 'answer',
    expectEmpty: true,
    mustNotRetrieve: ['rateLimit', 'retry', 'auth', 'postgres'],
  },
  {
    question: 'What was I working on?',
    principal: IDS.bob,
    expectIntent: 'answer',
    expectEmpty: true,
    mustNotRetrieve: ['rateLimit', 'retry', 'auth', 'postgres'],
  },
];

test('evaluation set: retrieval, provenance, grounding, authorization, extraction', async () => {
  const deps = {
    context: makeContextClient({ baseUrl, serviceToken: config.contextApiServiceToken }),
    llm: makeFakeLLMProvider(),
  };

  const score = {
    intent: { pass: 0, total: 0 },
    retrieval: { pass: 0, total: 0 },
    provenance: { pass: 0, total: 0 },
    grounding: { pass: 0, total: 0 },
    authorization: { pass: 0, total: 0 },
    extraction: { pass: 0, total: 0 },
    indexRecall: { pass: 0, total: 0 },
  };
  const failures: string[] = [];

  for (const c of CASES) {
    const outcome = await runAsk(deps, {
      question: c.question,
      userCredential: cred(c.principal),
      targetId: c.targetKey ? ids[c.targetKey]! : null,
    });
    assert.ok(outcome.ok, `"${c.question}" should complete: ${JSON.stringify(outcome)}`);
    const r = outcome as AskResult;
    const label = `[${c.principal === IDS.alice ? 'alice' : 'bob'}] "${c.question}"`;

    // --- intent -----------------------------------------------------------
    score.intent.total++;
    if (r.intent === c.expectIntent) score.intent.pass++;
    else failures.push(`${label}: intent ${r.intent} ≠ ${c.expectIntent}`);

    // Evidence ids actually delivered for this turn.
    const cited = new Set(r.citations.map((x) => x.objectId));

    // --- authorization ----------------------------------------------------
    if (c.expectEmpty || c.mustNotRetrieve) {
      score.authorization.total++;
      const leaked = (c.mustNotRetrieve ?? []).filter((k) => cited.has(ids[k]!));
      const emptyOk = c.expectEmpty ? r.evidenceCount === 0 : true;
      if (leaked.length === 0 && emptyOk) score.authorization.pass++;
      else failures.push(`${label}: LEAK ${leaked.join(',')} evidence=${r.evidenceCount}`);
    }

    // --- retrieval relevance ---------------------------------------------
    if (c.shouldRetrieve) {
      score.retrieval.total++;
      // Relevant if the answering object was cited (the strongest signal that
      // it both retrieved AND was used).
      if (c.shouldRetrieve.some((k) => cited.has(ids[k]!))) score.retrieval.pass++;
      else failures.push(`${label}: retrieved none of ${c.shouldRetrieve.join(',')}`);
    }

    // --- index recall: did the INDEX actually surface it -------------------
    if (c.shouldRetrieveByIndex) {
      score.indexRecall.total++;
      const scope = await container.scopeResolver.resolve(asPrincipalId(c.principal));
      assert.ok(scope);
      const set = await assembleContextSet(container, scope, {
        purpose: 'question',
        queryText: toQueryText(c.question),
      });
      assert.ok(set.ok);
      const byRetrieval = new Set(
        set.items
          .filter((i) => i.factorTrace.some((f) => f.factor === 'retrieval'))
          .map((i) => i.object.id),
      );
      if (c.shouldRetrieveByIndex.some((k) => byRetrieval.has(ids[k]!))) score.indexRecall.pass++;
      else failures.push(`${label}: index did not retrieve ${c.shouldRetrieveByIndex.join(',')}`);
    }

    // --- provenance correctness ------------------------------------------
    // Every citation must be a REAL object this principal can see.
    score.provenance.total++;
    let provenanceOk = true;
    for (const citation of r.citations) {
      const visible = await fetch(`${baseUrl}/api/objects/${citation.objectId}`, {
        headers: { authorization: cred(c.principal) },
      });
      if (visible.status !== 200) {
        provenanceOk = false;
        failures.push(`${label}: cited ${citation.objectId} which is not visible (${visible.status})`);
      }
    }
    if (provenanceOk) score.provenance.pass++;

    // --- grounding --------------------------------------------------------
    score.grounding.total++;
    // With evidence, an answer must cite. Without evidence, it must NOT claim
    // to be grounded.
    const groundingOk = r.evidenceCount > 0 ? r.grounded && cited.size > 0 : !r.grounded;
    if (groundingOk) score.grounding.pass++;
    else failures.push(`${label}: grounding wrong (evidence=${r.evidenceCount} grounded=${r.grounded})`);

    // --- extraction validity ---------------------------------------------
    if (c.expectProposals) {
      score.extraction.total++;
      const valid =
        r.proposedTasks.length > 0 &&
        r.proposedTasks.every(
          (t) => t.title.trim().length > 0 && (t.sourceObjectId === null || cited.size >= 0),
        ) &&
        r.proposedTasks.every((t) => !t.sourceObjectId || Object.values(ids).includes(t.sourceObjectId));
      if (valid) score.extraction.pass++;
      else failures.push(`${label}: invalid task proposals ${JSON.stringify(r.proposedTasks)}`);
    }
  }

  const pct = (m: { pass: number; total: number }) =>
    m.total === 0 ? 'n/a' : `${m.pass}/${m.total} (${Math.round((m.pass / m.total) * 100)}%)`;
  console.log('\n  P3.4 evaluation scorecard');
  console.log(`    intent          ${pct(score.intent)}`);
  console.log(`    retrieval       ${pct(score.retrieval)}`);
  console.log(`    index recall    ${pct(score.indexRecall)}`);
  console.log(`    provenance      ${pct(score.provenance)}`);
  console.log(`    grounding       ${pct(score.grounding)}`);
  console.log(`    authorization   ${pct(score.authorization)}`);
  console.log(`    extraction      ${pct(score.extraction)}`);
  if (failures.length) console.log('    failures:\n      - ' + failures.join('\n      - '));

  // Authorization and provenance are HARD invariants — anything below 100% is
  // a defect, not a quality score (P2.3 §14: "zero disclosures", hard invariant).
  assert.equal(score.authorization.pass, score.authorization.total, 'authorization must be perfect');
  assert.equal(score.provenance.pass, score.provenance.total, 'provenance must be perfect');
  assert.equal(score.grounding.pass, score.grounding.total, 'grounding must be perfect');
  // Retrieval and intent are quality measures with a floor, not invariants.
  assert.ok(score.intent.pass / score.intent.total >= 0.9, 'intent routing ≥ 90%');
  assert.ok(score.retrieval.pass / score.retrieval.total >= 0.8, 'retrieval relevance ≥ 80%');
  assert.ok(
    score.indexRecall.pass / score.indexRecall.total >= 0.8,
    'the index itself must surface the answering object, not the recency fallback',
  );
  assert.equal(score.extraction.pass, score.extraction.total, 'task extraction must be valid');
});
