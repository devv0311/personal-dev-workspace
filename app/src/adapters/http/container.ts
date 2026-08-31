// Composition root. Wires PostgreSQL adapters to the ports the use cases need.

import { db } from '../persistence/db.ts';
import { makeScopeResolver } from '../persistence/scope.pg.ts';
import { makeObjectRepository } from '../persistence/object-repository.pg.ts';
import { makeRelationshipRepository } from '../persistence/relationship-repository.pg.ts';
import { makeMemberRepository } from '../persistence/member-repository.pg.ts';
import { makeWorkerTelemetryRepository } from '../persistence/worker-telemetry.pg.ts';
import { makeArtifactReadRepository } from '../persistence/artifact-read.pg.ts';
import { makeMailAccountRepository } from '../persistence/mail-account.pg.ts';
import {
  activityWriter,
  auditWriter,
  outboxWriter,
} from '../persistence/writers.pg.ts';
import { makeLexicalRetrievalProvider } from '../retrieval/lexical.pg.ts';
import { makeGitHubActivityProvider } from '../external/github.ts';
import { makeMailProviderRegistry } from '../mail/registry.ts';
import { makeTokenCipher } from '../mail/token-cipher.ts';
import { config } from '../../config.ts';
import type { ExternalActivityProvider } from '../../ports/external-activity.ts';
import type { MailProviderRegistry, TokenCipher } from '../../ports/mail.ts';

/**
 * One provider instance per process, so its cache and its in-flight
 * de-duplication are shared by every request rather than re-created per call.
 */
const defaultExternal: ExternalActivityProvider = makeGitHubActivityProvider({
  repository: config.githubRepository,
  token: config.githubToken,
  cacheTtlMs: config.githubCacheTtlMs,
});

/**
 * The mail seams, one instance per process (T3.3-CORRECTION).
 *
 * The registry lists every provider this build knows about, configured or not,
 * so the settings surface can show an unavailable provider WITH its reason. The
 * cipher holds the only key that can open a stored credential; with no key
 * configured it reports itself unavailable and connecting is refused rather
 * than faked.
 */
const defaultMailProviders: MailProviderRegistry = makeMailProviderRegistry({
  google: config.mailGoogle,
  microsoft: config.mailMicrosoft,
});
const defaultTokenCipher: TokenCipher = makeTokenCipher(config.mailTokenKey);

export interface ContainerOverrides {
  external?: ExternalActivityProvider;
  mailProviders?: MailProviderRegistry;
  tokenCipher?: TokenCipher;
}

export function buildContainer(
  uow = db,
  overrides: ExternalActivityProvider | ContainerOverrides = {},
) {
  // Historic call sites pass the external provider positionally; both forms are
  // accepted so wiring a test double does not require touching every caller.
  const opts: ContainerOverrides =
    typeof (overrides as ExternalActivityProvider).snapshot === 'function'
      ? { external: overrides as ExternalActivityProvider }
      : (overrides as ContainerOverrides);
  const external = opts.external ?? defaultExternal;

  const objects = makeObjectRepository(uow);
  const relationships = makeRelationshipRepository(uow);
  const scopeResolver = makeScopeResolver(uow);
  const members = makeMemberRepository(uow);
  const workerTelemetry = makeWorkerTelemetryRepository(uow);
  const artifactReads = makeArtifactReadRepository(uow);
  const mailAccounts = makeMailAccountRepository(uow);
  // The RetrievalProvider seam (P2.6 §11). Swapping lexical → semantic changes
  // this line and adapters/retrieval/ only.
  const retrieval = makeLexicalRetrievalProvider(uow);
  return {
    uow,
    objects,
    relationships,
    members,
    workerTelemetry,
    artifactReads,
    // The ExternalActivityProvider seam (T3.3.1). Read-only, and the only path
    // to a system outside DEVWORKSPACE; swapping forges changes adapters/external/
    // and this line, exactly as the retrieval seam isolates retrieval.
    external,
    // The mail seams (T3.3-CORRECTION). Provider-agnostic by construction: the
    // application only ever sees MailProvider / TokenCipher, never a vendor SDK.
    mailAccounts,
    mailProviders: opts.mailProviders ?? defaultMailProviders,
    tokenCipher: opts.tokenCipher ?? defaultTokenCipher,
    retrieval,
    scopeResolver,
    activity: activityWriter,
    audit: auditWriter,
    outbox: outboxWriter,
  };
}

export type Container = ReturnType<typeof buildContainer>;
