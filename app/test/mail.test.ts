// T3.3-CORRECTION — PER-USER MAIL ACCOUNTS.
//
// The requirement is that every user can connect their own mailboxes, and the
// property that makes it safe is that a mailbox belongs to the person who
// connected it — not to the workspace, and not to whoever heads it. These tests
// assert that property from several directions, because it is the one that
// would be catastrophic to get wrong:
//
//   USER A connects Mail Account A and sees only their own mail.
//   USER B connects Mail Account B, cannot list A's account, cannot read it,
//         cannot disconnect it, and cannot reach its credential.
//   The workspace HEAD gets no special access to either.
//
// And the credential itself:
//   • it is sealed before it is written, so the plaintext is not in the row;
//   • it cannot be opened with a different key;
//   • it never appears in anything the application returns;
//   • with no key configured, connecting is REFUSED rather than done insecurely.
//
// The provider is a stub. That is the point of the seam: these assertions are
// about ownership and storage, which must not depend on a network, a Google
// project or a consent screen.

import test from 'node:test';
import assert from 'node:assert/strict';

import { resetDatabase, shutdown, baseFixture, IDS } from './helpers.ts';
import { buildContainer } from '../src/adapters/http/container.ts';
import { makeStaticMailProviderRegistry } from '../src/adapters/mail/registry.ts';
import { makeTokenCipher } from '../src/adapters/mail/token-cipher.ts';
import {
  beginMailConnect,
  completeMailConnect,
  disconnectMailAccount,
  listMailAccounts,
  readAccountInbound,
  setMailAccountFeeds,
} from '../src/application/mail-accounts.ts';
import { asPrincipalId } from '../src/domain/ids.ts';
import { getPool } from '../src/adapters/persistence/db.ts';
import type { MailProvider } from '../src/ports/mail.ts';
import type { ResolvedScope } from '../src/domain/visibility.ts';

/** 32 bytes, hex — the shape a real deployment supplies in MAIL_TOKEN_KEY. */
const KEY_A = 'a'.repeat(64);
const KEY_B = 'b'.repeat(64);
const REDIRECT = 'http://localhost:4177/oauth/mail/callback';

const SECRET_REFRESH = 'refresh-token-that-must-never-be-stored-in-the-clear';

interface StubOptions {
  address?: string;
  configured?: boolean;
  failList?: string;
}

/** A provider that completes a flow without a network. */
function stubProvider(opts: StubOptions = {}): MailProvider {
  const address = opts.address ?? 'user-a@example.com';
  return {
    describe: () => ({
      id: 'google',
      label: 'Google · Gmail',
      configured: opts.configured !== false,
      reason: opts.configured === false ? 'Not configured in this test.' : null,
      scopes: ['https://www.googleapis.com/auth/gmail.readonly'],
    }),
    authorizationUrl: (r) =>
      `https://accounts.example/consent?state=${encodeURIComponent(r.state)}` +
      `&code_challenge=${encodeURIComponent(r.codeChallenge)}` +
      `&redirect_uri=${encodeURIComponent(r.redirectUri)}`,
    async exchangeCode() {
      return {
        tokens: {
          accessToken: 'access-token-1',
          refreshToken: SECRET_REFRESH,
          accessExpiresAt: new Date(Date.now() + 3600_000).toISOString(),
          scope: 'gmail.readonly',
        },
        address,
      };
    },
    async refresh() {
      return {
        accessToken: 'access-token-2',
        refreshToken: SECRET_REFRESH,
        accessExpiresAt: new Date(Date.now() + 3600_000).toISOString(),
        scope: 'gmail.readonly',
      };
    },
    async listInbound() {
      if (opts.failList) throw new Error(opts.failList);
      return [
        {
          externalId: 'msg-1',
          subject: 'Review needed on the gateway branch',
          from: 'a colleague',
          at: '2026-08-31T10:00:00.000Z',
          url: 'https://mail.example/msg-1',
          unread: true,
        },
      ];
    },
  };
}

function container(opts: StubOptions = {}, key: string | null = KEY_A) {
  return buildContainer(undefined, {
    mailProviders: makeStaticMailProviderRegistry([stubProvider(opts)]),
    tokenCipher: makeTokenCipher(key),
  });
}

async function scopes(): Promise<{ alice: ResolvedScope; bob: ResolvedScope }> {
  const c = buildContainer();
  const alice = await c.scopeResolver.resolve(asPrincipalId(IDS.alice));
  const bob = await c.scopeResolver.resolve(asPrincipalId(IDS.bob));
  assert.ok(alice && bob);
  return { alice, bob };
}

