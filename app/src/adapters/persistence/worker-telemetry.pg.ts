// WorkerTelemetryRepository — PostgreSQL, read-only (T3.3.4).
//
// The Routines surface used to be an empty reference shell because DEVWORKSPACE
// has no cron scheduler. It still has none, and none is invented here. What it
// does have is the outbox worker (P2.6 §13): a real background process that
// polls, claims events with `FOR UPDATE SKIP LOCKED`, runs a consumer, and
// writes the outcome back onto the row — `delivered_at`, `attempts`,
// `dead_lettered`. Those are genuine execution records with genuine timestamps,
// and they are what this read returns.
//
// Two properties this file is responsible for:
//
//  1. NOTHING IS INFERRED ABOUT A LIVE PROCESS. A row's state is read from its
//     own columns. "Pending" means the row has not been delivered — it is not a
//     claim that a worker is running, or that it is not. The surface reports
//     queue state, which is a fact, instead of process liveness, which this
//     read cannot observe.
//
//  2. THE AUTHORIZATION BOUNDARY HOLDS. An outbox row names an object id. Left
//     unscoped, a bare count would tell a member with no shares exactly how
//     much activity another member's invisible objects produced. So every row
//     is joined to its object and filtered through the same VisibilityPolicy
//     fragment as every other read (INV-3); events whose object is invisible,
//     absent, or unnamed are not counted and not listed.

import type {
  UnitOfWork,
  WorkerRunRecord,
  WorkerTelemetry,
  WorkerTelemetryRepository,
} from '../../ports/repositories.ts';
import { objectSqlFragment, type ResolvedScope } from '../../domain/visibility.ts';

const DEFAULT_LIMIT = 12;
const MAX_LIMIT = 200;

interface RunRow {
  id: string;
  type: string;
  object_id: string | null;
  object_title: string | null;
  delivered_at: string | null;
  dead_lettered: boolean;
  created_at: string;
  attempts: number;
}

interface CountRow {
  delivered: string;
  pending: string;
  dead_lettered: string;
  last_delivered_at: string | null;
}

const stateOf = (r: RunRow): WorkerRunRecord['state'] =>
  r.dead_lettered ? 'dead_lettered' : r.delivered_at ? 'delivered' : 'pending';

export function makeWorkerTelemetryRepository(uow: UnitOfWork): WorkerTelemetryRepository {
  return {
    async read(scope: ResolvedScope, limit = DEFAULT_LIMIT): Promise<WorkerTelemetry> {
      const cap = Math.min(Math.max(Math.trunc(limit) || DEFAULT_LIMIT, 1), MAX_LIMIT);

      // The visibility fragment is applied to the JOINED object, so an event is
      // only ever visible through an object the caller may already see.
      const vis = objectSqlFragment(scope, 'o', 1);
      // `payload->>'objectId'` is the identifier the outbox carries (INV-13:
      // identifiers and change kind only, never denormalised content), so the
      // title below is read live from the authoritative row, not from the event.
      const joined = `
        FROM outbox_event e
        JOIN object o ON o.id = (e.payload->>'objectId')::uuid
       WHERE e.workspace_id = o.workspace_id AND ${vis.text}`;

      const counts = await uow.query<CountRow>(
        `SELECT
           count(*) FILTER (WHERE e.delivered_at IS NOT NULL)                        AS delivered,
           count(*) FILTER (WHERE e.delivered_at IS NULL AND e.dead_lettered = false) AS pending,
           count(*) FILTER (WHERE e.dead_lettered = true)                            AS dead_lettered,
           max(e.delivered_at)                                                        AS last_delivered_at
         ${joined}`,
        [...vis.params],
      );

      const runs = await uow.query<RunRow>(
        `SELECT e.id::text AS id, e.type, o.id::text AS object_id, o.title AS object_title,
                e.delivered_at, e.dead_lettered, e.created_at, e.attempts
         ${joined}
         ORDER BY coalesce(e.delivered_at, e.created_at) DESC, e.id DESC
         LIMIT $${vis.params.length + 1}`,
        [...vis.params, cap],
      );

      const c = counts.rows[0];
      return {
        delivered: Number(c?.delivered ?? 0),
        pending: Number(c?.pending ?? 0),
        deadLettered: Number(c?.dead_lettered ?? 0),
        lastDeliveredAt: c?.last_delivered_at
          ? new Date(c.last_delivered_at).toISOString()
          : null,
        runs: runs.rows.map((r) => ({
          id: r.id,
          type: r.type,
          objectId: r.object_id,
          objectTitle: r.object_title,
          state: stateOf(r),
          at: new Date(r.delivered_at ?? r.created_at).toISOString(),
          attempts: Number(r.attempts ?? 0),
        })),
      };
    },
  };
}
