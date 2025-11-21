-- DZQL Core Schema and Tables

CREATE SCHEMA IF NOT EXISTS dzql;

-- Meta information
CREATE TABLE IF NOT EXISTS dzql.meta (
  installed_at timestamptz DEFAULT now(),
  version text NOT NULL
);

INSERT INTO dzql.meta (version) VALUES ('3.0.0') ON CONFLICT DO NOTHING;

-- Entity Configuration Table
CREATE TABLE IF NOT EXISTS dzql.entities (
  table_name text PRIMARY KEY,
  label_field text NOT NULL,
  searchable_fields text[] NOT NULL,
  fk_includes jsonb DEFAULT '{}',
  soft_delete boolean DEFAULT false,
  temporal_fields jsonb DEFAULT '{}',
  notification_paths jsonb DEFAULT '{}',
  permission_paths jsonb DEFAULT '{}',
  graph_rules jsonb DEFAULT '{}',
  field_defaults jsonb DEFAULT '{}',
  many_to_many jsonb DEFAULT '{}'
);

-- Registry of callable functions
CREATE TABLE IF NOT EXISTS dzql.registry (
  fn_regproc regproc PRIMARY KEY,
  description text
);

-- Event Audit Table for real-time notifications
CREATE TABLE IF NOT EXISTS dzql.events (
  event_id bigserial PRIMARY KEY,
  table_name text NOT NULL,
  op text NOT NULL,
  pk jsonb NOT NULL,
  data jsonb,
  user_id int,
  notify_users int[],
  at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS dzql_events_table_pk_idx ON dzql.events (table_name, pk, at);
CREATE INDEX IF NOT EXISTS dzql_events_user_idx ON dzql.events (user_id, at);
CREATE INDEX IF NOT EXISTS dzql_events_event_id_idx ON dzql.events (event_id);

-- Event notification trigger
CREATE OR REPLACE FUNCTION dzql.notify_event()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_notify('dzql', jsonb_build_object(
    'event_id', NEW.event_id,
    'table', NEW.table_name,
    'op', NEW.op,
    'pk', NEW.pk,
    'data', NEW.data,
    'user_id', NEW.user_id,
    'at', NEW.at,
    'notify_users', NEW.notify_users
  )::text);
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS dzql_events_notify ON dzql.events;
CREATE TRIGGER dzql_events_notify
  AFTER INSERT ON dzql.events
  FOR EACH ROW EXECUTE FUNCTION dzql.notify_event();
