// Attention Stack / Inbound Queue domain (T3.3-CORRECTION). Pure.
//
// One triage surface for inbound work, fed by MANY sources. The right rail used
// to be a dead `EMAIL — NOT CONNECTED` placeholder; e-mail is now one source
// among several rather than the surface itself:
//
//   mail accounts ─┐
//   GitHub ────────┼─▶ normalised InboundItem ─▶ Attention Stack
//   CI ────────────┘
//
// Two invariants the whole surface rests on:
//
//   1. A SOURCE STATES ITS OWN CONDITION. `connected`, `unavailable`,
//      `not_configured` and `not_connected` are four different things and the
//      UI must be able to tell them apart. An unreadable source contributes no
//      items and says why — it never degrades into "nothing needs you".
//   2. A COUNT IS ONLY PRINTED WHEN IT IS EXACT. A category pill counts the
//      items actually in hand from sources that returned a complete answer. A
//      source that returned a partial page contributes items but no count.

export const INBOUND_CATEGORIES = [
  'pull_request', // a pull request waiting on a human
  'ci_failure', // a workflow run that did not succeed
  'issue', // an open issue
  'message', // an e-mail from a connected account
] as const;
export type InboundCategory = (typeof INBOUND_CATEGORIES)[number];

export const INBOUND_CATEGORY_LABEL: Readonly<Record<InboundCategory, string>> = {
  pull_request: 'PRs',
  ci_failure: 'Alerts',
  issue: 'Issues',
  message: 'Messages',
};

/** Where an item came from. A source id, never a mailbox address. */
export type InboundSourceId = 'github' | 'mail';

/**
 * The condition of one source, in the source's own terms.
 *
 *   connected      — read successfully; its items are present.
 *   not_configured — this deployment has not been given the source at all.
 *   not_connected  — configured, but this USER has connected nothing to it.
 *   unavailable    — configured and connected, but the read failed. `reason`
 *                    carries the source's own words.
 */
export type InboundSourceState =
  | 'connected'
  | 'not_configured'
  | 'not_connected'
  | 'unavailable';

export interface InboundSourceStatus {
  readonly source: InboundSourceId;
  readonly label: string;
  readonly state: InboundSourceState;
  /** Why, in words a user can act on. Present for every non-connected state. */
  readonly detail: string | null;
  /** How many accounts of this source this user has connected, when it has any. */
  readonly accounts: number | null;
}

/** One normalised thing wanting attention. */
export interface InboundItem {
  /** Stable reference — `github:pull_request:18`, `mail:google:<acct>:<id>`. */
  readonly id: string;
  readonly source: InboundSourceId;
  readonly category: InboundCategory;
  readonly title: string;
  /** The one line of context under the title. Real fields only, or null. */
  readonly subtitle: string | null;
  /** ISO instant, or null when the source reported none. */
  readonly at: string | null;
  readonly url: string | null;
  /** The source's own state word. */
  readonly state: string | null;
  /**
   * WHICH ACCOUNT produced this item, when it came from one — the address a
   * user connected. Present only for mail; null for everything else, so a
   * repository event is never attributed to a mailbox.
   */
  readonly sourceAccount: string | null;
}

export interface InboundCategoryCount {
  readonly category: InboundCategory;
  readonly label: string;
  /** Exact, or null when a contributing source could not prove its total. */
  readonly count: number | null;
}

/** Newest first; items with no timestamp sort last rather than being dropped. */
export function orderInbound(items: readonly InboundItem[]): InboundItem[] {
  return [...items].sort((a, b) => {
    if (a.at && b.at) return String(b.at).localeCompare(String(a.at)) || a.id.localeCompare(b.id);
    if (a.at) return -1;
    if (b.at) return 1;
    return a.id.localeCompare(b.id);
  });
}

/**
 * Category counts over the items in hand.
 *
 * `exact` says whether every source contributing to this category returned a
 * complete answer. When it did not, the count is `null` and the pill renders an
 * absence — the size of the page in hand is not the size of the queue.
 */
export function countInbound(
  items: readonly InboundItem[],
  exact: (category: InboundCategory) => boolean,
): InboundCategoryCount[] {
  const out: InboundCategoryCount[] = [];
  for (const category of INBOUND_CATEGORIES) {
    const n = items.filter((i) => i.category === category).length;
    if (n === 0 && !exact(category)) continue;
    out.push({
      category,
      label: INBOUND_CATEGORY_LABEL[category],
      count: exact(category) ? n : null,
    });
  }
  return out;
}
