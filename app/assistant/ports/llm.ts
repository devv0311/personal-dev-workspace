// LLMProvider port (P2.6 §14, §15).
//
// Provider-agnostic by construction: no vendor type, no SDK, no model id in the
// interface. P2.5/P2.6 deliberately deferred provider SELECTION while fixing the
// boundary, so this milestone ships the port plus a deterministic fake as the
// default and one optional real adapter behind the same port.
//
// The model is an UNTRUSTED generator (P2.3 §15). Its output is a structured,
// validated, inert proposal until a user confirms — no method here can write.

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
  /** Refs the model claims it used. Validated by the caller against evidence. */
  readonly citedRefs: readonly string[];
  /** Only populated for task extraction; always inert proposals. */
  readonly proposedTasks: readonly LlmProposedTask[];
}

export interface LLMProvider {
  complete(request: LlmRequest): Promise<LlmResult>;
  describe(): { kind: 'fake' | 'anthropic'; model: string };
}
