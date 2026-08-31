// Port: external activity (T3.3.1).
//
// The seam between the application and whatever system supplies activity that
// happened outside DEVWORKSPACE. It is deliberately read-only: there is no
// write, no sync, no reconciliation and no way for an external system to
// author, mutate or delete an internal object. GitHub supplies activity; the
// object model stays ours (P2.5 INV-1 — one system of record).
//
// Swapping GitHub for another forge changes `adapters/external/` and this
// port's implementation only, exactly as `RetrievalProvider` isolates retrieval.

import type { ExternalSnapshot, ExternalSource } from '../domain/external.ts';

export interface ExternalSourceDescriptor {
  readonly source: ExternalSource;
  /** `owner/repo`, as configured. */
  readonly repository: string;
  /**
   * Whether this deployment has a repository configured at all. False means the
   * surface must render "not configured" — never an empty activity list.
   */
  readonly configured: boolean;
  /** True when a credential is present. Anonymous reads still work for a
   *  public repository, at a lower rate limit; the UI states which is in use. */
  readonly authenticated: boolean;
}

export interface ExternalActivityProvider {
  /** Static configuration. Never performs I/O, never throws. */
  describe(): ExternalSourceDescriptor;
  /**
   * Read the current snapshot.
   *
   * Never throws and never fabricates: a section that could not be read comes
   * back as `{ ok: false, error }`, and a whole-source failure with no previous
   * snapshot comes back as a snapshot whose every section is unavailable. The
   * caller therefore always has something truthful to render.
   */
  snapshot(): Promise<ExternalSnapshot>;
}
