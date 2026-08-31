// GitHub adapter for the ExternalActivityProvider port (T3.3.1).
//
// The ONLY place a GitHub URL, header or payload shape appears. It reads the
// public REST API and normalises what comes back into `ExternalEntity`; it does
// not write, does not create DEVWORKSPACE objects, and holds no datastore
// credential.
//
// Honesty rules this adapter implements, not merely documents:
//
//   • Every value rendered downstream is copied from a response field. Where a
//     field is absent the normaliser emits `null` and the UI renders the
//     absence — nothing is defaulted into existence.
//   • Each section is fetched and failed INDEPENDENTLY. A rate-limited commits
//     call must not turn a healthy branch list into "no branches".
//   • A count is reported as a number only when it is EXACT. GitHub paginates
//     without a total, so `exactTotal` returns a number only when the response
//     is provably the last page; otherwise the total is `null` and the UI says
//     "showing N" rather than claiming N is all there is.
//   • `open_issues_count` from the repository payload counts issues AND pull
//     requests. It is carried under a name that says so, so no surface can
//     print it as an issue count.
//   • A cached snapshot keeps the `fetchedAt` of the read that produced it. A
//     failed refetch marks the snapshot `stale` rather than advancing its age.

import type {
  ExternalEntity,
  ExternalKind,
  ExternalSection,
  ExternalSnapshot,
} from '../../domain/external.ts';
import { sourceRef } from '../../domain/external.ts';
import type {
  ExternalActivityProvider,
  ExternalSourceDescriptor,
} from '../../ports/external-activity.ts';

const API = 'https://api.github.com';
const UA = 'devworkspace-context-os';

export interface GitHubProviderOptions {
  /** `owner/repo`. Empty ⇒ the provider reports itself unconfigured. */
  readonly repository: string;
  /** Optional token. Raises the rate limit; never leaves the server. */
  readonly token?: string | null;
  /** How long a successful snapshot may be reused before a refetch. */
  readonly cacheTtlMs?: number;
  /** Per-request timeout. */
  readonly timeoutMs?: number;
  /** How many rows to pull for the paged, time-ordered sections. */
  readonly pageSize?: number;
  /** Injected for tests. Defaults to global fetch. */
  readonly fetchImpl?: typeof fetch;
  /** Injected for tests, so `fetchedAt` is assertable. */
  readonly now?: () => Date;
}

/* --------------------------------------------------------------- helpers -- */

const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** First line of a commit message — the subject GitHub itself displays. */
function subject(message: unknown): string {
  const text = typeof message === 'string' ? message : '';
  const line = text.split('\n', 1)[0] ?? '';
  return line.trim();
}

/**
 * An EXACT total, or null.
 *
 * GitHub returns no count with a collection. A response carrying no `rel="next"`
 * link is provably the last (here: only) page, so the array length is the whole
 * set. Anything else is unknown, and unknown is reported as unknown.
 */
function exactTotal(res: { headers: Headers }, length: number): number | null {
  const link = res.headers.get('link');
  if (link && /rel="next"/.test(link)) return null;
  return length;
}

/** A human-actionable reason, derived from what the response actually said. */
function describeFailure(res: Response, body: unknown): string {
  const message = str((body as { message?: unknown } | null)?.message);
  if (res.status === 401) return 'GitHub rejected the configured credential.';
  if (res.status === 404) {
    return 'Repository not found, or not visible to the configured credential.';
  }
  if (res.status === 403 || res.status === 429) {
    const remaining = res.headers.get('x-ratelimit-remaining');
    const reset = res.headers.get('x-ratelimit-reset');
    if (remaining === '0' && reset) {
      const at = new Date(Number(reset) * 1000);
      const when = Number.isNaN(at.getTime()) ? 'shortly' : at.toISOString();
      return `GitHub rate limit reached. Resets at ${when}.`;
    }
    return message ? `GitHub refused the request: ${message}` : 'GitHub refused the request.';
  }
  return message ? `GitHub error ${res.status}: ${message}` : `GitHub error ${res.status}.`;
}

