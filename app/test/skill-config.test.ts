// T3.3-CORRECTION — MODEL / EFFORT CONFIGURATION.
//
// A Skills card now carries a configuration control. The rule that makes it
// honest rather than decorative:
//
//     A UI OPTION IS NOT RUNTIME SUPPORT.
//
// So the runtime declares what it can actually execute, the pipeline REFUSES
// anything outside that declaration before it fetches context or calls a model,
// and the result reports the configuration that actually ran rather than the
// one that was asked for. These tests assert each of those, including the
// specific fabrications the task named: Fable support and XHigh effort must not
// be claimed by a runtime that does not have them.
//
// The pipeline is driven with stub context and stub providers: this is about
// what is refused and what is reported, which must not depend on a network.

import test from 'node:test';
import assert from 'node:assert/strict';

import { runAsk, type ContextClient, type ContextSetResult } from '../assistant/pipeline.ts';
import { makeFakeLLMProvider } from '../assistant/adapters/fake-llm.ts';
import { makeAnthropicLLMProvider } from '../assistant/adapters/anthropic-llm.ts';
import {
  EFFORT_LEVELS,
  MODEL_TIERS,
  type LLMProvider,
  type LlmRequest,
} from '../assistant/ports/llm.ts';

/** One evidence item, so the pipeline has something real to ground on. */
const CONTEXT: ContextSetResult = {
  ok: true,
  weightSetVersion: 'w1',
  purpose: 'question',
  layersPresent: ['direct'],
  items: [
    {
      object: {
        id: '00000000-0000-4000-8000-0000000000e1',
        type: 'note',
        title: 'Token bucket',
        body: 'O(1) per request, good enough for our RPS.',
        homeProjectId: null,
        createdAt: '2026-08-30T00:00:00.000Z',
        updatedAt: '2026-08-30T00:00:00.000Z',
      },
      viaRelationships: [],
      layer: 'direct',
      rank: 1,
      factorTrace: [],
    },
  ],
  generatedAt: '2026-08-31T00:00:00.000Z',
  resolved: { queryText: 'token bucket', targetId: null, projectId: null },
};

const context: ContextClient = { fetchContextSet: async () => CONTEXT };

/** A provider that records what it was asked to run. */
function recordingProvider(
  models: readonly string[],
  efforts: readonly string[],
): { provider: LLMProvider; seen: LlmRequest[] } {
  const seen: LlmRequest[] = [];
  const provider: LLMProvider = {
    async complete(request) {
      seen.push(request);
      return {
        answer: 'An answer.',
        citedRefs: [CONTEXT.ok ? CONTEXT.items[0]!.object.id : ''],
        proposedTasks: [],
        usedModel: request.model ? `claude-${request.model}-x` : 'claude-default',
        usedEffort: request.effort ?? 'medium',
      };
    },
    describe: () => ({
      kind: 'anthropic',
      model: 'claude-sonnet-5',
      tier: 'sonnet',
      defaultEffort: 'medium',
      models: models as never,
      efforts: efforts as never,
    }),
  };
  return { provider, seen };
}

const ask = (llm: LLMProvider, extra: Record<string, unknown> = {}) =>
  runAsk({ context, llm }, { question: 'Why token bucket?', userCredential: 'Dev x', ...extra });

/* --------------------------------------------------------- the dev stub --- */

test('the development stub declares no model and no effort — and says so', () => {
  const caps = makeFakeLLMProvider().describe();
  assert.equal(caps.kind, 'fake');
  // Empty is the truthful answer. A UI reading this must render every model and
  // every effort as unavailable, not as "all options available".
  assert.deepEqual(caps.models, []);
  assert.deepEqual(caps.efforts, []);
  assert.equal(caps.tier, null);
  assert.equal(caps.defaultEffort, null);
});

test('the stub refuses a model or an effort rather than accepting and ignoring it', async () => {
  const llm = makeFakeLLMProvider();
  for (const model of MODEL_TIERS) {
    const out = await ask(llm, { model });
    assert.equal(out.ok, false);
    assert.equal(out.ok === false && out.stage, 'model');
    assert.equal(out.ok === false && out.reason, 'unsupported_model');
    assert.match(out.ok === false ? out.detail : '', new RegExp(model));
  }
  for (const effort of EFFORT_LEVELS) {
    const out = await ask(llm, { effort });
    assert.equal(out.ok, false);
    assert.equal(out.ok === false && out.reason, 'unsupported_effort');
  }
});

test('with no configuration asked for, the stub still answers and reports itself honestly', async () => {
  const out = await ask(makeFakeLLMProvider());
  assert.ok(out.ok);
  assert.equal(out.provider, 'fake');
  // It is not dressed up as a model: no tier and no effort are claimed.
  assert.equal(out.configuration.tier, null);
  assert.equal(out.configuration.effort, null);
  assert.equal(out.configuration.model, 'deterministic-fake-1');
});

/* ------------------------------------------- a partially capable runtime -- */

