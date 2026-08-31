// The assistant turn pipeline (P2.3 §5–§10).
//
//   question → interpret → ContextSet request → evidence → model → VALIDATE →
//   grounded answer + provenance + inert proposals
//
// Pure with respect to I/O: it is handed a context client and an LLM provider,
// so the whole boundary is testable without a network, a database or a model.
//
// The load-bearing idea: the model is untrusted, so nothing it returns is taken
// at face value. Refs are re-validated against the evidence actually supplied,
// and proposals are re-anchored to real object ids. A model that hallucinates a
// citation cannot produce a citation in the UI; a model that invents a source
// cannot produce a task that claims to come from one.

import {
  isEffortLevel,
  isModelTier,
  type EffortLevel,
  type LLMProvider,
  type LlmRequest,
  type ModelTier,
} from './ports/llm.ts';

/* ------------------------------------------------------- context client -- */

export type ContextLayer = 'direct' | 'recent' | 'high_confidence';

export interface ContextItem {
  object: {
    id: string;
    type: string;
    title: string;
    body: string;
    homeProjectId: string | null;
    createdAt: string;
    updatedAt: string;
  };
  viaRelationships: Array<{
    verb: string;
    direction: 'out' | 'in';
    confidenceState: string;
    origin: string;
    provenanceKind: string;
    other: { id: string; type: string; title: string } | null;
  }>;
  layer: ContextLayer;
  rank: number;
  factorTrace: Array<{ factor: string; weight: number }>;
}

export interface ContextSet {
  ok: true;
  weightSetVersion: string;
  purpose: string;
  layersPresent: ContextLayer[];
  items: ContextItem[];
  generatedAt: string;
  resolved: { queryText: string; targetId: string | null; projectId: string | null };
}
export interface ContextUnavailable {
  ok: false;
  reason: string;
  detail: string;
}
export type ContextSetResult = ContextSet | ContextUnavailable;

export interface ContextClient {
  fetchContextSet(input: {
    userCredential: string;
    purpose: 'question' | 'summarize' | 'extract_tasks';
    queryText: string;
    targetId: string | null;
  }): Promise<ContextSetResult>;
}

/* ----------------------------------------------------- intent resolution -- */

export type Intent = 'answer' | 'summarize' | 'extract_tasks';

/**
 * Query understanding (P2.3 §5). Deliberately a small deterministic classifier
 * rather than a model call: the intent decides which CONTEXT is fetched, and
 * that decision happens before any evidence exists to ground a model on. It is
 * also the layer that turns a natural-language question into retrieval terms —
 * which is where "semantic" behaviour lives in this milestone, since the
 * retrieval provider itself is lexical by accepted decision (P2.5 §13.3).
 */
export function resolveIntent(question: string): Intent {
  const q = question.toLowerCase();
  if (/\b(extract|action items?|todos?|tasks? from|turn .* into (a )?tasks?)\b/.test(q)) {
    return 'extract_tasks';
  }
  // `summar\w*` so "summary" and "summarize" both match — a bare \b after
  // "summar" would match neither.
  if (/\b(summar\w*|overview|recap|catch me up|brief me)\b/.test(q)) return 'summarize';
  return 'answer';
}

/** Words that carry no retrieval signal — dropped before hitting the index. */
const STOP = new Set([
  'what', 'was', 'were', 'why', 'did', 'we', 'i', 'the', 'a', 'an', 'is', 'are', 'do', 'does',
  'on', 'in', 'of', 'for', 'to', 'and', 'or', 'about', 'this', 'that', 'it', 'my', 'me', 'our',
  'you', 'your', 'with', 'how', 'when', 'which', 'who', 'be', 'been', 'have', 'has', 'had',
  'working', 'work', 'know', 'tell', 'show', 'give', 'should', 'next', 'summarize', 'summary',
  'extract', 'tasks', 'task', 'from', 'here', 'there', 'related', 'decisions', 'decision',
]);

/**
 * Reduce a question to retrieval terms. Returning "" is meaningful: it tells
 * the engine there are no useful search terms, so recency should anchor the
 * turn instead (e.g. "what was I working on?").
 */