/* -------------------------------------------------------------- normalise -- */
//
// One function per entity kind. Each reads named fields and nothing else, so a
// field GitHub stops sending becomes a null the UI renders as absent, rather
// than an exception or an invented value.

type Row = Record<string, unknown>;
const obj = (v: unknown): Row => (v && typeof v === 'object' ? (v as Row) : {});

function repositoryEntity(r: Row): ExternalEntity {
  const fullName = str(r['full_name']) ?? '';
  return {
    ref: sourceRef('github', 'repository', fullName),
    source: 'github',
    kind: 'repository',
    externalId: fullName,
    title: fullName,
    actor: str(obj(r['owner'])['login']),
    at: str(r['pushed_at']),
    state: str(r['visibility']),
    url: str(r['html_url']),
    detail: {
      description: str(r['description']),
      defaultBranch: str(r['default_branch']),
      language: str(r['language']),
      // GitHub's open_issues_count includes pull requests. Named so.
      openIssuesAndPullRequests: num(r['open_issues_count']),
      forks: num(r['forks_count']),
      stargazers: num(r['stargazers_count']),
      sizeKb: num(r['size']),
      createdAt: str(r['created_at']),
      updatedAt: str(r['updated_at']),
      archived: typeof r['archived'] === 'boolean' ? (r['archived'] as boolean) : null,
    },
  };
}

function contributorEntity(r: Row): ExternalEntity {
  const login = str(r['login']) ?? String(r['id'] ?? '');
  return {
    ref: sourceRef('github', 'contributor', login),
    source: 'github',
    kind: 'contributor',
    externalId: login,
    title: login,
    actor: login,
    at: null, // the contributors endpoint reports no timestamp
    state: str(r['type']),
    url: str(r['html_url']),
    detail: { contributions: num(r['contributions']) },
  };
}

function commitEntity(r: Row): ExternalEntity {
  const sha = str(r['sha']) ?? '';
  const commit = obj(r['commit']);
  const commitAuthor = obj(commit['author']);
  return {
    ref: sourceRef('github', 'commit', sha),
    source: 'github',
    kind: 'commit',
    externalId: sha,
    title: subject(commit['message']),
    // The GitHub account when the commit is attributed to one, otherwise the
    // name in the commit itself. Never both invented.
    actor: str(obj(r['author'])['login']) ?? str(commitAuthor['name']),
    at: str(commitAuthor['date']),
    state: null, // a commit has no state
    url: str(r['html_url']),
    detail: {
      shortSha: sha.slice(0, 7),
      committedBy: str(obj(commit['committer'])['name']),
    },
  };
}

function branchEntity(r: Row): ExternalEntity {
  const name = str(r['name']) ?? '';
  return {
    ref: sourceRef('github', 'branch', name),
    source: 'github',
    kind: 'branch',
    externalId: name,
    title: name,
    actor: null,
    at: null, // the branch list carries no timestamp
    state: null,
    url: null,
    detail: {
      headSha: str(obj(r['commit'])['sha'])?.slice(0, 7) ?? null,
      protected: typeof r['protected'] === 'boolean' ? (r['protected'] as boolean) : null,
    },
  };
}

function pullRequestEntity(r: Row): ExternalEntity {
  const number = num(r['number']);
  const mergedAt = str(r['merged_at']);
  return {
    ref: sourceRef('github', 'pull_request', String(number ?? '')),
    source: 'github',
    kind: 'pull_request',
    externalId: String(number ?? ''),
    title: str(r['title']) ?? '',
    actor: str(obj(r['user'])['login']),
    // The most recent thing that actually happened to it.
    at: mergedAt ?? str(r['closed_at']) ?? str(r['updated_at']) ?? str(r['created_at']),
    // GitHub reports a merged PR as `closed`; `merged` is the truthful word.
    state: mergedAt ? 'merged' : str(r['state']),
    url: str(r['html_url']),
    detail: {
      number,
      head: str(obj(r['head'])['ref']),
      base: str(obj(r['base'])['ref']),
      draft: typeof r['draft'] === 'boolean' ? (r['draft'] as boolean) : null,
      createdAt: str(r['created_at']),
      mergedAt,
    },
  };
}

