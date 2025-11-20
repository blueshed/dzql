-- DZQL Core Schema - Version 3.0.0
-- Basic schema, tables, and meta information

-- === Schema Creation ===
CREATE SCHEMA IF NOT EXISTS dzql;

-- === Meta Table ===
CREATE TABLE IF NOT EXISTS dzql.meta (
  installed_at timestamptz DEFAULT now(),
  version text NOT NULL
);

INSERT INTO dzql.meta (version) VALUES ('3.0.0')
ON CONFLICT DO NOTHING;

-- === Entity Configuration Table ===
CREATE TABLE IF NOT EXISTS dzql.entities (
  table_name text PRIMARY KEY,
  label_field text NOT NULL,             -- field to use for lookup labels
  searchable_fields text[] NOT NULL,     -- fields to search in search operations
  fk_includes jsonb DEFAULT '{}',        -- foreign keys to dereference in get operations
  soft_delete boolean DEFAULT false,     -- use deleted_at instead of hard delete
  temporal_fields jsonb DEFAULT '{}',    -- valid_from/valid_to field names for temporal filtering
  notification_paths jsonb DEFAULT '{}', -- paths to determine who gets notified
  permission_paths jsonb DEFAULT '{}',   -- paths to determine who has permission for operations
  graph_rules jsonb DEFAULT '{}',        -- graph evolution rules for automatic relationship management
  field_defaults jsonb DEFAULT '{}',     -- default values to auto-populate on INSERT
  many_to_many jsonb DEFAULT '{}'        -- many-to-many relationship configurations
);

-- === Registry (allowlist of callable functions) ===
CREATE TABLE IF NOT EXISTS dzql.registry (
  fn_regproc regproc PRIMARY KEY,
  description text
);

-- === Event Audit Table ===
CREATE TABLE IF NOT EXISTS dzql.events (
  event_id bigserial PRIMARY KEY,
  table_name text NOT NULL,
  op text NOT NULL,              -- 'INSERT', 'UPDATE', 'DELETE'
  pk jsonb NOT NULL,             -- primary key of affected record
  before jsonb,                  -- old values (NULL for INSERT)
  after jsonb,                   -- new values (NULL for DELETE)
  user_id int,                   -- who made the change
  notify_users int[],            -- who should be notified (NULL = everyone)
  at timestamptz DEFAULT now()  -- when the change occurred
);

-- Index for efficient event queries
CREATE INDEX IF NOT EXISTS dzql_events_table_pk_idx ON dzql.events (table_name, pk, at);
CREATE INDEX IF NOT EXISTS dzql_events_user_idx ON dzql.events (user_id, at);
CREATE INDEX IF NOT EXISTS dzql_events_event_id_idx ON dzql.events (event_id);
CREATE INDEX IF NOT EXISTS idx_dzql_events_at ON dzql.events(at);

-- === Comments ===
COMMENT ON SCHEMA dzql IS 'DZQL framework core schema';
COMMENT ON TABLE dzql.entities IS 'Configuration for entities with automatic CRUD operations';
COMMENT ON TABLE dzql.registry IS 'Registry of callable PostgreSQL functions';
COMMENT ON TABLE dzql.events IS 'Audit trail of all entity changes';
COMMENT ON COLUMN dzql.entities.graph_rules IS 'Graph evolution rules that define how relationships change during operations';
