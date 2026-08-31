// Composition root. Wires PostgreSQL adapters to the ports the use cases need.

import { db } from '../persistence/db.ts';
import { makeScopeResolver } from '../persistence/scope.pg.ts';
import { makeObjectRepository } from '../persistence/object-repository.pg.ts';
import { makeRelationshipRepository } from '../persistence/relationship-repository.pg.ts';
import { makeMemberRepository } from '../persistence/member-repository.pg.ts';
import {
  activityWriter,
  auditWriter,
  outboxWriter,
} from '../persistence/writers.pg.ts';
import { makeLexicalRetrievalProvider } from '../retrieval/lexical.pg.ts';

export function buildContainer(uow = db) {
  const objects = makeObjectRepository(uow);
  const relationships = makeRelationshipRepository(uow);
  const scopeResolver = makeScopeResolver(uow);
  const members = makeMemberRepository(uow);
  // The RetrievalProvider seam (P2.6 §11). Swapping lexical → semantic changes
  // this line and adapters/retrieval/ only.
  const retrieval = makeLexicalRetrievalProvider(uow);
  return {
    uow,
    objects,
    relationships,
    members,
    retrieval,
    scopeResolver,
    activity: activityWriter,
    audit: auditWriter,
    outbox: outboxWriter,
  };
}

export type Container = ReturnType<typeof buildContainer>;