function issueEntity(r: Row): ExternalEntity {
  const number = num(r['number']);
  return {
    ref: sourceRef('github', 'issue', String(number ?? '')),
    source: 'github',
    kind: 'issue',
    externalId: String(number ?? ''),
    title: str(r['title']) ?? '',
    actor: str(obj(r['user'])['login']),
    at: str(r['closed_at']) ?? str(r['updated_at']) ?? str(r['created_at']),
    state: str(r['state']),
    url: str(r['html_url']),
    detail: {
      number,
      comments: num(r['comments']),
      createdAt: str(r['created_at']),
    },
  };
}

function workflowRunEntity(r: Row): ExternalEntity {
  const id = num(r['id']);
  return {
    ref: sourceRef('github', 'workflow_run', String(id ?? '')),
    source: 'github',
    kind: 'workflow_run',
    externalId: String(id ?? ''),
    title: str(r['name']) ?? str(r['display_title']) ?? '',
    actor: str(obj(r['actor'])['login']),
    at: str(r['updated_at']) ?? str(r['created_at']),
    // A finished run has a conclusion; a live one only has a status. Report
    // whichever the run actually has, never a guess at the other.
    state: str(r['conclusion']) ?? str(r['status']),
    url: str(r['html_url']),
    detail: {
      runNumber: num(r['run_number']),
      branch: str(r['head_branch']),
      event: str(r['event']),
      status: str(r['status']),
      conclusion: str(r['conclusion']),
    },
  };
}

/**
 * `/issues` returns pull requests too — every PR is an issue in GitHub's model.
 * Counting them as issues would inflate an issue count with work items that are
 * already listed as pull requests, so they are dropped here.
 */
const isPullRequest = (r: Row): boolean => r['pull_request'] != null;

/* --------------------------------------------------------------- provider -- */

