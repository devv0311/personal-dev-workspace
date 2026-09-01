// FakeLLMProvider — the DEFAULT provider in dev and test (P2.6 §14).
//
// Deterministic and offline. This is not a placeholder for "the real thing":
// it is what makes the assistant boundary testable at all. Every property that
// matters — grounding, provenance, authorization, refusal on empty evidence,
// inert task proposals — is a property of the PIPELINE, not of the model, and
// each is asserted against this provider so the assertions are reproducible.
//
// It never invents a ref: it only ever cites evidence it was actually handed,
// which is precisely the behaviour the pipeline then re-validates.

import type {
  LLMProvider,
  LlmCapabilities,
  LlmRequest,
  LlmResult,
  LlmProposedTask,
} from '../ports/llm.ts';

/** Sentences that read like an action, used for deterministic task extraction. */
const ACTION_HINTS = [
  'revisit',
  'should',
  'must',
  'need to',
  'needs to',
  'todo',
  'follow up',
  'open question',
  'decide',
  'migrate',
  'fix',
  'add',
  'remove',
];

const sentences = (text: string): string[] =>
  String(text ?? '')
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 12);

function titleFrom(sentence: string): string {
  const clean = sentence.replace(/\s+/g, ' ').trim().replace(/[.!?]+$/, '');
  return clean.length > 90 ? `${clean.slice(0, 89)}…` : clean;
}

export function makeFakeLLMProvider(): LLMProvider {
  return {
    async complete(request: LlmRequest): Promise<LlmResult> {
      const { evidence, question, task } = request;

      // MODEL / EFFORT (T3.3-CORRECTION). This provider is a deterministic
      // development stub, not a model: it has no tier and no effort control,
      // it declares both lists empty, and it REFUSES a request naming either
      // rather than accepting the parameter and ignoring it. Accepting it
      // silently is exactly how a card comes to display a model that is not
      // running.
      if (request.model) {
        throw new Error(
          `The configured runtime is a development stub and cannot run "${request.model}". Configure a model provider to select a model.`,
        );
      }
      if (request.effort) {
        throw new Error(
          'The configured runtime is a development stub and exposes no effort control.',
        );
      }

      // No evidence ⇒ no answer. The fake refuses exactly where a correctly
      // prompted real model must refuse (P2.3 §7, §10).
      if (evidence.length === 0) {
        return {
          answer:
            "I don't have any context for that. Nothing in the workspace you can see matches this question.",
          citedRefs: [],
          proposedTasks: [],
        };
      }

      if (task === 'extract_tasks') {
        const proposedTasks: LlmProposedTask[] = [];
        for (const item of evidence) {
          for (const sentence of sentences(item.body)) {
            const lower = sentence.toLowerCase();
            if (ACTION_HINTS.some((h) => lower.includes(h))) {
              proposedTasks.push({
                title: titleFrom(sentence),
                body: `Extracted from "${item.title}".`,
                sourceRef: item.ref,
              });
            }
            if (proposedTasks.length >= 5) break;
          }
          if (proposedTasks.length >= 5) break;
        }
        return {
          answer: proposedTasks.length
            ? `Found ${proposedTasks.length} candidate action${proposedTasks.length === 1 ? '' : 's'} in the selected context. Review before creating.`
            : 'No clear actions in this context.',
          citedRefs: [...new Set(proposedTasks.map((t) => t.sourceRef).filter((r): r is string => !!r))],
          proposedTasks,
        };
      }

      if (task === 'summarize') {
        const lines = evidence
          .slice(0, 6)
          .map((e) => `• ${e.title}${e.body ? ` — ${titleFrom(e.body)}` : ''}`);
        return {
          answer: `Summary of ${evidence.length} item${evidence.length === 1 ? '' : 's'} in scope:\n${lines.join('\n')}`,
          citedRefs: evidence.slice(0, 6).map((e) => e.ref),
          proposedTasks: [],
        };
      }

      // answer: quote the best-matching evidence rather than paraphrasing, so
      // the fake cannot appear to "know" anything the evidence does not say.
      const terms = question
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((t) => t.length > 2);
      const scored = evidence
        .map((e) => {
          const hay = `${e.title} ${e.body}`.toLowerCase();
          return { e, hits: terms.filter((t) => hay.includes(t)).length };
        })
        .sort((a, b) => b.hits - a.hits);

      const top = scored.slice(0, 3).filter((s, i) => s.hits > 0 || i === 0);
      const body = top
        .map((s) => `${s.e.title}: ${titleFrom(s.e.body) || '(no detail recorded)'}`)
        .join('\n');

      return {
        answer: `Based on the context available to you:\n${body}`,
        citedRefs: top.map((s) => s.e.ref),
        proposedTasks: [],
      };
    },

    describe(): LlmCapabilities {
      // Empty lists are the honest answer, and the UI renders them as "no
      // control here" — never as "every option is available".
      return {
        kind: 'fake',
        model: 'deterministic-fake-1',
        tier: null,
        defaultEffort: null,
        models: [],
        efforts: [],
      };
    },
  };
}
