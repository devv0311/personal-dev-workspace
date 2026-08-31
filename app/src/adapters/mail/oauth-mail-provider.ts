// MailProvider — OAuth 2.0 + PKCE, with per-provider profiles
// (T3.3-CORRECTION).
//
// One generic authorization-code implementation, two provider profiles behind
// it. That split is the point: the endpoints, the scopes and the message shape
// differ per provider, but the flow does not, so adding a third provider is a
// profile — not a second code path through the application.
//
// Security posture, stated where it is implemented:
//
//   • The user authenticates AT THE PROVIDER. DEVWORKSPACE never sees, asks
//     for, or stores a mail password. There is no password field anywhere in
//     this feature, and no IMAP-with-basic-auth fallback.
//   • PKCE (S256) on every flow, and a single-use high-entropy `state` that the
//     server minted and stored. The verifier never leaves this process.
//   • The client secret, where a provider requires one, is read from the
//     environment in this server-side adapter and is never included in a
//     response, a redirect, or anything the browser can observe.
//   • Tokens returned here are handed straight to the caller, which seals them
//     before storage. Nothing in this file writes to the datastore or logs a
//     token.
//   • The address is whatever the PROVIDER says the account is, read back from
//     its own profile endpoint after consent — never a string a user typed.

import type {
  MailAuthorizationRequest,
  MailProvider,
  MailProviderDescriptor,
} from '../../ports/mail.ts';
import type {
  MailInboundMessage,
  MailProviderId,
  MailTokenSet,
} from '../../domain/mail.ts';

export interface OAuthProviderProfile {
  readonly id: MailProviderId;
  readonly label: string;
  readonly authorizeUrl: string;
  readonly tokenUrl: string;
  readonly scopes: readonly string[];
  /** Extra query parameters the provider needs on the consent URL. */
  readonly authorizeExtras: Readonly<Record<string, string>>;
  /** Ask the provider which mailbox this grant is for. */
  readAddress(accessToken: string, fetchJson: FetchJson): Promise<string>;
  /** Inbound messages needing attention, newest first. */
  listInbound(
    accessToken: string,
    limit: number,
    fetchJson: FetchJson,
  ): Promise<readonly MailInboundMessage[]>;
}

export interface OAuthCredentials {
  readonly clientId: string | null;
  readonly clientSecret: string | null;
}

type FetchJson = (url: string, init?: RequestInit) => Promise<unknown>;

const TIMEOUT_MS = 15_000;

/** A JSON GET/POST with a timeout, that turns a non-2xx into a readable error. */
async function fetchJson(url: string, init: RequestInit = {}): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    throw new Error(`mail provider unreachable: ${(err as Error).message}`);
  } finally {
    clearTimeout(timer);
  }
  const text = await res.text();
  if (!res.ok) {
    // The provider's own words, truncated — never a stack trace, and never a
    // cheerful substitute that would hide a revoked grant.
    throw new Error(`mail provider returned ${res.status}: ${text.slice(0, 200)}`);
  }
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw new Error('mail provider returned a malformed response');
  }
}

const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);

function toTokenSet(payload: unknown): MailTokenSet {
  const o = (payload ?? {}) as Record<string, unknown>;
  const accessToken = str(o['access_token']);
  if (!accessToken) throw new Error('mail provider returned no access token');
  const expiresIn = typeof o['expires_in'] === 'number' ? o['expires_in'] : null;
  return {
    accessToken,
    refreshToken: str(o['refresh_token']),
    accessExpiresAt: expiresIn ? new Date(Date.now() + expiresIn * 1000).toISOString() : null,
    scope: str(o['scope']),
  };
}

export function makeOAuthMailProvider(
  profile: OAuthProviderProfile,
  credentials: OAuthCredentials,
  deps: { fetchJson?: FetchJson } = {},
): MailProvider {
  const json = deps.fetchJson ?? fetchJson;
  const configured = Boolean(credentials.clientId && credentials.clientSecret);
  const reason = configured
    ? null
    : `${profile.label} is not configured for this deployment. Set its OAuth client id and secret to enable it.`;

  const requireConfigured = (): { clientId: string; clientSecret: string } => {
    if (!credentials.clientId || !credentials.clientSecret) {
      throw new Error(reason ?? 'provider not configured');
    }
    return { clientId: credentials.clientId, clientSecret: credentials.clientSecret };
  };

  return {
    describe(): MailProviderDescriptor {
      return {
        id: profile.id,
        label: profile.label,
        configured,
        reason,
        scopes: profile.scopes,
      };
    },

    authorizationUrl(request: MailAuthorizationRequest): string {
      const { clientId } = requireConfigured();
      const url = new URL(profile.authorizeUrl);
      url.searchParams.set('client_id', clientId);
      url.searchParams.set('response_type', 'code');
      url.searchParams.set('redirect_uri', request.redirectUri);
      url.searchParams.set('scope', profile.scopes.join(' '));
      url.searchParams.set('state', request.state);
      url.searchParams.set('code_challenge', request.codeChallenge);
      url.searchParams.set('code_challenge_method', 'S256');
      for (const [k, v] of Object.entries(profile.authorizeExtras)) url.searchParams.set(k, v);
      if (request.loginHint) url.searchParams.set('login_hint', request.loginHint);
      return url.toString();
    },

    async exchangeCode({ code, codeVerifier, redirectUri }) {
      const { clientId, clientSecret } = requireConfigured();
      const body = new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        client_id: clientId,
        client_secret: clientSecret,
        code_verifier: codeVerifier,
      });
      const tokens = toTokenSet(
        await json(profile.tokenUrl, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: body.toString(),
        }),
      );
      // The provider names the mailbox, not the user.
      const address = await profile.readAddress(tokens.accessToken, json);
      return { tokens, address };
    },

    async refresh(refreshToken: string): Promise<MailTokenSet> {
      const { clientId, clientSecret } = requireConfigured();
      const body = new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: clientId,
        client_secret: clientSecret,
      });
      const next = toTokenSet(
        await json(profile.tokenUrl, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: body.toString(),
        }),
      );
      // A refresh commonly returns no new refresh token; keeping the old one is
      // correct, and inventing one would break the next refresh.
      return next.refreshToken ? next : { ...next, refreshToken };
    },

    listInbound(accessToken: string, limit: number) {
      return profile.listInbound(accessToken, limit, json);
    },
  };
}