/** Drive a whole consent flow for one principal, as the HTTP routes do. */
async function connect(
  deps: ReturnType<typeof container>,
  scope: ResolvedScope,
  address: string,
): Promise<string> {
  const started = await beginMailConnect(deps, scope, { provider: 'google', redirectUri: REDIRECT });
  const state = new URL(started.authorizationUrl).searchParams.get('state');
  assert.ok(state);
  const withAddress = buildContainer(undefined, {
    mailProviders: makeStaticMailProviderRegistry([stubProvider({ address })]),
    tokenCipher: makeTokenCipher(KEY_A),
  });
  const { account } = await completeMailConnect(withAddress, { state, code: 'auth-code' });
  return account.id;
}

/* --------------------------------------------------------------- ownership */

test('USER A and USER B each connect their own account, and see only their own', async () => {
  await resetDatabase();
  await baseFixture();
  const { alice, bob } = await scopes();
  const deps = container();

  const a = await connect(deps, alice, 'user-a@example.com');
  const b = await connect(deps, bob, 'user-b@example.com');
  assert.notEqual(a, b);

  const forAlice = await listMailAccounts(deps, alice);
  const forBob = await listMailAccounts(deps, bob);

  assert.deepEqual(forAlice.accounts.map((x) => x.address), ['user-a@example.com']);
  assert.deepEqual(forBob.accounts.map((x) => x.address), ['user-b@example.com']);
  // Neither listing mentions the other user's mailbox in any form.
  assert.equal(JSON.stringify(forBob).includes('user-a@example.com'), false);
  assert.equal(JSON.stringify(forAlice).includes('user-b@example.com'), false);
});

test('one user cannot read, change or disconnect another user\'s account', async () => {
  await resetDatabase();
  await baseFixture();
  const { alice, bob } = await scopes();
  const deps = container();

  const aliceAccount = await connect(deps, alice, 'user-a@example.com');

  // A foreign id is indistinguishable from an unknown one — the same rule the
  // object model uses. Bob learns nothing, including whether it exists.
  assert.equal(await deps.mailAccounts.findForPrincipal(bob, aliceAccount), null);
  assert.equal(await deps.mailAccounts.readCredential(bob, aliceAccount), null);
  await assert.rejects(() => disconnectMailAccount(deps, bob, aliceAccount), /not found/i);
  await assert.rejects(() => setMailAccountFeeds(deps, bob, aliceAccount, false), /not found/i);

  // And Alice's account is untouched by the attempts.
  const stillThere = await deps.mailAccounts.findForPrincipal(alice, aliceAccount);
  assert.equal(stillThere?.address, 'user-a@example.com');
  assert.equal(stillThere?.feedsInbound, true);
});

test('workspace headship grants no access to anyone\'s mailbox', async () => {
  await resetDatabase();
  await baseFixture();
  const { alice, bob } = await scopes();
  // Bob heads the workspace. Alice connects a mailbox.
  await getPool().query(
    `UPDATE workspace_membership SET role = 'owner' WHERE workspace_id = $1 AND principal_id = $2`,
    [IDS.workspace, IDS.bob],
  );
  const deps = container();
  const aliceAccount = await connect(deps, alice, 'user-a@example.com');

  const headView = await listMailAccounts(deps, bob);
  assert.deepEqual(headView.accounts, [], 'the head sees no mailbox but their own');
  assert.equal(await deps.mailAccounts.findForPrincipal(bob, aliceAccount), null);
  assert.equal(await deps.mailAccounts.readCredential(bob, aliceAccount), null);
});

test('a user may hold several accounts, and choose which feed the queue', async () => {
  await resetDatabase();
  await baseFixture();
  const { alice } = await scopes();
  const deps = container();

  const first = await connect(deps, alice, 'work@example.com');
  const second = await connect(deps, alice, 'personal@example.com');
  const third = await connect(deps, alice, 'oncall@example.com');
  assert.equal(new Set([first, second, third]).size, 3);

  const listed = await listMailAccounts(deps, alice);
  assert.deepEqual(
    listed.accounts.map((x) => x.address).sort(),
    ['oncall@example.com', 'personal@example.com', 'work@example.com'],
  );
  // Feeding the queue is per account, and it is the user's choice.
  const off = await setMailAccountFeeds(deps, alice, second, false);
  assert.equal(off.feedsInbound, false);
  const after = await listMailAccounts(deps, alice);
  assert.equal(after.accounts.find((x) => x.id === second)?.feedsInbound, false);
  assert.equal(after.accounts.find((x) => x.id === first)?.feedsInbound, true);
});

