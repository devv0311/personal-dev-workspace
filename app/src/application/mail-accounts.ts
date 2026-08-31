// Use case: per-user mail accounts (T3.3-CORRECTION).
//
// "Every user can connect their own mail" is the product requirement, and the
// ownership model it implies is the one thing this file exists to keep true:
//
//     USER ─┬─ Mail Account A
//           ├─ Mail Account B
//           └─ Mail Account C
//
// Not: workspace → mailbox. Not: head of the workspace → everyone's mailbox.
// Every function below takes the caller's own ResolvedScope and reaches the
// datastore only through MailAccountRepository, whose every statement filters
// by `principal_id`. There is no code path — here or below — by which one
// principal's account, credential or message can reach another.
//
// The other rule: a control is pressable only when it can actually run. If no
// provider is configured, or no key is configured to seal a credential with,
// connecting is REFUSED with the reason, rather than offered and then failed.

import { randomBytes, createHash } from 'node:crypto';
import {
  accessTokenExpired,
  isMailProviderId,
  type MailAccount,
  type MailInboundMessage,
} from '../domain/mail.ts';
import { conflict, forbidden, notFound, validation } from '../domain/errors.ts';
import { asPrincipalId, asWorkspaceId } from '../domain/ids.ts';
import type {
  MailAccountRepository,
  MailProvider,
  MailProviderDescriptor,
  MailProviderRegistry,
  TokenCipher,
} from '../ports/mail.ts';
import type { ResolvedScope } from '../domain/visibility.ts';

export interface MailDeps {
  mailAccounts: MailAccountRepository;
  mailProviders: MailProviderRegistry;
  tokenCipher: TokenCipher;
}

/** How long a consent handshake may stay open. */
const OAUTH_REQUEST_TTL_MS = 10 * 60 * 1000;

export interface MailAccountsView {
  /** Whether this deployment can store a credential at all, and why not. */
  readonly storage: { readonly ok: boolean; readonly reason: string | null };
  readonly providers: readonly MailProviderDescriptor[];
  /** ONLY the caller's own accounts. */
  readonly accounts: readonly MailAccount[];
}

export async function listMailAccounts(
  deps: MailDeps,
  scope: ResolvedScope,
): Promise<MailAccountsView> {
  const storage = deps.tokenCipher.available();
  return {
    storage: { ok: storage.ok, reason: storage.reason },
    providers: deps.mailProviders.list(),
    accounts: await deps.mailAccounts.listForPrincipal(scope),
  };
}

/* --------------------------------------------------------------- connect -- */

const base64url = (b: Buffer): string => b.toString('base64url');

/**
 * Begin a connection. Returns the PROVIDER's consent URL — the user
 * authenticates there, and DEVWORKSPACE never handles their password.
 *
 * `accountId` reconnects an existing account (an expired grant) instead of
 * creating a second one for the same address.
 */
export async function beginMailConnect(
  deps: MailDeps,
  scope: ResolvedScope,
  input: { provider: unknown; redirectUri: string; accountId?: string | null },
): Promise<{ authorizationUrl: string; state: string }> {
  const storage = deps.tokenCipher.available();
  if (!storage.ok) {
    // Refusing here is the honest outcome: a connection we cannot store
    // securely is not a connection we should start.
    throw conflict(storage.reason ?? 'Mail credentials cannot be stored securely.');
  }
  if (!isMailProviderId(input.provider)) {
    throw validation('Unknown mail provider.');
  }
  const provider = deps.mailProviders.get(input.provider);
  if (!provider) throw validation('Unknown mail provider.');
  const described = provider.describe();
  if (!described.configured) {
    throw conflict(described.reason ?? `${described.label} is not configured.`);
  }

  let loginHint: string | null = null;
  let accountId: string | null = null;
  if (input.accountId) {
    // Reconnect: the account must be the caller's own, or it does not exist.
    const existing = await deps.mailAccounts.findForPrincipal(scope, input.accountId);
    if (!existing) throw notFound('Mail account not found.');
    accountId = existing.id;
    loginHint = existing.address;
  }

  const state = base64url(randomBytes(32));
  const codeVerifier = base64url(randomBytes(48));
  const codeChallenge = base64url(createHash('sha256').update(codeVerifier).digest());

  await deps.mailAccounts.createOAuthRequest({
    state,
    workspaceId: scope.workspaceId,
    principalId: scope.principalId,
    provider: input.provider,
    codeVerifier,
    redirectUri: input.redirectUri,
    accountId,
    expiresAt: new Date(Date.now() + OAUTH_REQUEST_TTL_MS).toISOString(),
  });

  return {
    authorizationUrl: provider.authorizationUrl({
      state,
      codeChallenge,
      redirectUri: input.redirectUri,
      loginHint,
    }),
    state,
  };
}

/**
 * Complete a connection from the provider's redirect.
 *
 * The redirect is a top-level browser navigation and carries no credential of
 * ours, so the principal comes from the stored single-use `state` row — which
 * this server minted, stored against that principal, and deletes as it reads.
 * An unknown, expired or replayed state completes nothing.
 */
