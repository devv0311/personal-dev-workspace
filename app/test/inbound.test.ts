// T3.3-CORRECTION — THE ATTENTION STACK.
//
// This replaced `EMAIL — NOT CONNECTED`: a dead placeholder for one mailbox.
// The surface is now one triage queue fed by several sources, and mail is one of
// them. What these tests pin is the honesty of that queue:
//
//   1. EVERY SOURCE STATES ITS OWN CONDITION. `not_configured`,
//      `not_connected`, `unavailable` and `connected` are four different facts.
//      An unreadable source contributes NOTHING and says why — it never becomes
//      an empty queue that reads as "nothing needs you".
//   2. ONLY WHAT NEEDS ATTENTION. A merged pull request is history; a green CI
//      run is not an alert. Neither enters the queue.
//   3. A COUNT IS EXACT OR ABSENT. A category whose sources could not prove a
//      total renders no number at all.
//   4. MAIL IS PERSONAL. Items come only from accounts the CALLER connected,
//      and each keeps the address that produced it.

import test from 'node:test';
import assert from 'node:assert/strict';

import { resetDatabase, shutdown, baseFixture, IDS } from './helpers.ts';
import { buildContainer } from '../src/adapters/http/container.ts';
import { makeStaticMailProviderRegistry } from '../src/adapters/mail/registry.ts';
import { makeTokenCipher } from '../src/adapters/mail/token-cipher.ts';
import { beginMailConnect, completeMailConnect } from '../src/application/mail-accounts.ts';
import { readInboundQueue } from '../src/application/inbound-queue.ts';
import { asPrincipalId } from '../src/domain/ids.ts';
import type { ExternalActivityProvider } from '../src/ports/external-activity.ts';
import type { ExternalSnapshot } from '../src/domain/external.ts';
import type { MailProvider } from '../src/ports/mail.ts';
import type { ResolvedScope } from '../src/domain/visibility.ts';

const REPO = 'devv0311/personal-dev-workspace';
const KEY = 'c'.repeat(64);
const REDIRECT = 'http://localhost:4177/oauth/mail/callback';

const entity = (
  kind: string,
  id: string,
  title: string,
  state: string,
  at: string,
  detail: Record<string, string | number | boolean | null> = {},
) => ({
  ref: `github:${kind}:${id}`,
  source: 'github' as const,
  kind: kind as never,
  externalId: id,
  title,
  actor: 'devv0311',
  at,
  state,
  url: `https://github.com/${REPO}/x/${id}`,
  detail,
});

/** Two open PRs, one merged PR, one failed run, one successful run, one issue. */
const SNAPSHOT: ExternalSnapshot = {
  source: 'github',
  repository: REPO,
  authMode: 'anonymous',
  fetchedAt: '2026-08-31T12:00:00.000Z',
  stale: false,
  staleReason: null,
  sections: {
    pull_request: {
      ok: true,
      kind: 'pull_request',
      total: 3,
      entities: [
        entity('pull_request', '20', 'Auth boundary', 'open', '2026-08-31T10:00:00.000Z'),
        entity('pull_request', '21', 'Token bucket', 'open', '2026-08-31T09:00:00.000Z'),
        entity('pull_request', '18', 'Repo cleanup', 'merged', '2026-08-30T09:00:00.000Z'),
      ],
    },
    workflow_run: {
      ok: true,
      kind: 'workflow_run',
      total: 2,
      entities: [
        entity('workflow_run', '99', 'CI', 'failure', '2026-08-31T11:00:00.000Z', {
          branch: 'feature/p3.4',
        }),
        entity('workflow_run', '98', 'CI', 'success', '2026-08-31T08:00:00.000Z'),
      ],
    },
    issue: {
      ok: true,
      kind: 'issue',
      total: 1,
      entities: [entity('issue', '7', 'Flaky retry test', 'open', '2026-08-29T08:00:00.000Z')],
    },
  },
};

