-- T3.3-CORRECTION — workspace headship, per-user mail accounts, artifact read state.
-- Forward-only. Applied inside a single transaction by the runner.
--
-- Three concerns, each of which the previous schema could not express, and each
-- of which the UI was previously obliged to invent:
--
--   1. WHO HEADS THE WORKSPACE. `workspace_membership.role` already existed but
--      admitted exactly one value, so "the owner of this workspace" was not a
--      fact the model held and the shell had no truthful place to read it from.
--   2. WHOSE MAILBOX. Mail is personal. An account belongs to the principal who
--      connected it — never to the workspace, and never to its head — so the
--      ownership column is `principal_id` and every read is filtered by it.
--   3. WHAT HAS BEEN SEEN. Read/unread on an artifact is per person, so it is
--      keyed by principal and by the artifact's own stable reference.

-- ---------------------------------------------------------------------------
-- 1. Workspace headship (identity correction).
-- ---------------------------------------------------------------------------

ALTER TABLE workspace_membership DROP CONSTRAINT workspace_membership_role_check;
ALTER TABLE workspace_membership
  ADD CONSTRAINT workspace_membership_role_check CHECK (role IN ('owner', 'member'));

-- A workspace has at most one head. Enforced by the schema rather than by a
-- convention a seed could violate.
CREATE UNIQUE INDEX workspace_membership_one_owner
  ON workspace_membership (workspace_id) WHERE role = 'owner';

-- ---------------------------------------------------------------------------
-- 2. Mail accounts — owned by the principal who connected them (INV-3 applies
--    to them exactly as it applies to objects: every read is scoped).
-- ---------------------------------------------------------------------------

CREATE TABLE mail_account (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  -- The OWNER of the mailbox. Workspace ownership is not mailbox ownership:
  -- nothing in this schema lets one principal read another's mail account.
  principal_id  uuid NOT NULL REFERENCES principal(id) ON DELETE CASCADE,
  provider      text NOT NULL,
  -- The address the provider itself reported after consent. Never typed by a
  -- user, so it cannot claim an address the account does not actually hold.
  address       text NOT NULL,
  status        text NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'connected', 'expired', 'revoked', 'error')),
  -- Whether this account feeds the Attention Stack. Per account, per user.
  feeds_inbound boolean NOT NULL DEFAULT true,
  last_sync_at  timestamptz,
  last_error    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (principal_id, provider, address)
);

CREATE INDEX mail_account_principal_idx ON mail_account (principal_id);

-- Credentials live in their own table so an ordinary account read never selects
-- ciphertext at all. Only sealed bytes are stored: the plaintext token exists in
-- this process for the duration of one provider call and is never persisted,
-- never logged, and never present in any HTTP response.
CREATE TABLE mail_credential (
  account_id     uuid PRIMARY KEY REFERENCES mail_account(id) ON DELETE CASCADE,
  ciphertext     bytea NOT NULL,
  iv             bytea NOT NULL,
  auth_tag       bytea NOT NULL,
  -- Fingerprint of the key that sealed this row, so a rotated key is detected
  -- as "cannot decrypt", never silently mis-decrypted.
  key_id         text NOT NULL,
  access_expires_at timestamptz,
  updated_at     timestamptz NOT NULL DEFAULT now()
);

-- An in-flight authorization request. `state` is a high-entropy secret that
-- binds the provider's redirect back to the principal who started it; the PKCE
-- verifier never leaves the server.
CREATE TABLE mail_oauth_request (
  state         text PRIMARY KEY,
  workspace_id  uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  principal_id  uuid NOT NULL REFERENCES principal(id) ON DELETE CASCADE,
  provider      text NOT NULL,
  code_verifier text NOT NULL,
  redirect_uri  text NOT NULL,
  -- Set when this is a RECONNECT of an existing account rather than a new one.
  account_id    uuid REFERENCES mail_account(id) ON DELETE CASCADE,
  created_at    timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL
);

-- ---------------------------------------------------------------------------
-- 3. Artifact read state — per person, keyed by the artifact's stable ref.
-- ---------------------------------------------------------------------------

CREATE TABLE artifact_read (
  principal_id uuid NOT NULL REFERENCES principal(id) ON DELETE CASCADE,
  artifact_ref text NOT NULL,
  read_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (principal_id, artifact_ref)
);