export function makeGitHubActivityProvider(
  options: GitHubProviderOptions,
): ExternalActivityProvider {
  const repository = options.repository.trim();
  const token = options.token?.trim() || null;
  const ttl = options.cacheTtlMs ?? 300_000;
  const timeoutMs = options.timeoutMs ?? 8_000;
  const pageSize = Math.min(100, Math.max(1, options.pageSize ?? 30));
  const doFetch = options.fetchImpl ?? fetch;
  const now = options.now ?? (() => new Date());

  const descriptor: ExternalSourceDescriptor = {
    source: 'github',
    repository,
    configured: repository.length > 0 && repository.includes('/'),
    authenticated: token !== null,
  };

  let cached: ExternalSnapshot | null = null;
  let cachedAtMs = 0;
  let inFlight: Promise<ExternalSnapshot> | null = null;

  async function get(path: string): Promise<{ ok: true; body: unknown; res: Response } | { ok: false; error: string }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await doFetch(`${API}${path}`, {
        headers: {
          accept: 'application/vnd.github+json',
          'x-github-api-version': '2022-11-28',
          'user-agent': UA,
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        signal: controller.signal,
      });
      const text = await res.text();
      let body: unknown = null;
      try {
        body = text ? JSON.parse(text) : null;
      } catch {
        body = null;
      }
      if (!res.ok) return { ok: false, error: describeFailure(res, body) };
      return { ok: true, body, res };
    } catch (err) {
      const reason = (err as Error)?.name === 'AbortError'
        ? `GitHub did not respond within ${timeoutMs} ms.`
        : `GitHub is unreachable: ${(err as Error)?.message ?? 'network error'}`;
      return { ok: false, error: reason };
    } finally {
      clearTimeout(timer);
    }
  }

  /** One collection section. Failure is returned, never thrown. */
  async function collection(
    kind: ExternalKind,
    path: string,
    normalise: (r: Row) => ExternalEntity,
    keep: (r: Row) => boolean = () => true,
  ): Promise<ExternalSection> {
    const got = await get(path);
    if (!got.ok) return { ok: false, kind, error: got.error };
    if (!Array.isArray(got.body)) {
      return { ok: false, kind, error: 'GitHub returned an unexpected payload shape.' };
    }
    const rows = (got.body as unknown[]).map(obj).filter(keep);
    const total = exactTotal(got.res, rows.length);
    return { ok: true, kind, entities: rows.map(normalise), total };
  }

  async function fetchSnapshot(): Promise<ExternalSnapshot> {
    const at = now().toISOString();

    if (!descriptor.configured) {
      const error = 'No GitHub repository is configured for this workspace.';
      const kinds: ExternalKind[] = [
        'repository', 'contributor', 'commit', 'branch', 'pull_request', 'issue', 'workflow_run',
      ];
      return {
        source: 'github',
        repository,
        authMode: token ? 'authenticated' : 'anonymous',
        fetchedAt: at,
        stale: false,
        staleReason: null,
        sections: Object.fromEntries(
          kinds.map((k) => [k, { ok: false, kind: k, error } as ExternalSection]),
        ),
      };
    }

    const base = `/repos/${repository}`;
    const q = `per_page=${pageSize}`;

    // Independent sections, in parallel. One failure never poisons another.
    const [repo, contributors, commits, branches, pulls, issues, runs] = await Promise.all([
      (async (): Promise<ExternalSection> => {
        const got = await get(base);
        if (!got.ok) return { ok: false, kind: 'repository', error: got.error };
        return { ok: true, kind: 'repository', entities: [repositoryEntity(obj(got.body))], total: 1 };
      })(),
      collection('contributor', `${base}/contributors?per_page=100`, contributorEntity),
      collection('commit', `${base}/commits?${q}`, commitEntity),
      collection('branch', `${base}/branches?per_page=100`, branchEntity),
      collection('pull_request', `${base}/pulls?state=all&sort=updated&direction=desc&per_page=100`, pullRequestEntity),
      collection('issue', `${base}/issues?state=all&sort=updated&direction=desc&per_page=100`, issueEntity, (r) => !isPullRequest(r)),
      (async (): Promise<ExternalSection> => {
        const got = await get(`${base}/actions/runs?${q}`);
        if (!got.ok) return { ok: false, kind: 'workflow_run', error: got.error };
        const body = obj(got.body);
        const list = Array.isArray(body['workflow_runs']) ? (body['workflow_runs'] as unknown[]) : [];
        // This endpoint DOES report a real total. Use it rather than the page.
        return {
          ok: true,
          kind: 'workflow_run',
          entities: list.map(obj).map(workflowRunEntity),
          total: num(body['total_count']),
        };
      })(),
    ]);

    return {
      source: 'github',
      repository,
      authMode: token ? 'authenticated' : 'anonymous',
      fetchedAt: at,
      stale: false,
      staleReason: null,
      sections: {
        repository: repo,
        contributor: contributors,
        commit: commits,
        branch: branches,
        pull_request: pulls,
        issue: issues,
        workflow_run: runs,
      },
    };
  }

  /** True when every section failed — i.e. nothing at all was readable. */
  const totallyUnavailable = (s: ExternalSnapshot): boolean =>
    Object.values(s.sections).every((sec) => !sec.ok);

  return {
    describe: () => descriptor,

    async snapshot(): Promise<ExternalSnapshot> {
      const fresh = cached !== null && now().getTime() - cachedAtMs < ttl;
      if (fresh && cached) return cached;
      // Collapse concurrent callers onto one network read.
      if (inFlight) return inFlight;

      inFlight = (async () => {
        try {
          const next = await fetchSnapshot();
          // A read where nothing was reachable must not overwrite a good
          // snapshot: serving the older data, explicitly marked stale, is more
          // useful and more honest than replacing it with seven errors.
          if (totallyUnavailable(next) && cached) {
            const reason =
              Object.values(next.sections).find((s) => !s.ok)?.error ??
              'GitHub was unreachable.';
            const stale: ExternalSnapshot = { ...cached, stale: true, staleReason: reason };
            cached = stale;
            return stale;
          }
          cached = next;
          cachedAtMs = now().getTime();
          return next;
        } finally {
          inFlight = null;
        }
      })();

      return inFlight;
    },
  };
}