test('disconnecting destroys the stored grant, and reconnecting restores one account', async () => {
  await resetDatabase();
  await baseFixture();
  const { alice } = await scopes();
  const deps = container();

  const id = await connect(deps, alice, 'user-a@example.com');
  assert.ok(await deps.mailAccounts.readCredential(alice, id));

  await disconnectMailAccount(deps, alice, id);
  assert.deepEqual((await listMailAccounts(deps, alice)).accounts, []);
  // The credential row went with it rather than being orphaned.
  const { rows } = await getPool().query('SELECT count(*)::int AS n FROM mail_credential');
  assert.equal(rows[0].n, 0);

  // Reconnecting the same address yields ONE account, not a duplicate.
  await connect(deps, alice, 'user-a@example.com');
  await connect(deps, alice, 'user-a@example.com');
  const again = await listMailAccounts(deps, alice);
  assert.equal(again.accounts.length, 1);
  assert.equal(again.accounts[0]?.status, 'connected');
});

/* ------------------------------------------------------------- credentials */

test('a refresh token is sealed before storage and never appears in the clear', async () => {
  await resetDatabase();
  await baseFixture();
  const { alice } = await scopes();
  const deps = container();
  const id = await connect(deps, alice, 'user-a@example.com');

  // Nothing the application returns mentions the secret.
  const listed = await listMailAccounts(deps, alice);
  assert.equal(JSON.stringify(listed).includes(SECRET_REFRESH), false);
  assert.equal(JSON.stringify(listed).includes('access-token-1'), false);
  // The account projection has no token field of any kind.
  assert.equal(
    Object.keys(listed.accounts[0] ?? {}).some((k) => /token|secret|credential/i.test(k)),
    false,
  );

  // Nor does the stored row.
  const { rows } = await getPool().query<{ ciphertext: Buffer; key_id: string }>(
    'SELECT ciphertext, key_id FROM mail_credential',
  );
  assert.equal(rows.length, 1);
  const blob = rows[0]!.ciphertext.toString('utf8');
  assert.equal(blob.includes(SECRET_REFRESH), false, 'the plaintext is not in the row');
  assert.equal(blob.includes('access-token-1'), false);
  assert.ok(rows[0]!.key_id.length > 0, 'the sealing key is fingerprinted');

  // And it round-trips through the cipher that sealed it.
  const stored = await deps.mailAccounts.readCredential(alice, id);
  assert.ok(stored);
  const opened = JSON.parse(makeTokenCipher(KEY_A).open(stored.sealed));
  assert.equal(opened.refreshToken, SECRET_REFRESH);
});

test('a credential sealed with one key cannot be opened with another', async () => {
  const a = makeTokenCipher(KEY_A);
  const b = makeTokenCipher(KEY_B);
  const sealed = a.seal('a-secret');
  assert.equal(a.open(sealed), 'a-secret');
  assert.throws(() => b.open(sealed), /different mail token key/i);

  // Tampering is detected rather than yielding a wrong token (GCM).
  const flipped = Buffer.from(sealed.ciphertext);
  flipped[0] = (flipped[0] ?? 0) ^ 0xff;
  assert.throws(() => a.open({ ...sealed, ciphertext: flipped }));
});

test('with no key configured, connecting is refused rather than done insecurely', async () => {
  await resetDatabase();
  await baseFixture();
  const { alice } = await scopes();
  const deps = container({}, null);

  const view = await listMailAccounts(deps, alice);
  assert.equal(view.storage.ok, false);
  assert.match(view.storage.reason ?? '', /MAIL_TOKEN_KEY/);

  await assert.rejects(
    () => beginMailConnect(deps, alice, { provider: 'google', redirectUri: REDIRECT }),
    /MAIL_TOKEN_KEY/,
  );
  // Nothing was written on the way to refusing.
  const { rows } = await getPool().query('SELECT count(*)::int AS n FROM mail_oauth_request');
  assert.equal(rows[0].n, 0);

  // A short or malformed key is refused for the same reason.
  assert.equal(makeTokenCipher('too-short').available().ok, false);
});

/* --------------------------------------------------------- the handshake -- */