test('an unsupported model is refused before anything runs', async () => {
  // A runtime that can run haiku and sonnet, and nothing else.
  const { provider, seen } = recordingProvider(['haiku', 'sonnet'], ['low', 'medium']);

  const fable = await ask(provider, { model: 'fable' });
  assert.equal(fable.ok, false);
  assert.equal(fable.ok === false && fable.reason, 'unsupported_model');
  assert.match(fable.ok === false ? fable.detail : '', /cannot run "fable"/);

  const xhigh = await ask(provider, { effort: 'xhigh' });
  assert.equal(xhigh.ok, false);
  assert.equal(xhigh.ok === false && xhigh.reason, 'unsupported_effort');

  // The refusal happens BEFORE the model is called: the provider saw nothing,
  // so an unsupported combination cannot have partially run.
  assert.deepEqual(seen, []);
});

test('a supported model and effort are actually sent, and echoed back as what ran', async () => {
  const { provider, seen } = recordingProvider(['haiku', 'sonnet'], ['low', 'medium']);
  const out = await ask(provider, { model: 'haiku', effort: 'low' });

  assert.ok(out.ok);
  assert.equal(seen.length, 1);
  assert.equal(seen[0]?.model, 'haiku', 'the request carries the chosen model');
  assert.equal(seen[0]?.effort, 'low');
  // The card displays what RAN, taken from the provider's own report.
  assert.equal(out.configuration.tier, 'haiku');
  assert.equal(out.configuration.effort, 'low');
  assert.equal(out.configuration.model, 'claude-haiku-x');
});

test('a nonsense configuration is refused exactly like an unsupported one', async () => {
  const { provider, seen } = recordingProvider(['sonnet'], ['medium']);
  for (const model of ['gpt-9', '', 'SONNET', 42]) {
    const out = await ask(provider, { model });
    if (model === '') {
      // An empty value means "no choice", and runs the runtime's default.
      assert.ok(out.ok);
      continue;
    }
    assert.equal(out.ok, false, `${String(model)} is refused`);
    assert.equal(out.ok === false && out.reason, 'unsupported_model');
  }
  assert.equal(seen.length, 1, 'only the no-choice call reached the provider');
});

/* --------------------------------------------------- the real adapter ----- */

test('the Anthropic adapter declares exactly the tiers and efforts it will send', () => {
  const caps = makeAnthropicLLMProvider({ apiKey: 'k' }).describe();
  assert.equal(caps.kind, 'anthropic');
  assert.deepEqual([...caps.models].sort(), ['fable', 'haiku', 'opus', 'sonnet']);
  assert.deepEqual([...caps.efforts].sort(), ['high', 'low', 'medium', 'xhigh']);
  // Its default is a real tier, so the badge has something true to show before
  // any run has happened.
  assert.equal(caps.tier, 'sonnet');
  assert.equal(caps.defaultEffort, 'medium');
});

test('the adapter puts the requested tier and effort into the actual request', async () => {
  const sent: Array<Record<string, unknown>> = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (_url: string, init: RequestInit) => {
    sent.push(JSON.parse(String(init.body)));
    return {
      ok: true,
      json: async () => ({
        content: [{ type: 'text', text: '{"answer":"ok","citedRefs":[],"proposedTasks":[]}' }],
      }),
    } as unknown as Response;
  }) as typeof fetch;

  try {
    const llm = makeAnthropicLLMProvider({ apiKey: 'k' });
    const out = await runAsk(
      { context, llm },
      { question: 'Why?', userCredential: 'Dev x', model: 'opus', effort: 'xhigh' },
    );
    assert.ok(out.ok);
    assert.equal(sent.length, 1);
    // The model id is the one the tier names — not a substitute.
    assert.equal(sent[0]?.model, 'claude-opus-5');
    // Effort is a real parameter, not a label: a higher level sends a bigger
    // thinking budget and a ceiling above it.
    const thinking = sent[0]?.thinking as { budget_tokens: number } | undefined;
    assert.ok(thinking && thinking.budget_tokens > 0);
    assert.ok(Number(sent[0]?.max_tokens) > thinking.budget_tokens);
    assert.equal(out.configuration.tier, 'opus');
    assert.equal(out.configuration.effort, 'xhigh');
    assert.equal(out.configuration.model, 'claude-opus-5');
  } finally {
    globalThis.fetch = original;
  }
});

test('the lowest effort sends no thinking budget at all', async () => {
  const sent: Array<Record<string, unknown>> = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (_url: string, init: RequestInit) => {
    sent.push(JSON.parse(String(init.body)));
    return {
      ok: true,
      json: async () => ({
        content: [{ type: 'text', text: '{"answer":"ok","citedRefs":[],"proposedTasks":[]}' }],
      }),
    } as unknown as Response;
  }) as typeof fetch;
  try {
    const llm = makeAnthropicLLMProvider({ apiKey: 'k' });
    await runAsk({ context, llm }, { question: 'Why?', userCredential: 'Dev x', effort: 'low' });
    assert.equal('thinking' in (sent[0] ?? {}), false);
  } finally {
    globalThis.fetch = original;
  }
});
