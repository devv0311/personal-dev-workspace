// T3.3.1 — external activity: normalisation, availability, and the authorized
// internal ↔ external join.
//
// The GitHub adapter is driven through an INJECTED fetch. That is deliberate on
// two counts: these assertions are about how a payload is normalised, which must
// not depend on the network or on a rate limit; and the fixtures below are
// verbatim-shaped GitHub responses, so a change in our normalisation is caught
// here rather than in a browser.
//
// Nothing in this file is a stand-in for real data in the product. The running
// application always reads the live API — there is no fixture path in
// production, and no code that can serve one.

import test from 'node:test';
import assert from 'node:assert/strict';

import { resetDatabase, shutdown, baseFixture, IDS } from './helpers.ts';
import { buildContainer } from '../src/adapters/http/container.ts';
import { makeGitHubActivityProvider } from '../src/adapters/external/github.ts';
import {
  readExternalActivity,
  openPullRequestCount,
} from '../src/application/external-activity.ts';
import { sourceRef, parseSourceRef } from '../src/domain/external.ts';
import type { ExternalActivityProvider } from '../src/ports/external-activity.ts';
import type { ExternalSnapshot } from '../src/domain/external.ts';
import { asPrincipalId } from '../src/domain/ids.ts';
import { getPool } from '../src/adapters/persistence/db.ts';

const REPO = 'devv0311/personal-dev-workspace';

/* --------------------------------------------------------------- fixtures -- */
// Response shapes as GitHub actually returns them, trimmed to the fields the
// adapter reads plus a few it must ignore.

const REPO_BODY = {
  full_name: REPO,
  description: 'A developer’s persistent context layer',
  default_branch: 'main',
  visibility: 'public',
  language: 'TypeScript',
  pushed_at: '2026-08-31T15:19:30Z',
  created_at: '2026-08-28T19:45:49Z',
  updated_at: '2026-08-31T15:36:36Z',
  open_issues_count: 3,
  forks_count: 0,
  stargazers_count: 0,
  size: 44446,
  archived: false,
  owner: { login: 'devv0311' },
  html_url: `https://github.com/${REPO}`,
};

const COMMITS_BODY = [
  {
    sha: 'cc3c1b0b55227812842e7016b99f1c11a90270ae',
    html_url: `https://github.com/${REPO}/commit/cc3c1b0`,
    author: { login: 'devv0311' },
    commit: {
      message: 'Merge pull request #18 from devv0311/chore/cleanup\n\nbody text',
      author: { name: 'Dev', date: '2026-08-31T15:19:25Z' },
      committer: { name: 'GitHub' },
    },
  },
  {
    sha: 'aaaa111',
    html_url: null,
    // No GitHub account attached — the commit's own author name is all there is.
    author: null,
    commit: { message: 'first line only', author: { name: 'Someone', date: '2026-08-30T09:00:00Z' } },
  },
];

const PULLS_BODY = [
  {
    number: 18,
    title: 'chore: repository cleanup',
    state: 'closed',
    merged_at: '2026-08-31T15:19:26Z',
    closed_at: '2026-08-31T15:19:26Z',
    created_at: '2026-08-31T15:19:13Z',
    updated_at: '2026-08-31T15:19:26Z',
    draft: false,
    user: { login: 'devv0311' },
    head: { ref: 'chore/cleanup' },
    base: { ref: 'main' },
    html_url: `https://github.com/${REPO}/pull/18`,
  },
  {
    number: 19,
    title: 'feat: still open',
    state: 'open',
    merged_at: null,
    closed_at: null,
    created_at: '2026-08-31T16:00:00Z',
    updated_at: '2026-08-31T16:30:00Z',
    draft: false,
    user: { login: 'devv0311' },
    head: { ref: 'feature/x' },
    base: { ref: 'main' },
    html_url: `https://github.com/${REPO}/pull/19`,
  },
];

// GitHub's /issues returns pull requests too. The second entry here IS a PR.
const ISSUES_BODY = [
  {
    number: 7,
    title: 'a real issue',
    state: 'open',
    created_at: '2026-08-30T10:00:00Z',
    updated_at: '2026-08-30T11:00:00Z',
    closed_at: null,
    comments: 2,
    user: { login: 'devv0311' },
    html_url: `https://github.com/${REPO}/issues/7`,
  },
  {
    number: 19,
    title: 'feat: still open',
    state: 'open',
    pull_request: { url: 'https://api.github.com/…/pulls/19' },
    created_at: '2026-08-31T16:00:00Z',
    user: { login: 'devv0311' },
    html_url: `https://github.com/${REPO}/pull/19`,
  },
];

