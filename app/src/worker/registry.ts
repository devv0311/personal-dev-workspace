// The worker's consumer registration (T3.3.4).
//
// One list, two readers: the worker dispatches on it, and the Routines surface
// names runs from it. Both import the SAME `CONSUMES` set the consumer itself
// declares, so a surface can never attribute a run to a consumer that does not
// handle that event type — the failure mode this file exists to make impossible.

import { CONSUMER_NAME, CONSUMES } from './consumers/fts-maintenance.ts';

export interface ConsumerRegistration {
  readonly name: string;
  readonly consumes: ReadonlySet<string>;
}

export const CONSUMERS: readonly ConsumerRegistration[] = [
  { name: CONSUMER_NAME, consumes: CONSUMES },
];

/**
 * The consumer that handles `type`, or null when none does.
 *
 * Null is a real outcome, not a gap to paper over: the worker marks an
 * unregistered event delivered without running anything, and a surface must say
 * so rather than attributing the delivery to a consumer that never saw it.
 */
export function consumerFor(type: string): string | null {
  return CONSUMERS.find((c) => c.consumes.has(type))?.name ?? null;
}
