-- ZeroQL Core Schema - Version 3.0.0
-- Basic schema, tables, and meta information

-- === Schema Creation ===
CREATE SCHEMA IF NOT EXISTS zeroql;

-- === Meta Table ===
CREATE TABLE IF NOT EXISTS zeroql.meta (
  installed_at timestamptz DEFAULT now(),
  version text NOT NULL
);

INSERT INTO zeroql.meta (version) VALUES ('3.0.0')
ON CONFLICT DO NOTHING;

-- === Entity Configuration Table ===
CREATE TABLE IF NOT EXISTS zeroql.entities (
  table_name text PRIMARY KEY,
  label_field text NOT NULL,             -- field to use for lookup labels
  searchable_fields text[] NOT NULL,     -- fields to search in search operations
  fk_includes jsonb DEFAULT '{}',        -- foreign keys to dereference in get operations
  soft_delete boolean DEFAULT false,     -- use deleted_at instead of hard delete
  temporal_fields jsonb DEFAULT '{}',    -- valid_from/valid_to field names for temporal filtering
  notification_paths jsonb DEFAULT '{}', -- paths to determine who gets notified
  permission_paths jsonb DEFAULT '{}',   -- paths to determine who has permission for operations
  graph_rules jsonb DEFAULT '{}'         -- graph evolution rules for automatic relationship management
);

-- === Registry (allowlist of callable functions) ===
CREATE TABLE IF NOT EXISTS zeroql.registry (
  fn_regproc regproc PRIMARY KEY,
  description text
);

-- === Event Audit Table ===
CREATE TABLE IF NOT EXISTS zeroql.events (
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
CREATE INDEX IF NOT EXISTS zeroql_events_table_pk_idx ON zeroql.events (table_name, pk, at);
CREATE INDEX IF NOT EXISTS zeroql_events_user_idx ON zeroql.events (user_id, at);
CREATE INDEX IF NOT EXISTS zeroql_events_event_id_idx ON zeroql.events (event_id);
CREATE INDEX IF NOT EXISTS idx_zeroql_events_at ON zeroql.events(at);

-- === Comments ===
COMMENT ON SCHEMA zeroql IS 'ZeroQL framework core schema';
COMMENT ON TABLE zeroql.entities IS 'Configuration for entities with automatic CRUD operations';
COMMENT ON TABLE zeroql.registry IS 'Registry of callable PostgreSQL functions';
COMMENT ON TABLE zeroql.events IS 'Audit trail of all entity changes';
COMMENT ON COLUMN zeroql.entities.graph_rules IS 'Graph evolution rules that define how relationships change during operations';
