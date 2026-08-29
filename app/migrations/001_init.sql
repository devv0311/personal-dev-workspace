-- P2.7 first implementation slice — minimum authoritative schema.
-- Faithful to P2.6 §7 (data model), §8 (relationship model), §9 (authorization),
-- §16 (outbox). Forward-only. Applied inside a single transaction by the runner.
--
-- Scope note: only the entities the Capture → Persist → Associate → Display slice
-- exercises are created here. Later milestones add: suggestions, suppressions,
-- usage signals, ranking weight sets, telemetry, conversation store.

-- ---------------------------------------------------------------------------
-- Tenancy & identity (P2.6 §7.1)
-- ---------------------------------------------------------------------------

CREATE TABLE workspace (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE principal (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  -- Opaque link to whatever authentication provides. The DEV auth boundary
  -- (P2.7 §5) maps a request credential to this value. NOT the final auth model.
  auth_subject text NOT NULL,
  display_name text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, auth_subject)
);

CREATE TABLE workspace_membership (
  workspace_id uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  principal_id uuid NOT NULL REFERENCES principal(id) ON DELETE CASCADE,
  role         text NOT NULL DEFAULT 'member' CHECK (role IN ('member')),
  joined_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, principal_id)
);

-- ---------------------------------------------------------------------------
-- Objects (P2.6 §7.1, §12.1). Projects and Notes are both objects.
-- ---------------------------------------------------------------------------

CREATE TABLE object (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  -- Mutable type (R21). CHECK carries the full P2.1 §2 vocabulary even though
  -- this slice only creates 'project' and 'note'.
  type            text NOT NULL CHECK (type IN
                    ('project','task','note','idea','decision','resource','checkpoint')),
  title           text NOT NULL DEFAULT '',
  body            text NOT NULL DEFAULT '',
  attributes      jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Singular "home context" belongs-to (P2.6 §8.2). NULL ⇒ Inbox.
  home_project_id uuid REFERENCES object(id) ON DELETE SET NULL,
  -- P2.6 review correction: NOT NULL. The visibility predicate's ownership
  -- clause is the only disjunct that can admit an Inbox object.
  owner_id        uuid NOT NULL REFERENCES principal(id) ON DELETE RESTRICT,
  -- Immutable authorship (R8). Never rewritten by sharing/handoff.
  created_by      uuid NOT NULL REFERENCES principal(id) ON DELETE RESTRICT,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX object_workspace_home_idx ON object (workspace_id, home_project_id);
CREATE INDEX object_workspace_owner_idx ON object (workspace_id, owner_id);
CREATE INDEX object_workspace_type_idx  ON object (workspace_id, type);

-- ---------------------------------------------------------------------------
-- Relationships — first-class edges (P2.6 §8, INV-2).
-- Authoritative table stores 'explicit' and 'user_confirmed' only.
-- Structural edges are computed on read (P2.6 §8.3), never stored here.
-- ---------------------------------------------------------------------------

CREATE TABLE relationship (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id      uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  from_object_id    uuid NOT NULL REFERENCES object(id) ON DELETE CASCADE,
  to_object_id      uuid NOT NULL REFERENCES object(id) ON DELETE CASCADE,
  verb              text NOT NULL CHECK (verb IN
                      ('belongs_to','derived_from','explains','caused_by','blocked_by',
                       'next_action_for','follows_from','related_to','references','supersedes')),
  origin            text NOT NULL CHECK (origin IN ('explicit','user_confirmed')),
  confidence_state  text NOT NULL DEFAULT 'known'
                      CHECK (confidence_state IN ('known','user_confirmed','inferred_high','weak')),
  author_id         uuid REFERENCES principal(id) ON DELETE SET NULL,
  -- Relationship-level visibility (R9a). 'private' ⇒ visible only to author.
  visibility_scope  text NOT NULL DEFAULT 'shared' CHECK (visibility_scope IN ('shared','private')),
  provenance_kind   text NOT NULL,
  provenance_detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CHECK (from_object_id <> to_object_id)
);

CREATE INDEX relationship_from_idx ON relationship (from_object_id);
CREATE INDEX relationship_to_idx   ON relationship (to_object_id);

-- "belongs_to" is singular per its home use (P2.6 §8.2): at most one anchor edge
-- per object. (The FK column object.home_project_id is the home form; a real edge
-- row is the anchor form for Task targets — this partial unique guards the latter.)
CREATE UNIQUE INDEX relationship_one_belongs_to_per_object
  ON relationship (from_object_id) WHERE verb = 'belongs_to';

-- ---------------------------------------------------------------------------
-- Sharing — drives visibility. Zero rows ⇒ a fully functional solo system (INV-12).
-- ---------------------------------------------------------------------------

CREATE TABLE project_share (
  workspace_id uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  project_id   uuid NOT NULL REFERENCES object(id) ON DELETE CASCADE,
  principal_id uuid NOT NULL REFERENCES principal(id) ON DELETE CASCADE,
  granted_by   uuid NOT NULL REFERENCES principal(id) ON DELETE RESTRICT,
  granted_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, principal_id)
);

CREATE INDEX project_share_principal_idx ON project_share (principal_id);

-- ---------------------------------------------------------------------------
-- Activity (append-only, R22) & audit (append-only, R15).
-- ---------------------------------------------------------------------------

CREATE TABLE activity (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  object_id    uuid NOT NULL REFERENCES object(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  kind         text NOT NULL,
  actor_id     uuid NOT NULL REFERENCES principal(id) ON DELETE RESTRICT,
  at           timestamptz NOT NULL DEFAULT now(),
  detail       jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX activity_object_idx ON activity (object_id, at);

CREATE TABLE audit_event (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id             uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  actor_id                 uuid NOT NULL REFERENCES principal(id) ON DELETE RESTRICT,
  action                   text NOT NULL,
  at                       timestamptz NOT NULL DEFAULT now(),
  originating_conversation_id uuid,
  supporting_refs          jsonb NOT NULL DEFAULT '[]'::jsonb
);

-- ---------------------------------------------------------------------------
-- Transactional outbox (P2.6 §16, INV-13). Written in the mutation's txn.
-- ---------------------------------------------------------------------------

CREATE TABLE outbox_event (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  workspace_id  uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  type          text NOT NULL,
  payload       jsonb NOT NULL,   -- identifiers + change kind only, never denormalised content
  created_at    timestamptz NOT NULL DEFAULT now(),
  delivered_at  timestamptz,
  attempts      integer NOT NULL DEFAULT 0,
  dead_lettered boolean NOT NULL DEFAULT false
);

CREATE INDEX outbox_undelivered_idx ON outbox_event (created_at)
  WHERE delivered_at IS NULL AND dead_lettered = false;

-- ---------------------------------------------------------------------------
-- Derived (D) — rebuildable, never authoritative (INV-6).
-- ---------------------------------------------------------------------------

CREATE TABLE object_fts (
  object_id    uuid PRIMARY KEY REFERENCES object(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  fts          tsvector NOT NULL
);

CREATE INDEX object_fts_gin ON object_fts USING gin (fts);
