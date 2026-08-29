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

export const config = {
  appRoot,
  port: Number(process.env.PORT ?? 4177),
  databaseUrl: isTest
    ? (process.env.TEST_DATABASE_URL ?? 'postgres://localhost:5432/devworkspace_test')
    : (process.env.DATABASE_URL ?? 'postgres://localhost:5432/devworkspace'),
  workerPollIntervalMs: Number(process.env.WORKER_POLL_INTERVAL_MS ?? 1000),
  devAuthEnabled: (process.env.DEV_AUTH_ENABLED ?? 'true') === 'true',
} as const;