/* ------------------------------------------------------------- profiles --- */

const auth = (accessToken: string): RequestInit => ({
  headers: { authorization: `Bearer ${accessToken}` },
});

/**
 * Google / Gmail.
 *
 * READ-ONLY scope by design: this product triages inbound work, it does not
 * send or modify mail, so it never asks for a permission it does not use.
 */
export const GOOGLE_PROFILE: OAuthProviderProfile = {
  id: 'google',
  label: 'Google · Gmail',
  authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenUrl: 'https://oauth2.googleapis.com/token',
  scopes: ['https://www.googleapis.com/auth/gmail.readonly'],
  // offline + consent are what make a refresh token available, so the account
  // keeps working without asking the user again on every access-token expiry.
  authorizeExtras: { access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true' },

  async readAddress(accessToken, json) {
    const profile = (await json(
      'https://gmail.googleapis.com/gmail/v1/users/me/profile',
      auth(accessToken),
    )) as { emailAddress?: unknown };
    const address = str(profile.emailAddress);
    if (!address) throw new Error('Google did not report the address for this mailbox.');
    return address;
  },

  async listInbound(accessToken, limit, json) {
    const list = (await json(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages?labelIds=INBOX&q=is:unread&maxResults=${limit}`,
      auth(accessToken),
    )) as { messages?: Array<{ id?: unknown }> };
    const ids = (list.messages ?? [])
      .map((m) => str(m.id))
      .filter((id): id is string => !!id)
      .slice(0, limit);

    const out: MailInboundMessage[] = [];
    for (const id of ids) {
      const msg = (await json(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(id)}` +
          '?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date',
        auth(accessToken),
      )) as {
        id?: unknown;
        internalDate?: unknown;
        labelIds?: unknown;
        payload?: { headers?: Array<{ name?: unknown; value?: unknown }> };
      };
      const headers = new Map<string, string>();
      for (const h of msg.payload?.headers ?? []) {
        const name = str(h.name);
        const value = str(h.value);
        if (name && value) headers.set(name.toLowerCase(), value);
      }
      const internal =
        typeof msg.internalDate === 'string' && /^\d+$/.test(msg.internalDate)
          ? new Date(Number(msg.internalDate)).toISOString()
          : null;
      const labels = Array.isArray(msg.labelIds) ? (msg.labelIds as unknown[]) : [];
      out.push({
        externalId: id,
        // No subject is a real state of a message; it is not filled in.
        subject: headers.get('subject') ?? '(no subject)',
        from: headers.get('from') ?? null,
        at: internal,
        url: `https://mail.google.com/mail/u/0/#inbox/${encodeURIComponent(id)}`,
        unread: labels.includes('UNREAD'),
      });
    }
    return out;
  },
};

/**
 * Microsoft / Outlook, through Microsoft Graph. Same flow, different endpoints
 * and a different message shape — which is exactly what the profile seam is for.
 */
export const MICROSOFT_PROFILE: OAuthProviderProfile = {
  id: 'microsoft',
  label: 'Microsoft · Outlook',
  authorizeUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
  tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
  scopes: ['offline_access', 'User.Read', 'Mail.Read'],
  authorizeExtras: { response_mode: 'query' },

  async readAddress(accessToken, json) {
    const me = (await json('https://graph.microsoft.com/v1.0/me', auth(accessToken))) as {
      mail?: unknown;
      userPrincipalName?: unknown;
    };
    const address = str(me.mail) ?? str(me.userPrincipalName);
    if (!address) throw new Error('Microsoft did not report the address for this mailbox.');
    return address;
  },

  async listInbound(accessToken, limit, json) {
    const page = (await json(
      'https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages' +
        `?$filter=isRead eq false&$top=${limit}&$orderby=receivedDateTime desc` +
        '&$select=id,subject,from,receivedDateTime,webLink,isRead',
      auth(accessToken),
    )) as {
      value?: Array<{
        id?: unknown;
        subject?: unknown;
        receivedDateTime?: unknown;
        webLink?: unknown;
        isRead?: unknown;
        from?: { emailAddress?: { address?: unknown; name?: unknown } };
      }>;
    };
    const out: MailInboundMessage[] = [];
    for (const m of page.value ?? []) {
      const id = str(m.id);
      if (!id) continue;
      const sender = m.from?.emailAddress;
      out.push({
        externalId: id,
        subject: str(m.subject) ?? '(no subject)',
        from: str(sender?.name) ?? str(sender?.address),
        at: str(m.receivedDateTime),
        url: str(m.webLink),
        unread: m.isRead !== true,
      });
    }
    return out;
  },
};
