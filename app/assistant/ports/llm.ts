// LLMProvider port (P2.6 §14, §15).
//
// Provider-agnostic by construction: no vendor type, no SDK, no model id in the
// interface. P2.5/P2.6 deliberately deferred provider SELECTION while fixing the
// boundary, so this milestone ships the port plus a deterministic fake as the
// default and one optional real adapter behind the same port.
//
// The model is an UNTRUSTED generator (P2.3 §15). Its output is a structured,
// validated, inert proposal until a user confirms — no method here can write.

/**
 * The model TIERS a Skills card may ask for, and the EFFORT levels it may ask
 * for (T3.3-CORRECTION).
 *
 * These are the names the UI offers. Offering a name is not the same as
 * supporting it: a provider declares which of these it can ACTUALLY execute in
 * `describe()`, the UI renders everything else as visibly unavailable, and the
 * pipeline refuses a request naming an unsupported value rather than quietly
 * substituting one. A card can therefore never claim a model that is not the
 * one doing the work.
 */
export const MODEL_TIERS = ['haiku', 'sonnet', 'opus', 'fable'] as const;
export type ModelTier = (typeof MODEL_TIERS)[number];

export const EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh'] as const;
export type EffortLevel = (typeof EFFORT_LEVELS)[number];

export const isModelTier = (v: unknown): v is ModelTier =>
  typeof v === 'string' && (MODEL_TIERS as readonly string[]).includes(v);
export const isEffortLevel = (v: unknown): v is EffortLevel =>
  typeof v === 'string' && (EFFORT_LEVELS as readonly string[]).includes(v);

/**
 * What a provider can actually do.
 *
 * `models` and `efforts` are the subsets of the vocabularies above that this
 * provider will really execute. An empty list is a truthful answer — the
 * development stub is not a model and exposes no tier and no effort control —
 * and the UI must render an empty list as "no control here", never as "all
 * options available".
 */
export interface LlmCapabilities {
  readonly kind: 'fake' | 'anthropic';
  /** The provider's own name for what runs by default. */
  readonly model: string;
  /** The tier that default corresponds to, or null when it is not a tier. */
  readonly tier: ModelTier | null;
  readonly defaultEffort: EffortLevel | null;
  readonly models: readonly ModelTier[];
  readonly efforts: readonly EffortLevel[];
}

/** The only thing that ever leaves the trust boundary (INV-7). */
export interface LlmRequest {
  /** The user's question, verbatim. */
  readonly question: string;
  /**
   * Evidence drawn ONLY from a ContextSet already filtered for this principal.
   * Treated by the prompt as data, never as instruction (P2.6 §14).
   */
  readonly evidence: ReadonlyArray<{
    readonly ref: string;
    readonly type: string;
    readonly title: string;
    readonly body: string;
  }>;
  readonly task: 'answer' | 'summarize' | 'extract_tasks';
  /**
   * The requested configuration, when a caller asked for one. A provider that
   * does not support the value MUST throw rather than silently run something
   * else — the card is showing the user what it believes will execute.
   */
  readonly model?: ModelTier;
  readonly effort?: EffortLevel;
}

export interface LlmProposedTask {
  readonly title: string;
  readonly body: string;
  /** Ref of the evidence item this was extracted from. */
  readonly sourceRef: string | null;
}

export interface LlmResult {
  /** Prose grounded in the supplied evidence. */
  readonly answer: string;
  /** What actually ran, as the provider names it. Reported back to the card. */
  readonly usedModel?: string;
  readonly usedEffort?: EffortLevel | null;
  /** Refs the model claims it used. Validated by the caller against evidence. */
  readonly citedRefs: readonly string[];
  /** Only populated for task extraction; always inert proposals. */
  readonly proposedTasks: readonly LlmProposedTask[];
}

export interface LLMProvider {
  complete(request: LlmRequest): Promise<LlmResult>;
  describe(): LlmCapabilities;
}