const BRANCHES_BODY = [
  { name: 'main', commit: { sha: 'cc3c1b0b5522' }, protected: false },
  { name: 'develop', commit: { sha: '6c98e5c1234' }, protected: false },
];

const CONTRIBUTORS_BODY = [
  { login: 'devv0311', id: 97945226, contributions: 54, type: 'User', html_url: 'https://github.com/devv0311' },
];

interface RouteOptions {
  /** Paths (substring match) that should fail, with the status to fail with. */
  readonly fail?: Readonly<Record<string, number>>;
  /** Add a `rel="next"` Link header, so no total is provable. */
  readonly paginate?: readonly string[];
  /** Reject at the transport layer — nothing is reachable at all. */
  readonly offline?: boolean;
  readonly runsTotal?: number;
}

function routedFetch(options: RouteOptions = {}): typeof fetch {
  const bodyFor = (url: string): unknown => {
    if (url.includes('/contributors')) return CONTRIBUTORS_BODY;
    if (url.includes('/commits')) return COMMITS_BODY;
    if (url.includes('/branches')) return BRANCHES_BODY;
    if (url.includes('/pulls')) return PULLS_BODY;
    if (url.includes('/issues')) return ISSUES_BODY;
    if (url.includes('/actions/runs')) {
      return { total_count: options.runsTotal ?? 0, workflow_runs: [] };
    }
    return REPO_BODY;
  };

  return (async (input: Parameters<typeof fetch>[0]) => {
    const url = String(input);
    if (options.offline) throw new Error('getaddrinfo ENOTFOUND api.github.com');
    for (const [needle, status] of Object.entries(options.fail ?? {})) {
      if (url.includes(needle)) {
        return new Response(JSON.stringify({ message: 'API rate limit exceeded' }), {
          status,
          headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1800000000' },
        });
      }
    }
    const headers: Record<string, string> = {};
    if ((options.paginate ?? []).some((p) => url.includes(p))) {
      headers['link'] = `<${url}&page=2>; rel="next", <${url}&page=9>; rel="last"`;
    }
    return new Response(JSON.stringify(bodyFor(url)), { status: 200, headers });
  }) as typeof fetch;
}

const provider = (options: RouteOptions = {}, extra: Record<string, unknown> = {}) =>
  makeGitHubActivityProvider({
    repository: REPO,
    cacheTtlMs: 0,
    fetchImpl: routedFetch(options),
    ...extra,
  });

/* ------------------------------------------------------------ source refs -- */

test('a source reference is stable, canonical, and round-trips', () => {
  const ref = sourceRef('github', 'pull_request', '18');
  assert.equal(ref, 'github:pull_request:18');
  assert.deepEqual(parseSourceRef(ref), {
    source: 'github',
    kind: 'pull_request',
    externalId: '18',
  });
  // A repository id contains a slash; the parse must not split on it.
  assert.deepEqual(parseSourceRef(sourceRef('github', 'repository', REPO)), {
    source: 'github',
    kind: 'repository',
    externalId: REPO,
  });
  // Anything that is not one of ours is rejected rather than half-parsed.
  assert.equal(parseSourceRef('gitlab:commit:abc'), null);
  assert.equal(parseSourceRef('github:invented_kind:1'), null);
  assert.equal(parseSourceRef('github:commit:'), null);
  assert.equal(parseSourceRef(42), null);
});

/* ---------------------------------------------------------- normalisation -- */