export function toQueryText(question: string): string {
  const terms = String(question ?? '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 2 && !STOP.has(t));
  return [...new Set(terms)].join(' ');
}

/* ------------------------------------------------------------ the turn --- */

export interface Citation {
  /** The REAL object id — this is what the UI navigates to. */
  readonly objectId: string;
  readonly type: string;
  readonly title: string;
  readonly layer: ContextLayer;
  readonly rank: number;
  /** Why this object was in scope at all. */
  readonly why: ReadonlyArray<{ verb: string; confidenceState: string; otherTitle: string | null }>;
}

export interface ProposedTask {
  readonly title: string;
  readonly body: string;
  /** Always a real, visible object id or null — never a model-invented ref. */
  readonly sourceObjectId: string | null;
  readonly sourceTitle: string | null;
  readonly projectId: string | null;
}

export interface AskResult {
  readonly ok: true;
  readonly intent: Intent;
  readonly answer: string;
  readonly citations: readonly Citation[];
  readonly proposedTasks: readonly ProposedTask[];
  readonly evidenceCount: number;
  readonly grounded: boolean;
  readonly provider: string;
  /**
   * The configuration that ACTUALLY ran (T3.3-CORRECTION). The Skills card
   * displays this, not the one it asked for, so a badge can never outlive the
   * request that produced it.
   */
  readonly configuration: {
    readonly model: string;
    readonly tier: ModelTier | null;
    readonly effort: EffortLevel | null;
  };
  readonly weightSetVersion: string;
  readonly projectId: string | null;
}
export interface AskFailure {
  readonly ok: false;
  readonly stage: 'context' | 'model';
  readonly reason: string;
  readonly detail: string;
}
export type AskOutcome = AskResult | AskFailure;

export interface AskInput {
  readonly question: string;
  readonly userCredential: string;
  readonly targetId?: string | null;
  /** Requested model tier / effort level. Validated before anything is run. */
  readonly model?: unknown;
  readonly effort?: unknown;
}

export async function runAsk(
  deps: { context: ContextClient; llm: LLMProvider },
  input: AskInput,
): Promise<AskOutcome> {
  const question = String(input.question ?? '').trim();
  if (!question) {
    return { ok: false, stage: 'context', reason: 'empty_question', detail: 'Ask a question.' };
  }

  // --- CONFIGURATION: refuse what the runtime cannot execute ---------------
  // A UI option is not runtime support. An unsupported model or effort is
  // rejected HERE, before any context is fetched and before the model is
  // called, so an unsupported combination can never appear to have run.
  const capabilities = deps.llm.describe();
  let model: ModelTier | undefined;
  let effort: EffortLevel | undefined;
  if (input.model !== undefined && input.model !== null && input.model !== '') {
    if (!isModelTier(input.model) || !capabilities.models.includes(input.model)) {
      return {
        ok: false,
        stage: 'model',
        reason: 'unsupported_model',
        detail: `The configured runtime (${capabilities.kind}) cannot run "${String(input.model)}".`,
      };
    }
    model = input.model;
  }
  if (input.effort !== undefined && input.effort !== null && input.effort !== '') {
    if (!isEffortLevel(input.effort) || !capabilities.efforts.includes(input.effort)) {
      return {
        ok: false,
        stage: 'model',
        reason: 'unsupported_effort',
        detail: `The configured runtime (${capabilities.kind}) exposes no "${String(input.effort)}" effort level.`,
      };
    }
    effort = input.effort;
  }

  const intent = resolveIntent(question);
  const set = await deps.context.fetchContextSet({
    userCredential: input.userCredential,
    purpose: intent === 'answer' ? 'question' : intent,
    queryText: toQueryText(question),
    targetId: input.targetId ?? null,
  });

  // Unavailable is NOT an empty set. The assistant must not answer the
  // substantive question at all here — no model priors, no history (P2.3 §6).
  if (!set.ok) {
    return { ok: false, stage: 'context', reason: set.reason, detail: set.detail };
  }

  // Evidence is keyed by the REAL object id, so a "ref" is never an opaque
  // handle the model could confuse — and never a value the model chose.
  const byRef = new Map(set.items.map((i) => [i.object.id, i]));
  const request: LlmRequest = {
    question,
    task: intent,
    evidence: set.items.map((i) => ({
      ref: i.object.id,
      type: i.object.type,
      title: i.object.title,
      body: i.object.body,
    })),
    ...(model ? { model } : {}),
    ...(effort ? { effort } : {}),
  };

  let result;
  try {
    result = await deps.llm.complete(request);
  } catch (err) {
    // Model unavailable/malformed: report and offer retry; never fabricate.
    return {
      ok: false,
      stage: 'model',
      reason: 'model_unavailable',
      detail: err instanceof Error ? err.message : 'model failed',
    };
  }

  // --- VALIDATION: the model is untrusted ---------------------------------
  // Citations survive only if they name evidence we actually supplied. This is
  // what makes a hallucinated citation structurally impossible to display.
  const citations: Citation[] = [];
  for (const ref of result.citedRefs) {
    const item = byRef.get(ref);
    if (!item) continue;
    if (citations.some((c) => c.objectId === ref)) continue;
    citations.push({
      objectId: item.object.id,
      type: item.object.type,
      title: item.object.title,
      layer: item.layer,
      rank: item.rank,
      why: item.viaRelationships.map((v) => ({
        verb: v.verb,
        confidenceState: v.confidenceState,
        otherTitle: v.other?.title ?? null,
      })),
    });
  }

  // Proposals are re-anchored to real visible objects. A proposal whose source
  // the model invented keeps its text but loses the false attribution.
  const proposedTasks: ProposedTask[] = result.proposedTasks
    .filter((t) => t.title.trim().length > 0)
    .map((t) => {
      const source = t.sourceRef ? byRef.get(t.sourceRef) : undefined;
      return {
        title: t.title.trim().slice(0, 200),
        body: t.body.trim().slice(0, 20_000),
        sourceObjectId: source?.object.id ?? null,
        sourceTitle: source?.object.title ?? null,
        projectId: source?.object.homeProjectId ?? set.resolved.projectId,
      };
    });

  return {
    ok: true,
    intent,
    answer: result.answer,
    citations,
    proposedTasks,
    evidenceCount: set.items.length,
    // An answer with evidence but no surviving citation is ungrounded; the UI
    // says so rather than presenting it as fact.
    grounded: set.items.length === 0 ? false : citations.length > 0,
    provider: capabilities.kind,
    configuration: {
      // What the provider says it ran, falling back to its declared default —
      // never to what the caller asked for.
      model: result.usedModel ?? capabilities.model,
      tier: model ?? capabilities.tier,
      effort: result.usedEffort ?? effort ?? capabilities.defaultEffort,
    },
    weightSetVersion: set.weightSetVersion,
    projectId: set.resolved.projectId,
  };
}
