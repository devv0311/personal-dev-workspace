// Worker process (P2.6 §13). Same codebase, separate entrypoint.
// Drains the transactional outbox with FOR UPDATE SKIP LOCKED, at-least-once,
// state-based idempotent consumers. One instance is sufficient for this slice;
// SKIP LOCKED keeps N instances safe.

import { getPool, closePool, db } from '../adapters/persistence/db.ts';
import { config } from '../config.ts';
import { CONSUMES, handleObjectChange } from './consumers/fts-maintenance.ts';

const MAX_ATTEMPTS = 5;
const BATCH = 20;

export interface DrainResult {
  processed: number;
  deadLettered: number;
}

/** Process one batch of undelivered outbox events. Returns counts. */
export async function drainOnce(): Promise<DrainResult> {
  const client = await getPool().connect();
  let processed = 0;
  let deadLettered = 0;
  try {
    await client.query('BEGIN');
    const { rows } = await client.query<{
      id: string;
      type: string;
      payload: Record<string, unknown>;
      attempts: number;
    }>(
      `SELECT id, type, payload, attempts
         FROM outbox_event
        WHERE delivered_at IS NULL AND dead_lettered = false
        ORDER BY created_at ASC
        FOR UPDATE SKIP LOCKED
        LIMIT $1`,
      [BATCH],
    );

    for (const evt of rows) {
      try {
        if (CONSUMES.has(evt.type)) {
          await handleObjectChange(
            { query: (t, p) => client.query(t, p as unknown[] | undefined) as never },
            evt.payload as { objectId?: string },
          );
        }
        await client.query(
          `UPDATE outbox_event SET delivered_at = now(), attempts = attempts + 1 WHERE id = $1`,
          [evt.id],
        );
        processed++;
      } catch (err) {
        const attempts = evt.attempts + 1;
        const dead = attempts >= MAX_ATTEMPTS;
        await client.query(
          `UPDATE outbox_event SET attempts = $2, dead_lettered = $3 WHERE id = $1`,
          [evt.id, attempts, dead],
        );
        if (dead) deadLettered++;
        console.error(
          `[worker] event ${evt.id} (${evt.type}) failed attempt ${attempts}` +
            (dead ? ' — dead-lettered' : ''),
          (err as Error).message,
        );
      }
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  return { processed, deadLettered };
}

async function loop(): Promise<void> {
  console.log(
    `worker started (poll ${config.workerPollIntervalMs}ms, db: ${config.databaseUrl})`,
  );
  let stopping = false;
  const stop = () => {
    stopping = true;
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);

  while (!stopping) {
    try {
      const { processed, deadLettered } = await drainOnce();
      if (processed || deadLettered) {
        console.log(`[worker] processed ${processed}, dead-lettered ${deadLettered}`);
      }
    } catch (err) {
      console.error('[worker] drain error', (err as Error).message);
    }
    await new Promise((r) => setTimeout(r, config.workerPollIntervalMs));
  }
  await closePool();
  console.log('worker stopped');
}

// keep `db` referenced so the shared pool module is initialised the same way
void db;

if (import.meta.main) {
  loop().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