/** The forge is reachable but every section failed. */
const BROKEN: ExternalSnapshot = {
  ...SNAPSHOT,
  sections: {
    pull_request: { ok: false, kind: 'pull_request', error: 'rate limit exceeded' },
    workflow_run: { ok: false, kind: 'workflow_run', error: 'rate limit exceeded' },
    issue: { ok: false, kind: 'issue', error: 'rate limit exceeded' },
  },
};

/** A page of pull requests whose total the source could not prove. */
const PARTIAL: ExternalSnapshot = {
  ...SNAPSHOT,
  sections: {
    ...SNAPSHOT.sections,
    pull_request: {
      ok: true,
      kind: 'pull_request',
      total: null,
      entities: [entity('pull_request', '20', 'Auth boundary', 'open', '2026-08-31T10:00:00.000Z')],
    },
  },
};

const forge = (snapshot: ExternalSnapshot, configured = true): ExternalActivityProvider => ({
  describe: () => ({ source: 'github', repository: REPO, configured, authenticated: false }),
  snapshot: async () => snapshot,
});

function mailProvider(address: string): MailProvider {
  return {
    describe: () => ({
      id: 'google',
      label: 'Google · Gmail',
      configured: true,
      reason: null,
      scopes: ['gmail.readonly'],
    }),
    authorizationUrl: (r) => `https://accounts.example/consent?state=${encodeURIComponent(r.state)}`,
    async exchangeCode() {
      return {
        tokens: {
          accessToken: 'a',
          refreshToken: 'r',
          accessExpiresAt: new Date(Date.now() + 3600_000).toISOString(),
          scope: null,
        },
        address,
      };
    },
    async refresh() {
      return { accessToken: 'a2', refreshToken: 'r', accessExpiresAt: null, scope: null };
    },
    async listInbound() {
      return [
        {
          externalId: `m-${address}`,
          subject: `Important message for ${address}`,
          from: 'someone',
          at: '2026-08-31T10:30:00.000Z',
          url: 'https://mail.example/1',
          unread: true,
        },
      ];
    },
  };
}

const deps = (snapshot: ExternalSnapshot, address: string | null, configured = true) =>
  buildContainer(undefined, {
    external: forge(snapshot, configured),
    mailProviders: makeStaticMailProviderRegistry(address ? [mailProvider(address)] : []),
    tokenCipher: makeTokenCipher(KEY),
  });

async function scopes(): Promise<{ alice: ResolvedScope; bob: ResolvedScope }> {
  const c = buildContainer();
  const alice = await c.scopeResolver.resolve(asPrincipalId(IDS.alice));
  const bob = await c.scopeResolver.resolve(asPrincipalId(IDS.bob));
  assert.ok(alice && bob);
  return { alice, bob };
}

async function connect(container: ReturnType<typeof deps>, scope: ResolvedScope): Promise<void> {
  const started = await beginMailConnect(container, scope, {
    provider: 'google',
    redirectUri: REDIRECT,
  });
  const state = new URL(started.authorizationUrl).searchParams.get('state')!;
  await completeMailConnect(container, { state, code: 'code' });
}

test('the queue carries only what actually needs a human', async () => {
  await resetDatabase();
  await baseFixture();
  const { alice } = await scopes();

  const queue = await readInboundQueue(deps(SNAPSHOT, null), alice);
  const ids = queue.items.map((i) => i.id);

  // Two open PRs, one failed run, one open issue.
  assert.deepEqual(ids, [
    'github:workflow_run:99',
    'github:pull_request:20',
    'github:pull_request:21',
    'github:issue:7',
  ]);
  // A merged PR is history and a green run is not an alert.
  assert.equal(ids.includes('github:pull_request:18'), false);
  assert.equal(ids.includes('github:workflow_run:98'), false);

  // Newest first, and each row keeps its own real fields.
  const ci = queue.items[0]!;
  assert.equal(ci.category, 'ci_failure');
  assert.equal(ci.subtitle, 'feature/p3.4');
  assert.equal(ci.state, 'failure');
  assert.equal(ci.sourceAccount, null, 'a repository event is not attributed to a mailbox');
});

