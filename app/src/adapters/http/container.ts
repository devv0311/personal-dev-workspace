// Composition root. Wires PostgreSQL adapters to the ports the use cases need.

import { db } from '../persistence/db.ts';
import { makeScopeResolver } from '../persistence/scope.pg.ts';
import { makeObjectRepository } from '../persistence/object-repository.pg.ts';
import { makeRelationshipRepository } from '../persistence/relationship-repository.pg.ts';
import { makeMemberRepository } from '../persistence/member-repository.pg.ts';
import { makeWorkerTelemetryRepository } from '../persistence/worker-telemetry.pg.ts';
import {
  activityWriter,
  auditWriter,
  outboxWriter,
} from '../persistence/writers.pg.ts';
import { makeLexicalRetrievalProvider } from '../retrieval/lexical.pg.ts';
import { makeGitHubActivityProvider } from '../external/github.ts';
import { config } from '../../config.ts';
import type { ExternalActivityProvider } from '../../ports/external-activity.ts';

/**
 * One provider instance per process, so its cache and its in-flight
 * de-duplication are shared by every request rather than re-created per call.
 */
const defaultExternal: ExternalActivityProvider = makeGitHubActivityProvider({
  repository: config.githubRepository,
  token: config.githubToken,
  cacheTtlMs: config.githubCacheTtlMs,
});

export function buildContainer(uow = db, external: ExternalActivityProvider = defaultExternal) {
  const objects = makeObjectRepository(uow);
  const relationships = makeRelationshipRepository(uow);
  const scopeResolver = makeScopeResolver(uow);
  const members = makeMemberRepository(uow);
  const workerTelemetry = makeWorkerTelemetryRepository(uow);
  // The RetrievalProvider seam (P2.6 §11). Swapping lexical → semantic changes
  // this line and adapters/retrieval/ only.
  const retrieval = makeLexicalRetrievalProvider(uow);
  return {
    uow,
    objects,
    relationships,
    members,
    workerTelemetry,
    // The ExternalActivityProvider seam (T3.3.1). Read-only, and the only path
    // to a system outside DEVWORKSPACE; swapping forges changes adapters/external/
    // and this line, exactly as the retrieval seam isolates retrieval.
    external,
    retrieval,
    scopeResolver,
    activity: activityWriter,
    audit: auditWriter,
    outbox: outboxWriter,
  };
}

export type Container = ReturnType<typeof buildContainer>;
