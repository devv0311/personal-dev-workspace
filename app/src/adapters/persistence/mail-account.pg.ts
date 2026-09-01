// MailAccountRepository — PostgreSQL (T3.3-CORRECTION).
//
// THE ONE RULE THIS FILE ENFORCES: a mail account is reachable only by the
// principal who connected it.
//
// Every statement below carries `principal_id = $scope.principalId` in its
// WHERE clause — including the credential read, which joins through the account
// so a credential cannot be fetched by id alone. There is deliberately no
// unscoped overload of any method: a workspace-wide mail read is not something
// a caller can ask for, which is what makes "the head's mailbox is not the
// workspace's mailbox" a property of the code rather than a convention.
//
// The second rule: ciphertext never leaves this layer as plaintext and never
// enters an ordinary account read. `mail_account` and `mail_credential` are
// separate tables, and `listForPrincipal` does not touch the second one.

import type { UnitOfWork } from '../../ports/repositories.ts';
import type {
  MailAccountRepository,
  MailOAuthRequestRow,
  NewMailAccount,
  StoredCredential,
} from '../../ports/mail.ts';
import type { MailAccount, MailAccountStatus, MailProviderId } from '../../domain/mail.ts';
import type { ResolvedScope } from '../../domain/visibility.ts';

interface AccountRow {
  id: string;
  principal_id: string;
  provider: string;
  address: string;
  status: string;
  feeds_inbound: boolean;
  last_sync_at: string | null;
  last_error: string | null;
  created_at: string;
}

const ACCOUNT_COLS =
  'id, principal_id, provider, address, status, feeds_inbound, last_sync_at, last_error, created_at';

const toAccount = (r: AccountRow): MailAccount => ({
  id: r.id,
  principalId: r.principal_id,
  provider: r.provider as MailProviderId,
  address: r.address,
  status: r.status as MailAccountStatus,
  feedsInbound: r.feeds_inbound,
  lastSyncAt: r.last_sync_at ? new Date(r.last_sync_at).toISOString() : null,
  lastError: r.last_error,
  createdAt: new Date(r.created_at).toISOString(),
});