test('every normalised field comes from the payload, and an absent field stays absent', async () => {
  const snap = await provider().snapshot();

  const repo = snap.sections['repository'];
  assert.ok(repo?.ok);
  const r = repo.entities[0]!;
  assert.equal(r.ref, `github:repository:${REPO}`);
  assert.equal(r.at, REPO_BODY.pushed_at);
  assert.equal(r.state, 'public');
  assert.equal(r.detail['defaultBranch'], 'main');
  // GitHub's open_issues_count counts PULL REQUESTS as well; it is carried
  // under a name that says so, so no surface can print it as an issue count.
  assert.equal(r.detail['openIssuesAndPullRequests'], 3);
  assert.equal(Object.hasOwn(r.detail, 'openIssues'), false);

  const commits = snap.sections['commit'];
  assert.ok(commits?.ok);
  // Title is the commit SUBJECT — the first line, never the whole message.
  assert.equal(commits.entities[0]!.title, 'Merge pull request #18 from devv0311/chore/cleanup');
  assert.equal(commits.entities[0]!.actor, 'devv0311');
  assert.equal(commits.entities[0]!.at, '2026-08-31T15:19:25Z');
  // A commit has no state; the field is null rather than an invented word.
  assert.equal(commits.entities[0]!.state, null);
  // No linked GitHub account ⇒ fall back to the name in the commit, and a
  // missing html_url stays null rather than becoming a fabricated link.
  assert.equal(commits.entities[1]!.actor, 'Someone');
  assert.equal(commits.entities[1]!.url, null);

  // A merged pull request is reported as 'merged'. GitHub calls it 'closed',
  // which would lose the distinction the user actually cares about.
  const pulls = snap.sections['pull_request'];
  assert.ok(pulls?.ok);
  assert.equal(pulls.entities[0]!.state, 'merged');
  assert.equal(pulls.entities[1]!.state, 'open');

  // A branch carries no timestamp and no URL in this payload. Both stay null.
  const branches = snap.sections['branch'];
  assert.ok(branches?.ok);
  assert.equal(branches.entities[0]!.at, null);
  assert.equal(branches.entities[0]!.url, null);
  assert.equal(branches.entities[0]!.detail['headSha'], 'cc3c1b0');
});

test('pull requests are not counted as issues', async () => {
  const snap = await provider().snapshot();
  const issues = snap.sections['issue'];
  assert.ok(issues?.ok);
  // The fixture has two rows; one of them is a PR and must be dropped.
  assert.equal(issues.entities.length, 1);
  assert.equal(issues.entities[0]!.ref, 'github:issue:7');
  assert.equal(issues.total, 1);
});

test('a total is reported only when it is provably exact', async () => {
  const exact = await provider().snapshot();
  const pulls = exact.sections['pull_request'];
  assert.ok(pulls?.ok);
  assert.equal(pulls.total, 2, 'no rel="next" ⇒ the page is the whole set');
  assert.equal(openPullRequestCount(exact), 1);

  // With more pages, the count is unknown — and unknown is reported as unknown
  // rather than as the size of the page we happen to hold.
  const paged = await provider({ paginate: ['/pulls'] }).snapshot();
  const pagedPulls = paged.sections['pull_request'];
  assert.ok(pagedPulls?.ok);
  assert.equal(pagedPulls.total, null);
  assert.equal(openPullRequestCount(paged), null);
});

test('the Actions total is the real one, so zero runs reads as zero runs', async () => {
  const none = await provider().snapshot();
  const ci = none.sections['workflow_run'];
  assert.ok(ci?.ok);
  assert.equal(ci.total, 0);
  assert.equal(ci.entities.length, 0);
});

/* ------------------------------------------------------------ availability -- */

test('one failing section does not silence the others, and says why it failed', async () => {
  const snap = await provider({ fail: { '/commits': 403 } }).snapshot();

  const commits = snap.sections['commit'];
  assert.equal(commits?.ok, false);
  assert.ok(!commits!.ok && /rate limit/i.test(commits!.error));
  // Crucially: NOT an empty entity list, which would read as "no commits".
  assert.equal(Object.hasOwn(commits!, 'entities'), false);

  for (const kind of ['repository', 'branch', 'pull_request', 'contributor']) {
    assert.equal(snap.sections[kind]?.ok, true, `${kind} must be unaffected`);
  }
});

test('an unreachable refetch preserves the previous snapshot and marks it stale', async () => {
  let offline = false;
  let clock = Date.parse('2026-08-31T10:00:00Z');
  const p = makeGitHubActivityProvider({
    repository: REPO,
    cacheTtlMs: 0,
    now: () => new Date(clock),
    fetchImpl: (async (input: Parameters<typeof fetch>[0]) =>
      routedFetch({ offline })(input)) as typeof fetch,
  });

  const first = await p.snapshot();
  assert.equal(first.stale, false);
  assert.equal(first.sections['commit']?.ok, true);
  const originalFetchedAt = first.fetchedAt;

  offline = true;
  clock += 60_000;
  const second = await p.snapshot();
  assert.equal(second.stale, true);
  assert.ok(second.staleReason && /unreachable/i.test(second.staleReason));
  // The AGE is not reset by serving a cached copy — freshness stays truthful.
  assert.equal(second.fetchedAt, originalFetchedAt);
  assert.equal(second.sections['commit']?.ok, true);
});

