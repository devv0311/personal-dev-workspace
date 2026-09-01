// Ports: mail (T3.3-CORRECTION).
//
// Three seams, deliberately separate:
//
//   MailProvider          — one external mail system. Provider-agnostic by
//                           construction: no Google type, no Microsoft type,
//                           no SDK. Adding a provider is a new profile behind
//                           this interface plus a config entry.
//   TokenCipher           — how a credential is sealed before it is stored.
//                           The application never sees a storage format and the
//                           persistence layer never sees a plaintext token.
//   MailAccountRepository — user-scoped persistence. Every method takes the
//                           ResolvedScope and filters by `principal_id`, so
//                           there is no unscoped overload that could return one
//                           user's account to another (INV-3).

import type {
  MailAccount,
  MailAccountStatus,
  MailInboundMessage,
  MailProviderId,
  MailTokenSet,
} from '../domain/mail.ts';
import type { ResolvedScope } from '../domain/visibility.ts';

/* ------------------------------------------------------------- provider --- */

export interface MailProviderDescriptor {
  readonly id: MailProviderId;
  readonly label: string;
  /**
   * Whether this deployment can actually complete this provider's flow.
   * False means the UI must offer it as unavailable WITH the reason — never as
   * a button that fails after the user presses it.
   */
  readonly configured: boolean;
  readonly reason: string | null;
  /** The scopes the consent screen will ask for, so the UI can state them. */
  readonly scopes: readonly string[];
}

export interface MailAuthorizationRequest {
  readonly state: string;
  readonly codeChallenge: string;
  readonly redirectUri: string;
  /** Hint the provider may use to pre-select an account. Never a credential. */
  readonly loginHint: string | null;
}

export interface MailProvider {
  /** Static configuration. Never performs I/O, never throws. */
  describe(): MailProviderDescriptor;
  /** The provider's own consent URL. The user authenticates THERE, never here. */
  authorizationUrl(request: MailAuthorizationRequest): string;
  /** Exchange the one-time code for a token set, and learn the real address. */
  exchangeCode(args: {
    code: string;
    codeVerifier: string;
    redirectUri: string;
  }): Promise<{ tokens: MailTokenSet; address: string }>;
  /** Refresh an access token. Throws when the grant is gone. */
  refresh(refreshToken: string): Promise<MailTokenSet>;
  /** Inbound messages needing attention, newest first. Never fabricates. */
  listInbound(accessToken: string, limit: number): Promise<readonly MailInboundMessage[]>;
}

/** The providers this deployment knows about, configured or not. */
export interface MailProviderRegistry {
  list(): readonly MailProviderDescriptor[];
  get(id: string): MailProvider | null;
}

/* --------------------------------------------------------------- cipher --- */

export interface SealedToken {
  readonly ciphertext: Buffer;
  readonly iv: Buffer;
  readonly authTag: Buffer;
  readonly keyId: string;
}

export interface TokenCipher {
  /** Whether a key is configured. False ⇒ connecting must be refused, not faked. */
  available(): { ok: boolean; reason: string | null };
  seal(plaintext: string): SealedToken;
  /** Throws when the sealed value was written under a different key. */
  open(sealed: SealedToken): string;
}

/* ----------------------------------------------------------- repository --- */

export interface NewMailAccount {
  readonly provider: MailProviderId;
  readonly address: string;
  readonly status: MailAccountStatus;
}

export interface MailOAuthRequestRow {
  readonly state: string;
  readonly workspaceId: string;
  readonly principalId: string;
  readonly provider: MailProviderId;
  readonly codeVerifier: string;
  readonly redirectUri: string;
  readonly accountId: string | null;
}

export interface StoredCredential {
  readonly sealed: SealedToken;
  readonly accessExpiresAt: string | null;
}

export interface MailAccountRepository {
  /** This principal's own accounts, oldest first. Never anyone else's. */
  listForPrincipal(scope: ResolvedScope): Promise<MailAccount[]>;
  /** One of this principal's accounts, or null. A foreign id resolves to null. */
  findForPrincipal(scope: ResolvedScope, id: string): Promise<MailAccount | null>;
  /** Create, or return the existing row for the same (principal, provider, address). */
  upsert(scope: ResolvedScope, input: NewMailAccount): Promise<MailAccount>;
  updateStatus(
    scope: ResolvedScope,
    id: string,
    patch: {
      status?: MailAccountStatus;
      lastSyncAt?: string | null;
      lastError?: string | null;
      feedsInbound?: boolean;
    },
  ): Promise<MailAccount | null>;
  /** Removes the account and, by cascade, its credential. Scoped. */
  remove(scope: ResolvedScope, id: string): Promise<boolean>;

  /** Credential I/O. Both are scoped through the account's owner. */
  saveCredential(
    scope: ResolvedScope,
    accountId: string,
    credential: StoredCredential,
  ): Promise<void>;
  readCredential(scope: ResolvedScope, accountId: string): Promise<StoredCredential | null>;

  /** OAuth handshake state. */
  createOAuthRequest(row: MailOAuthRequestRow & { expiresAt: string }): Promise<void>;
  /** Single-use: the row is deleted as it is read, so a state cannot be replayed. */
  consumeOAuthRequest(state: string): Promise<MailOAuthRequestRow | null>;
}
