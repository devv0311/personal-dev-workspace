// Context API client — the assistant's ONLY data path (P2.6 §14, §14.1).
//
// Two credentials, two jobs:
//   • the service token authenticates THIS SERVICE to the Context API surface;
//     it conveys no user identity;
//   • the end-user credential is RELAYED VERBATIM. The assistant never
//     constructs, mints, mutates or substitutes it — it only passes on what the
//     user's own request arrived with, and the core validates it and derives
//     the principal itself.
//
// Consequence (INV-4a): the assistant cannot request another user's context,
// because it holds no credential for another user.
//
// Note the absence of any database import in this file and everywhere else
// under assistant/ — that is INV-4, and it is asserted by a test.

import type { ContextClient, ContextSetResult } from './pipeline.ts';

export function makeContextClient(opts: {
  baseUrl: string;
  serviceToken: string;
  timeoutMs?: number;
}): ContextClient {
  const timeoutMs = opts.timeoutMs ?? 10_000;
  return {
    async fetchContextSet({ userCredential, purpose, queryText, targetId }): Promise<ContextSetResult> {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await fetch(`${opts.baseUrl}/ctx/context-set`, {
          method: 'POST',
          signal: controller.signal,
          headers: {
            'content-type': 'application/json',
            'x-service-token': opts.serviceToken,
            // Relayed unchanged. Never synthesised here.
            authorization: userCredential,
          },
          body: JSON.stringify({ purpose, queryText, targetId }),
        });
        const text = await res.text();
        const data = text ? JSON.parse(text) : {};
        if (res.status === 200 && data.ok === true) return data as ContextSetResult;
        if (res.status === 409 && data.ok === false) return data as ContextSetResult;
        return {
          ok: false,
          reason: res.status === 401 ? 'not_authenticated' : 'context_api_error',
          detail:
            typeof data.error === 'string' ? data.error : `context api returned ${res.status}`,
        };
      } catch (err) {
        return {
          ok: false,
          reason: 'context_unavailable',
          detail: err instanceof Error ? err.message : 'context api unreachable',
        };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