test('an unconfigured provider reports every section unavailable, never empty', async () => {
  const p = makeGitHubActivityProvider({ repository: '', fetchImpl: routedFetch() });
  assert.equal(p.describe().configured, false);
  const snap = await p.snapshot();
  for (const section of Object.values(snap.sections)) {
    assert.equal(section.ok, false);
    assert.ok(!section.ok && /no github repository is configured/i.test(section.error));
  }
});

test('the token never appears in a snapshot, and the auth mode is stated', async () => {
  const withToken = makeGitHubActivityProvider({
    repository: REPO,
    token: 'ghp_super_secret_value',
    cacheTtlMs: 0,
    fetchImpl: routedFetch(),
  });
  const snap = await withToken.snapshot();
  assert.equal(snap.authMode, 'authenticated');
  assert.equal(JSON.stringify(snap).includes('ghp_super_secret_value'), false);
  assert.equal((await provider().snapshot()).authMode, 'anonymous');
});

/* ------------------------------------------- the authorized internal join -- */

const stubProvider = (snapshot: ExternalSnapshot): ExternalActivityProvider => ({
  describe: () => ({ source: 'github', repository: REPO, configured: true, authenticated: false }),
  snapshot: async () => snapshot,
});

test('an internal object anchored to a repository is linked — for those who may see it', async (t) => {
  await resetDatabase();
  await baseFixture();

  const repoRef = sourceRef('github', 'repository', REPO);
  const pool = getPool();
  // Alice owns an object carrying the anchor. Bob is a member with no share.
  await pool.query(
    `UPDATE object SET attributes = $2::jsonb WHERE id = $1`,
    [IDS.projectA, JSON.stringify({ externalRef: repoRef })],
  );

  const snapshot = await provider().snapshot();
  const container = buildContainer(undefined, stubProvider(snapshot));
  const alice = await container.scopeResolver.resolve(asPrincipalId(IDS.alice));
  const bob = await container.scopeResolver.resolve(asPrincipalId(IDS.bob));
  assert.ok(alice && bob);

  const forAlice = await readExternalActivity(container, alice);
  assert.deepEqual(
    forAlice.links.map((l) => [l.ref, l.objectId]),
    [[repoRef, IDS.projectA]],
  );

  // The repository is public and its ACTIVITY is readable by any member — but
  // the internal object behind it is not Bob's to see, so no link is offered.
  const forBob = await readExternalActivity(container, bob);
  assert.deepEqual(forBob.links, []);
  assert.equal(forBob.sections['repository']?.ok, true);

  await t.test('sharing the project makes the link appear, through the ONE policy', async () => {
    await pool.query(
      `INSERT INTO project_share (workspace_id, project_id, principal_id, granted_by)
       VALUES ($1, $2, $3, $4)`,
      [IDS.workspace, IDS.projectA, IDS.bob, IDS.alice],
    );
    const shared = await container.scopeResolver.resolve(asPrincipalId(IDS.bob));
    assert.ok(shared);
    const after = await readExternalActivity(container, shared);
    assert.deepEqual(after.links.map((l) => l.objectId), [IDS.projectA]);
  });
});

test('an external reference that matches no internal object produces no link', async () => {
  await resetDatabase();
  await baseFixture();
  const snapshot = await provider().snapshot();
  const container = buildContainer(undefined, stubProvider(snapshot));
  const alice = await container.scopeResolver.resolve(asPrincipalId(IDS.alice));
  assert.ok(alice);
  const view = await readExternalActivity(container, alice);
  // Plenty of external entities, and not one of them is asserted to correspond
  // to an internal object on a guess.
  assert.ok(view.sections['commit']?.ok);
  assert.deepEqual(view.links, []);
  assert.equal(view.repository, REPO);
  assert.equal(view.repositoryUrl, `https://github.com/${REPO}`);
});

test('external activity creates no objects — the object model is untouched', async () => {
  await resetDatabase();
  await baseFixture();
  const before = await getPool().query<{ n: string }>('SELECT count(*) AS n FROM object');
  const container = buildContainer(undefined, stubProvider(await provider().snapshot()));
  const alice = await container.scopeResolver.resolve(asPrincipalId(IDS.alice));
  assert.ok(alice);
  await readExternalActivity(container, alice);
  const after = await getPool().query<{ n: string }>('SELECT count(*) AS n FROM object');
  assert.equal(after.rows[0]!.n, before.rows[0]!.n);
});

test.after(async () => {
  await shutdown();
});
