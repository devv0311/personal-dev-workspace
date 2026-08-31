// Use case: the Attention Stack / Inbound Queue (T3.3-CORRECTION).
//
// The right rail used to be `EMAIL — NOT CONNECTED`: a dead placeholder for one
// mailbox. It is now one triage surface fed by several sources, of which mail
// is one:
//
//   mail accounts (per user) ─┐
//   pull requests ────────────┼─▶ normalised InboundItem ─▶ Attention Stack
//   CI runs ──────────────────┤
//   issues ───────────────────┘
//
// The rules, enforced here rather than asserted in a comment:
//
//   1. MAIL IS PERSONAL. Mail items come only from accounts THIS principal
//      connected, read through the user-scoped repository. The head of the
//      workspace does not thereby appear in anyone else's queue, and a member
//      never sees another member's messages.
//   2. EACH SOURCE STATES ITS OWN CONDITION. `not_configured`, `not_connected`,
//      `unavailable` and `connected` are four different facts. A source that
//      could not be read contributes no items and says why — it never becomes
//      an empty queue that reads as "nothing needs you".
//   3. A COUNT IS EXACT OR ABSENT. A category pill counts only when every
//      source feeding that category returned a provably complete answer.
//   4. AN E-MAIL ITEM KEEPS ITS ACCOUNT. `sourceAccount` is the address that
//      produced it, so a user with three mailboxes can tell which one is
//      asking for them. Nothing else about the message is exposed.

import {
  countInbound,
  orderInbound,
  type InboundCategory,
  type InboundCategoryCount,
  type InboundItem,
  type InboundSourceStatus,
} from '../domain/inbound.ts';
import { mailRef } from '../domain/mail.ts';
import { sectionOf } from '../domain/external.ts';
import type { ExternalActivityProvider } from '../ports/external-activity.ts';
import type { ResolvedScope } from '../domain/visibility.ts';
import {
  feedingAccounts,
  listMailAccounts,
  readAccountInbound,
  type MailDeps,
} from './mail-accounts.ts';

export interface InboundDeps extends MailDeps {
  external: ExternalActivityProvider;
}

export interface InboundQueueView {
  readonly items: readonly InboundItem[];
  readonly sources: readonly InboundSourceStatus[];
  readonly categories: readonly InboundCategoryCount[];
}

/** Per-source page bound. A view bound, never an authorization bound. */
const MAIL_PER_ACCOUNT = 5;

/** A CI run that did not succeed is the only kind that wants attention. */
const CI_NEEDS_ATTENTION = new Set(['failure', 'timed_out', 'cancelled', 'startup_failure']);

export async function readInboundQueue(
  deps: InboundDeps,
  scope: ResolvedScope,
): Promise<InboundQueueView> {
  const items: InboundItem[] = [];
  const sources: InboundSourceStatus[] = [];
  /** Which categories every contributing source answered completely. */
  const exact = new Set<InboundCategory>();

  /* ------------------------------------------------------------- the forge */
  const described = deps.external.describe();
  if (!described.configured) {
    sources.push({
      source: 'github',
      label: 'Repository',
      state: 'not_configured',
      detail: 'No repository is configured for this workspace.',
      accounts: null,
    });
  } else {
    const snapshot = await deps.external.snapshot();
    const failures: string[] = [];

    const prs = sectionOf(snapshot, 'pull_request');
    if (prs.ok) {
      if (prs.total !== null) exact.add('pull_request');
      for (const pr of prs.entities) {
        // Only an OPEN pull request is waiting on a human. A merged one is
        // history, and history does not belong in a triage queue.
        if (pr.state !== 'open') continue;
        items.push({
          id: pr.ref,
          source: 'github',
          category: 'pull_request',
          title: pr.title,
          subtitle: pr.actor ? `${snapshot.repository} · ${pr.actor}` : snapshot.repository,
          at: pr.at,
          url: pr.url,
          state: pr.state,
          sourceAccount: null,
        });
      }
    } else {
      failures.push(prs.error);
    }

    const ci = sectionOf(snapshot, 'workflow_run');
    if (ci.ok) {
      if (ci.total !== null) exact.add('ci_failure');
      for (const run of ci.entities) {
        if (!run.state || !CI_NEEDS_ATTENTION.has(run.state)) continue;
        const branch = run.detail['branch'];
        items.push({
          id: run.ref,
          source: 'github',
          category: 'ci_failure',
          title: run.title || 'workflow run',
          subtitle: typeof branch === 'string' ? branch : snapshot.repository,
          at: run.at,
          url: run.url,
          state: run.state,
          sourceAccount: null,
        });
      }
    } else {
      failures.push(ci.error);
    }

    const issues = sectionOf(snapshot, 'issue');
    if (issues.ok) {
      if (issues.total !== null) exact.add('issue');
      for (const issue of issues.entities) {
        if (issue.state !== 'open') continue;
        items.push({
          id: issue.ref,
          source: 'github',
          category: 'issue',
          title: issue.title,
          subtitle: issue.actor ? `${snapshot.repository} · ${issue.actor}` : snapshot.repository,
          at: issue.at,
          url: issue.url,
          state: issue.state,
          sourceAccount: null,
        });
      }
    } else {
      failures.push(issues.error);
    }

    sources.push({
      source: 'github',
      label: 'Repository',
      state: failures.length === 0 ? 'connected' : 'unavailable',
      detail: failures.length === 0 ? snapshot.repository : failures[0]!,
      accounts: null,
    });
  }

  /* --------------------------------------------------------------- the mail */
  const mail = await listMailAccounts(deps, scope);
  const feeding = feedingAccounts(mail.accounts);
  const anyProviderConfigured = mail.providers.some((p) => p.configured);

  if (mail.accounts.length === 0) {
    sources.push({
      source: 'mail',
      label: 'Mail',
      state: anyProviderConfigured && mail.storage.ok ? 'not_connected' : 'not_configured',
      detail:
        !mail.storage.ok
          ? mail.storage.reason
          : anyProviderConfigured
            ? 'No mail account is connected to your user. Add one in Mail Accounts.'
            : 'No mail provider is configured for this deployment.',
      accounts: 0,
    });
  } else {
    const errors: string[] = [];
    let read = 0;
    for (const account of feeding) {
      const outcome = await readAccountInbound(deps, scope, account, MAIL_PER_ACCOUNT);
      if (outcome.error) {
        errors.push(`${account.address}: ${outcome.error}`);
        continue;
      }
      read += 1;
      for (const message of outcome.messages) {
        items.push({
          id: mailRef(account.provider, account.id, message.externalId),
          source: 'mail',
          category: 'message',
          title: message.subject,
          subtitle: message.from,
          at: message.at,
          url: message.url,
          state: message.unread ? 'unread' : 'read',
          // The account that produced it — the only mailbox detail exposed.
          sourceAccount: account.address,
        });
      }
    }
    // A page of messages is a page, not a mailbox total: `message` is never
    // added to `exact`, so its pill renders an absence rather than a partial.
    sources.push({
      source: 'mail',
      label: 'Mail',
      state: errors.length === 0 ? 'connected' : read > 0 ? 'connected' : 'unavailable',
      detail:
        errors.length === 0
          ? `${feeding.length} account${feeding.length === 1 ? '' : 's'} feeding this queue`
          : errors[0]!,
      accounts: mail.accounts.length,
    });
  }

  const ordered = orderInbound(items);
  return {
    items: ordered,
    sources,
    categories: countInbound(ordered, (c) => exact.has(c)),
  };
}