test('counts are printed only when the source proved them exact', async () => {
  await resetDatabase();
  await baseFixture();
  const { alice } = await scopes();

  const exact = await readInboundQueue(deps(SNAPSHOT, null), alice);
  const byCat = new Map(exact.categories.map((c) => [c.category, c.count]));
  assert.equal(byCat.get('pull_request'), 2);
  assert.equal(byCat.get('ci_failure'), 1);
  assert.equal(byCat.get('issue'), 1);

  // When the page is not provably the whole set, the count is an absence —
  // never the size of the page in hand.
  const partial = await readInboundQueue(deps(PARTIAL, null), alice);
  const partialCounts = new Map(partial.categories.map((c) => [c.category, c.count]));
  assert.equal(partialCounts.get('pull_request'), null);
  assert.equal(partial.items.filter((i) => i.category === 'pull_request').length, 1);
});

test('an unreadable source contributes nothing and says why', async () => {
  await resetDatabase();
  await baseFixture();
  const { alice } = await scopes();

  const queue = await readInboundQueue(deps(BROKEN, null), alice);
  assert.deepEqual(queue.items, []);
  const repo = queue.sources.find((s) => s.source === 'github');
  assert.equal(repo?.state, 'unavailable');
  assert.match(repo?.detail ?? '', /rate limit exceeded/);
  // Unavailable is not "clear": no count is claimed for anything.
  assert.deepEqual(queue.categories, []);
});

test('an unconfigured forge is reported as unconfigured, not as unavailable', async () => {
  await resetDatabase();
  await baseFixture();
  const { alice } = await scopes();

  const queue = await readInboundQueue(deps(SNAPSHOT, null, false), alice);
  const repo = queue.sources.find((s) => s.source === 'github');
  assert.equal(repo?.state, 'not_configured');
  assert.match(repo?.detail ?? '', /No repository is configured/);
  assert.deepEqual(queue.items, []);
});

test('with no mail connected, the mail source says so — and shows no messages', async () => {
  await resetDatabase();
  await baseFixture();
  const { alice } = await scopes();

  const queue = await readInboundQueue(deps(SNAPSHOT, 'user-a@example.com'), alice);
  const mail = queue.sources.find((s) => s.source === 'mail');
  assert.equal(mail?.state, 'not_connected');
  assert.equal(mail?.accounts, 0);
  assert.match(mail?.detail ?? '', /No mail account is connected to your user/);
  assert.equal(queue.items.some((i) => i.source === 'mail'), false);
});

test('mail items appear only for the user who connected the account, with its address', async () => {
  await resetDatabase();
  await baseFixture();
  const { alice, bob } = await scopes();

  const container = deps(SNAPSHOT, 'user-a@example.com');
  await connect(container, alice);

  const forAlice = await readInboundQueue(container, alice);
  const message = forAlice.items.find((i) => i.source === 'mail');
  assert.ok(message, "the connecting user sees their own mail");
  assert.equal(message.category, 'message');
  // Account attribution: which mailbox is asking for you.
  assert.equal(message.sourceAccount, 'user-a@example.com');
  assert.match(message.id, /^mail:google:/);
  assert.equal(forAlice.sources.find((s) => s.source === 'mail')?.state, 'connected');

  // Bob connected nothing: he sees no mail at all, and nothing about Alice's.
  const forBob = await readInboundQueue(container, bob);
  assert.equal(forBob.items.some((i) => i.source === 'mail'), false);
  assert.equal(JSON.stringify(forBob).includes('user-a@example.com'), false);
  assert.equal(forBob.sources.find((s) => s.source === 'mail')?.state, 'not_connected');
});

test('a message page is never counted as a mailbox total', async () => {
  await resetDatabase();
  await baseFixture();
  const { alice } = await scopes();

  const container = deps(SNAPSHOT, 'user-a@example.com');
  await connect(container, alice);

  const queue = await readInboundQueue(container, alice);
  const messages = queue.categories.find((c) => c.category === 'message');
  assert.ok(messages);
  assert.equal(messages.count, null, 'a page of messages is a page, not a total');
  assert.ok(queue.items.filter((i) => i.category === 'message').length > 0);
});

test.after(shutdown);
