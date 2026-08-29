// DEV-ONLY authentication boundary (P2.7 §5).
//
// ⚠️  This is NOT the final authentication architecture (P2.5 §22 Q6 leaves the
//     mechanism open). It exists only so the *authorization* boundary can be
//     exercised end to end in local development and tests.
//
// Contract it upholds, which the real mechanism must also uphold:
//   • the principal is derived here, from a credential the server validates —
//     never from a request body or a field the client can set freely (INV-4a);
//   • an unauthenticated request yields NO principal (deny-by-default).
//
// Mechanism: the client sends `Authorization: Dev <principalId>`. The server
// confirms the principal exists (in resolve()) before trusting it.

import type { IncomingMessage } from 'node:http';
import { isUuid, asPrincipalId, type PrincipalId } from '../../domain/ids.ts';
import { config } from '../../config.ts';

export function principalFromRequest(req: IncomingMessage): PrincipalId | null {
  if (!config.devAuthEnabled) return null;
  const header = req.headers['authorization'];
  if (typeof header !== 'string') return null;
  const match = /^Dev\s+([0-9a-fA-F-]+)$/.exec(header.trim());
  if (!match) return null;
  const id = match[1]!;
  return isUuid(id) ? asPrincipalId(id) : null;
}