test('the consent URL carries PKCE and a single-use state, and the verifier stays here', async () => {
  await resetDatabase();
  await baseFixture();
  const { alice } = await scopes();
  const deps = container();

  const started = await beginMailConnect(deps, alice, {
    provider: 'google',
    redirectUri: REDIRECT,
  });
  const url = new URL(started.authorizationUrl);
  const state = url.searchParams.get('state');
  assert.ok(state && state.length >= 32, 'state is high-entropy');
  assert.ok(url.searchParams.get('code_challenge'), 'PKCE challenge is sent');

  // The verifier is stored server-side and is NOT in the URL the browser gets.
  const { rows } = await getPool().query<{ code_verifier: string; principal_id: string }>(
    'SELECT code_verifier, principal_id FROM mail_oauth_request WHERE state = $1',
    [state],
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.principal_id, IDS.alice, 'the state is bound to the principal');
  assert.equal(started.authorizationUrl.includes(rows[0]!.code_verifier), false);

  // Completing consumes it; replaying the same state completes nothing.
  await completeMailConnect(deps, { state, code: 'auth-code' });
  await assert.rejects(() => completeMailConnect(deps, { state, code: 'auth-code' }), /not valid/i);
});

test('the completed account is bound to the principal who started the flow', async () => {
  await resetDatabase();
  await baseFixture();
  const { alice, bob } = await scopes();
  const deps = container();

  // Bob starts a flow. Whoever's browser lands on the callback, the account can
  // only ever be created for Bob — the principal comes from the stored state,
  // never from the redirect.
  const started = await beginMailConnect(deps, bob, { provider: 'google', redirectUri: REDIRECT });
  const state = new URL(started.authorizationUrl).searchParams.get('state')!;
  const done = await completeMailConnect(deps, { state, code: 'auth-code' });

  assert.equal(done.principalId, IDS.bob);
  assert.equal(done.account.principalId, IDS.bob);
  assert.deepEqual((await listMailAccounts(deps, alice)).accounts, []);
  assert.equal((await listMailAccounts(deps, bob)).accounts.length, 1);
});

test('an unconfigured provider is offered as unavailable, and refuses to start', async () => {
  await resetDatabase();
  await baseFixture();
  const { alice } = await scopes();
  const deps = container({ configured: false });

  const view = await listMailAccounts(deps, alice);
  assert.equal(view.providers[0]?.configured, false);
  assert.match(view.providers[0]?.reason ?? '', /not configured/i);

  await assert.rejects(
    () => beginMailConnect(deps, alice, { provider: 'google', redirectUri: REDIRECT }),
    /not configured/i,
  );
  // An unknown provider is refused too, rather than silently doing nothing.
  await assert.rejects(
    () => beginMailConnect(deps, alice, { provider: 'pigeon', redirectUri: REDIRECT }),
    /unknown mail provider/i,
  );
});

/* -------------------------------------------------------------- reading --- */

test('a failed read is recorded as a failure, never as an empty inbox', async () => {
  await resetDatabase();
  await baseFixture();
  const { alice } = await scopes();

  const good = container();
  const id = await connect(good, alice, 'user-a@example.com');

  // The same account, read through a provider whose mailbox call fails.
  const failing = buildContainer(undefined, {
    mailProviders: makeStaticMailProviderRegistry([
      stubProvider({ failList: 'mail provider returned 403: insufficient scope' }),
    ]),
    tokenCipher: makeTokenCipher(KEY_A),
  });
  const account = await failing.mailAccounts.findForPrincipal(alice, id);
  assert.ok(account);

  const outcome = await readAccountInbound(failing, alice, account, 5);
  assert.deepEqual(outcome.messages, []);
  assert.match(outcome.error ?? '', /insufficient scope/);
  // The account carries the provider's own words, so the card can explain it.
  assert.equal(outcome.account.status, 'error');
  assert.match(outcome.account.lastError ?? '', /insufficient scope/);
});

test('a successful read returns only what the provider returned, and stamps the sync', async () => {
  await resetDatabase();
  await baseFixture();
  const { alice } = await scopes();
  const deps = container();
  const id = await connect(deps, alice, 'user-a@example.com');
  const account = await deps.mailAccounts.findForPrincipal(alice, id);
  assert.ok(account);

  const outcome = await readAccountInbound(deps, alice, account, 5);
  assert.equal(outcome.error, null);
  assert.equal(outcome.messages.length, 1);
  assert.equal(outcome.messages[0]?.subject, 'Review needed on the gateway branch');
  assert.equal(outcome.messages[0]?.at, '2026-08-31T10:00:00.000Z');
  assert.equal(outcome.account.status, 'connected');
  assert.ok(outcome.account.lastSyncAt, 'the sync instant is recorded, not invented');
});

test.after(shutdown);