export async function completeMailConnect(
  deps: MailDeps,
  input: { state: string; code: string },
): Promise<{ account: MailAccount; principalId: string }> {
  const request = await deps.mailAccounts.consumeOAuthRequest(input.state);
  if (!request) throw forbidden('This mail authorization is not valid any more. Start again.');

  const provider = deps.mailProviders.get(request.provider);
  if (!provider) throw validation('Unknown mail provider.');

  // The scope the rest of this function works under is the one the STATE row
  // recorded — never one derived from the redirect itself.
  const scope: ResolvedScope = {
    workspaceId: asWorkspaceId(request.workspaceId),
    principalId: asPrincipalId(request.principalId),
    sharedProjectIds: [],
  };

  const { tokens, address } = await provider.exchangeCode({
    code: input.code,
    codeVerifier: request.codeVerifier,
    redirectUri: request.redirectUri,
  });

  const account = await deps.mailAccounts.upsert(scope, {
    provider: request.provider,
    address,
    status: 'connected',
  });

  // The refresh token is the durable grant; where a provider issues none, the
  // access token is stored instead and the account expires when it does. Either
  // way it is sealed before it is written.
  const secret = JSON.stringify({
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    scope: tokens.scope,
  });
  await deps.mailAccounts.saveCredential(scope, account.id, {
    sealed: deps.tokenCipher.seal(secret),
    accessExpiresAt: tokens.accessExpiresAt,
  });

  const updated =
    (await deps.mailAccounts.updateStatus(scope, account.id, {
      status: 'connected',
      lastError: null,
    })) ?? account;
  return { account: updated, principalId: request.principalId };
}

export async function disconnectMailAccount(
  deps: MailDeps,
  scope: ResolvedScope,
  id: string,
): Promise<void> {
  const removed = await deps.mailAccounts.remove(scope, id);
  // A foreign id is reported exactly as an unknown one.
  if (!removed) throw notFound('Mail account not found.');
}

export async function setMailAccountFeeds(
  deps: MailDeps,
  scope: ResolvedScope,
  id: string,
  feedsInbound: boolean,
): Promise<MailAccount> {
  const updated = await deps.mailAccounts.updateStatus(scope, id, { feedsInbound });
  if (!updated) throw notFound('Mail account not found.');
  return updated;
}

/* ------------------------------------------------------------- read mail -- */

export interface MailFetchOutcome {
  readonly account: MailAccount;
  readonly messages: readonly MailInboundMessage[];
  /** Present when this account could not be read. Never swallowed. */
  readonly error: string | null;
}

interface StoredSecret {
  accessToken: string;
  refreshToken: string | null;
  scope: string | null;
}

/**
 * Read one account's inbound messages, refreshing the access token when the
 * provider said it had expired.
 *
 * A failure is recorded on the account (status + the provider's own words) and
 * returned to the caller as an error — it is never converted into an empty
 * inbox, because "nothing needs you" and "we could not look" are different
 * facts and the Attention Stack must show which one it has.
 */
export async function readAccountInbound(
  deps: MailDeps,
  scope: ResolvedScope,
  account: MailAccount,
  limit: number,
): Promise<MailFetchOutcome> {
  const fail = async (
    status: MailAccount['status'],
    message: string,
  ): Promise<MailFetchOutcome> => {
    const updated = await deps.mailAccounts.updateStatus(scope, account.id, {
      status,
      lastError: message,
    });
    return { account: updated ?? account, messages: [], error: message };
  };

  const provider: MailProvider | null = deps.mailProviders.get(account.provider);
  if (!provider) return fail('error', `Provider ${account.provider} is not available.`);
  if (!provider.describe().configured) {
    return fail('error', provider.describe().reason ?? 'Provider is not configured.');
  }

  const stored = await deps.mailAccounts.readCredential(scope, account.id);
  if (!stored) return fail('expired', 'No stored credential. Reconnect this account.');

  let secret: StoredSecret;
  try {
    secret = JSON.parse(deps.tokenCipher.open(stored.sealed)) as StoredSecret;
  } catch (err) {
    return fail('expired', (err as Error).message);
  }

  let accessToken = secret.accessToken;
  if (accessTokenExpired(stored.accessExpiresAt) && secret.refreshToken) {
    try {
      const next = await provider.refresh(secret.refreshToken);
      accessToken = next.accessToken;
      await deps.mailAccounts.saveCredential(scope, account.id, {
        sealed: deps.tokenCipher.seal(
          JSON.stringify({
            accessToken: next.accessToken,
            refreshToken: next.refreshToken ?? secret.refreshToken,
            scope: next.scope,
          }),
        ),
        accessExpiresAt: next.accessExpiresAt,
      });
    } catch (err) {
      return fail('expired', `Authorization expired: ${(err as Error).message}`);
    }
  }

  try {
    const messages = await provider.listInbound(accessToken, limit);
    const updated = await deps.mailAccounts.updateStatus(scope, account.id, {
      status: 'connected',
      lastSyncAt: new Date().toISOString(),
      lastError: null,
    });
    return { account: updated ?? account, messages, error: null };
  } catch (err) {
    return fail('error', (err as Error).message);
  }
}

/** The caller's accounts that are meant to feed the Attention Stack. */
export const feedingAccounts = (accounts: readonly MailAccount[]): MailAccount[] =>
  accounts.filter((a) => a.feedsInbound && a.status !== 'revoked');
