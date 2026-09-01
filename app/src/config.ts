// Configuration / environment handling (P2.7 §3).
// Reads a .env file if present (no dependency — a tiny parser), then process.env.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = join(here, '..');

function loadDotEnv(): void {
  try {
    const raw = readFileSync(join(appRoot, '.env'), 'utf8');
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      const value = trimmed.slice(eq + 1).trim();
      if (!(key in process.env)) process.env[key] = value;
    }
  } catch {
    // no .env file — rely on the environment
  }
}

loadDotEnv();

const isTest = process.env.NODE_ENV === 'test';
const port = Number(process.env.PORT ?? 4177);
const env = (key: string): string | null => {
  const v = process.env[key];
  return v && v.trim() ? v.trim() : null;
};

export const config = {
  appRoot,
  port,
  databaseUrl: isTest
    ? (process.env.TEST_DATABASE_URL ?? 'postgres://localhost:5432/devworkspace_test')
    : (process.env.DATABASE_URL ?? 'postgres://localhost:5432/devworkspace'),
  workerPollIntervalMs: Number(process.env.WORKER_POLL_INTERVAL_MS ?? 1000),
  devAuthEnabled: (process.env.DEV_AUTH_ENABLED ?? 'true') === 'true',

  // --- P3.4 AI layer -------------------------------------------------------
  // The Context API service token authenticates the CALLER (the assistant
  // service). It never conveys a user identity — the end user's own credential
  // is forwarded separately and validated by the core (P2.6 §14.1, INV-4a).
  contextApiServiceToken: process.env.CONTEXT_API_SERVICE_TOKEN ?? 'dev-assistant-service-token',
  assistantPort: Number(process.env.ASSISTANT_PORT ?? 4178),
  /** Where the assistant reaches the core's Context API (its ONLY data path). */
  coreContextApiUrl: process.env.CORE_CONTEXT_API_URL ?? 'http://127.0.0.1:4177',
  /** Browser origin allowed to call the assistant in dev. */
  assistantAllowedOrigin: process.env.ASSISTANT_ALLOWED_ORIGIN ?? 'http://localhost:4177',

  // --- T3.3 external activity (GitHub) -------------------------------------
  // The repository whose activity this workspace tracks. Naming a repository is
  // configuration; the ACTIVITY is always read live from the source and is
  // never hardcoded, seeded or replayed from a fixture.
  githubRepository: process.env.GITHUB_REPOSITORY ?? 'devv0311/personal-dev-workspace',
  /**
   * Optional credential. Absent is a supported mode, not a broken one: a public
   * repository reads anonymously at a lower rate limit, and the UI states which
   * mode is in use. The token is read here, used only by the server-side
   * adapter, and never included in any response.
   */
  githubToken: process.env.GITHUB_TOKEN ?? null,
  /** How long a successful snapshot is reused before the source is re-read. */
  githubCacheTtlMs: Number(process.env.GITHUB_CACHE_TTL_MS ?? 300_000),

  // --- T3.3-CORRECTION: per-user mail accounts -----------------------------
  //
  // Every value here is server-side only. No client id, no client secret and no
  // token ever appears in a response or reaches the browser — the browser only
  // ever receives the PROVIDER's own consent URL, which is public by design.
  //
  // There is deliberately NO default for the token key. A deployment without
  // one cannot store a mail credential, so it must not offer to connect a
  // mailbox; the settings surface says exactly that instead of failing after
  // the user has already given consent at the provider.
  /** 32 bytes, hex- or base64-encoded. Seals stored mail credentials at rest. */
  mailTokenKey: env('MAIL_TOKEN_KEY'),
  /** Public origin the provider redirects back to after consent. */
  mailRedirectBase: env('MAIL_OAUTH_REDIRECT_BASE') ?? `http://localhost:${port}`,
  mailGoogle: {
    clientId: env('MAIL_GOOGLE_CLIENT_ID'),
    clientSecret: env('MAIL_GOOGLE_CLIENT_SECRET'),
  },
  mailMicrosoft: {
    clientId: env('MAIL_MICROSOFT_CLIENT_ID'),
    clientSecret: env('MAIL_MICROSOFT_CLIENT_SECRET'),
  },
} as const;
