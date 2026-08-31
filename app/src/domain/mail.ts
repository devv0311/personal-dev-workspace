// Mail domain (T3.3-CORRECTION). Pure — no I/O, no driver, no provider SDK.
//
// The product rule this module encodes: A MAILBOX BELONGS TO A PERSON.
// Workspace ownership is not mailbox ownership. The head of the workspace does
// not thereby see anyone's mail, and no member sees the head's. Every mail type
// below therefore carries the principal it belongs to, and every read of one is
// filtered by that principal — not by workspace membership, and not by a share.
//
// The second rule: NOTHING ABOUT A MAILBOX IS INVENTED. An address is the one
// the provider reported after consent, never one a user typed into a field; a
// status is derived from the credential we actually hold; a message row is a
// message the provider actually returned. An account that cannot be read says
// why, and contributes no rows.

/**
 * Provider identifiers. Deliberately a closed list: an id appears here only
 * when an adapter exists that can actually complete its OAuth flow and read its
 * messages. The architecture is provider-agnostic — adding one is a profile
 * plus a config entry — but the UI never offers a provider that is not here.
 */
export const MAIL_PROVIDERS = ['google', 'microsoft'] as const;
export type MailProviderId = (typeof MAIL_PROVIDERS)[number];

export const isMailProviderId = (v: unknown): v is MailProviderId =>
  typeof v === 'string' && (MAIL_PROVIDERS as readonly string[]).includes(v);

/**
 * The lifecycle of one connected account.
 *
 *   pending    — consent started, not yet completed. No credential held.
 *   connected  — a credential is held and the last read succeeded.
 *   expired    — the credential is present but the provider refused it; the
 *                user can reconnect without losing the account.
 *   revoked    — the provider says the grant is gone.
 *   error      — the last read failed for a reason that is neither of those.
 *
 * `connected` is never assumed: it is written only after a real provider call
 * succeeded, so a card that says CONNECTED is reporting an observation.
 */
export const MAIL_ACCOUNT_STATUSES = [
  'pending',
  'connected',
  'expired',
  'revoked',
  'error',
] as const;
export type MailAccountStatus = (typeof MAIL_ACCOUNT_STATUSES)[number];

/** One mail account, as any surface outside the persistence layer may see it.
 *  There is no token field of any kind on this type, by construction. */
export interface MailAccount {
  readonly id: string;
  readonly principalId: string;
  readonly provider: MailProviderId;
  readonly address: string;
  readonly status: MailAccountStatus;
  /** Whether this account feeds the Attention Stack. */
  readonly feedsInbound: boolean;
  /** When a provider read last succeeded, or null when none ever has. */
  readonly lastSyncAt: string | null;
  /** The provider's own words for the last failure, or null. Never a stack trace. */
  readonly lastError: string | null;
  readonly createdAt: string;
}

/** A token set as a provider hands it back. Lives in memory only. */
export interface MailTokenSet {
  readonly accessToken: string;
  /** Absent when the provider issued none (some flows do not). */
  readonly refreshToken: string | null;
  /** Absolute instant the access token stops working, when the provider said. */
  readonly accessExpiresAt: string | null;
  readonly scope: string | null;
}

/** One inbound message, normalised. Only fields the provider actually returned. */
export interface MailInboundMessage {
  /** The provider's own id for the message — stable across reads. */
  readonly externalId: string;
  readonly subject: string;
  /** The sender as the provider reports them, or null when it reports none. */
  readonly from: string | null;
  /** ISO instant, or null when the provider returned none. Never `now()`. */
  readonly at: string | null;
  /** Provider-side permalink, when one exists. */
  readonly url: string | null;
  readonly unread: boolean;
}

/** Canonical stable identity of a mail message inside DEVWORKSPACE. */
export const mailRef = (provider: MailProviderId, accountId: string, externalId: string): string =>
  `mail:${provider}:${accountId}:${externalId}`;

/**
 * Whether a token set needs refreshing before use.
 * A provider that reported no expiry is treated as "cannot tell" and is used as
 * given: guessing an expiry would make us discard a working credential.
 */
export function accessTokenExpired(expiresAt: string | null, now = new Date()): boolean {
  if (!expiresAt) return false;
  const t = Date.parse(expiresAt);
  if (Number.isNaN(t)) return false;
  // 60s of slack, so a token that dies mid-request is refreshed first.
  return t - now.getTime() <= 60_000;
}