export function makeMailAccountRepository(uow: UnitOfWork): MailAccountRepository {
  return {
    async listForPrincipal(scope: ResolvedScope): Promise<MailAccount[]> {
      const { rows } = await uow.query<AccountRow>(
        `SELECT ${ACCOUNT_COLS} FROM mail_account
          WHERE principal_id = $1 AND workspace_id = $2
          ORDER BY created_at ASC, id ASC`,
        [scope.principalId, scope.workspaceId],
      );
      return rows.map(toAccount);
    },

    async findForPrincipal(scope: ResolvedScope, id: string): Promise<MailAccount | null> {
      // A foreign or unknown id resolves to null identically — invisible and
      // absent are indistinguishable, exactly as for objects.
      const { rows } = await uow.query<AccountRow>(
        `SELECT ${ACCOUNT_COLS} FROM mail_account
          WHERE id = $1 AND principal_id = $2 AND workspace_id = $3`,
        [id, scope.principalId, scope.workspaceId],
      );
      return rows[0] ? toAccount(rows[0]) : null;
    },

    async upsert(scope: ResolvedScope, input: NewMailAccount): Promise<MailAccount> {
      const { rows } = await uow.query<AccountRow>(
        `INSERT INTO mail_account (workspace_id, principal_id, provider, address, status)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (principal_id, provider, address)
         DO UPDATE SET status = EXCLUDED.status, updated_at = now()
         RETURNING ${ACCOUNT_COLS}`,
        [scope.workspaceId, scope.principalId, input.provider, input.address, input.status],
      );
      return toAccount(rows[0]!);
    },

    async updateStatus(scope, id, patch): Promise<MailAccount | null> {
      const sets: string[] = ['updated_at = now()'];
      const params: unknown[] = [id, scope.principalId];
      const push = (column: string, value: unknown): void => {
        params.push(value);
        sets.push(`${column} = $${params.length}`);
      };
      if (patch.status !== undefined) push('status', patch.status);
      if (patch.lastSyncAt !== undefined) push('last_sync_at', patch.lastSyncAt);
      if (patch.lastError !== undefined) push('last_error', patch.lastError);
      if (patch.feedsInbound !== undefined) push('feeds_inbound', patch.feedsInbound);

      const { rows } = await uow.query<AccountRow>(
        `UPDATE mail_account SET ${sets.join(', ')}
          WHERE id = $1 AND principal_id = $2
          RETURNING ${ACCOUNT_COLS}`,
        params,
      );
      return rows[0] ? toAccount(rows[0]) : null;
    },

    async remove(scope: ResolvedScope, id: string): Promise<boolean> {
      // The credential row cascades with the account, so disconnecting really
      // does destroy the stored grant rather than orphaning it.
      const { rows } = await uow.query<{ id: string }>(
        `DELETE FROM mail_account WHERE id = $1 AND principal_id = $2 RETURNING id`,
        [id, scope.principalId],
      );
      return rows.length > 0;
    },

    async saveCredential(scope, accountId, credential): Promise<void> {
      // The INSERT ... SELECT is what scopes the write: it produces no row at
      // all unless the account belongs to this principal.
      await uow.query(
        `INSERT INTO mail_credential (account_id, ciphertext, iv, auth_tag, key_id, access_expires_at)
         SELECT a.id, $3, $4, $5, $6, $7
           FROM mail_account a
          WHERE a.id = $1 AND a.principal_id = $2
         ON CONFLICT (account_id) DO UPDATE
           SET ciphertext = EXCLUDED.ciphertext,
               iv = EXCLUDED.iv,
               auth_tag = EXCLUDED.auth_tag,
               key_id = EXCLUDED.key_id,
               access_expires_at = EXCLUDED.access_expires_at,
               updated_at = now()`,
        [
          accountId,
          scope.principalId,
          credential.sealed.ciphertext,
          credential.sealed.iv,
          credential.sealed.authTag,
          credential.sealed.keyId,
          credential.accessExpiresAt,
        ],
      );
    },

    async readCredential(scope, accountId): Promise<StoredCredential | null> {
      const { rows } = await uow.query<{
        ciphertext: Buffer;
        iv: Buffer;
        auth_tag: Buffer;
        key_id: string;
        access_expires_at: string | null;
      }>(
        `SELECT c.ciphertext, c.iv, c.auth_tag, c.key_id, c.access_expires_at
           FROM mail_credential c
           JOIN mail_account a ON a.id = c.account_id
          WHERE c.account_id = $1 AND a.principal_id = $2`,
        [accountId, scope.principalId],
      );
      const row = rows[0];
      if (!row) return null;
      return {
        sealed: {
          ciphertext: row.ciphertext,
          iv: row.iv,
          authTag: row.auth_tag,
          keyId: row.key_id,
        },
        accessExpiresAt: row.access_expires_at
          ? new Date(row.access_expires_at).toISOString()
          : null,
      };
    },

    async createOAuthRequest(row): Promise<void> {
      await uow.query(
        `INSERT INTO mail_oauth_request
           (state, workspace_id, principal_id, provider, code_verifier, redirect_uri, account_id, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          row.state,
          row.workspaceId,
          row.principalId,
          row.provider,
          row.codeVerifier,
          row.redirectUri,
          row.accountId,
          row.expiresAt,
        ],
      );
    },

    async consumeOAuthRequest(state: string): Promise<MailOAuthRequestRow | null> {
      // Single use, and expiry is enforced in the same statement: an old or
      // replayed `state` returns nothing rather than authorising a second
      // exchange. The row itself is what binds the redirect to a principal —
      // the provider's callback is a top-level browser navigation and carries
      // no credential of ours, so the binding must live server-side.
      const { rows } = await uow.query<{
        state: string;
        workspace_id: string;
        principal_id: string;
        provider: string;
        code_verifier: string;
        redirect_uri: string;
        account_id: string | null;
      }>(
        `DELETE FROM mail_oauth_request
          WHERE state = $1 AND expires_at > now()
        RETURNING state, workspace_id, principal_id, provider, code_verifier, redirect_uri, account_id`,
        [state],
      );
      const row = rows[0];
      if (!row) return null;
      return {
        state: row.state,
        workspaceId: row.workspace_id,
        principalId: row.principal_id,
        provider: row.provider as MailProviderId,
        codeVerifier: row.code_verifier,
        redirectUri: row.redirect_uri,
        accountId: row.account_id,
      };
    },
  };
}
