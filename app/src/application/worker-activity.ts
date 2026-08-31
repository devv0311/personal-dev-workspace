// Use case: background execution records for the Routines surface (T3.3.4).
//
// DEVWORKSPACE has no cron scheduler, and this milestone does not invent one.
// The reference's Routines panel therefore cannot show a fire time, a schedule
// or a next run — because none exists. What DOES exist is the outbox worker
// (P2.6 §13): a real process that polls on a real interval, claims events,
// runs a registered consumer and records the outcome on the row.
//
// So the panel is populated from those records and from nothing else. Each row
// names a real event type, the real consumer registered for it, the real object
// it concerned, its real state and its real timestamp. Where the model has no
// answer — an event type with no consumer, a queue that has never been drained
// — the answer returned is the absence, not a placeholder.
//
// One thing this deliberately does NOT report: whether a worker process is
// alive. Nothing in the datastore observes that. `pending` means "not yet
// delivered", which is a fact about a row; turning it into "the worker is down"
// would be a claim the data does not support.

import type {
  WorkerTelemetryRepository,
  WorkerRunRecord,
} from '../ports/repositories.ts';
import type { ResolvedScope } from '../domain/visibility.ts';
import { consumerFor } from '../worker/registry.ts';

export interface WorkerActivityDeps {
  workerTelemetry: WorkerTelemetryRepository;
}

export interface RoutineRun {
  readonly id: string;
  /** The registered consumer, or null when no consumer handles this type. */
  readonly routine: string | null;
  /** The real outbox event type. */
  readonly event: string;
  readonly objectId: string | null;
  readonly objectTitle: string | null;
  readonly state: WorkerRunRecord['state'];
  readonly at: string;
  readonly attempts: number;
}

export interface WorkerActivityView {
  /**
   * What actually runs. Named so no reader mistakes it for a scheduler: it is
   * event-driven, not time-driven, and the UI says exactly that.
   */
  readonly engine: 'outbox-worker';
  readonly scheduled: false;
  /** The worker's real poll interval, from configuration. */
  readonly pollIntervalMs: number;
  readonly delivered: number;
  readonly pending: number;
  readonly deadLettered: number;
  readonly lastDeliveredAt: string | null;
  readonly runs: readonly RoutineRun[];
}

export async function readWorkerActivity(
  deps: WorkerActivityDeps,
  scope: ResolvedScope,
  pollIntervalMs: number,
  limit?: number,
): Promise<WorkerActivityView> {
  const t = await deps.workerTelemetry.read(scope, limit);
  return {
    engine: 'outbox-worker',
    scheduled: false,
    pollIntervalMs,
    delivered: t.delivered,
    pending: t.pending,
    deadLettered: t.deadLettered,
    lastDeliveredAt: t.lastDeliveredAt,
    runs: t.runs.map((r) => ({
      id: r.id,
      routine: consumerFor(r.type),
      event: r.type,
      objectId: r.objectId,
      objectTitle: r.objectTitle,
      state: r.state,
      at: r.at,
      attempts: r.attempts,
    })),
  };
}
