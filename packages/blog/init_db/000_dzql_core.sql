-- DZQL Core Schema and Events System

CREATE SCHEMA IF NOT EXISTS dzql;

-- Event Audit Table for real-time notifications
CREATE TABLE IF NOT EXISTS dzql.events (
  event_id bigserial PRIMARY KEY,
  table_name text NOT NULL,
  op text NOT NULL,              -- 'insert', 'update', 'delete'
  pk jsonb NOT NULL,             -- primary key of affected record
  before jsonb,                  -- old values (NULL for insert)
  after jsonb,                   -- new values (NULL for delete)
  user_id int,                   -- who made the change
  notify_users int[],            -- who should be notified
  at timestamptz DEFAULT now()   -- when the change occurred
);

CREATE INDEX IF NOT EXISTS dzql_events_table_pk_idx ON dzql.events (table_name, pk, at);
CREATE INDEX IF NOT EXISTS dzql_events_event_id_idx ON dzql.events (event_id);

-- Event notification trigger - sends real-time notifications via pg_notify
CREATE OR REPLACE FUNCTION dzql.notify_event()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_notify('dzql', jsonb_build_object(
    'event_id', NEW.event_id,
    'table', NEW.table_name,
    'op', NEW.op,
    'pk', NEW.pk,
    'data', COALESCE(NEW.after, NEW.before),
    'before', NEW.before,
    'after', NEW.after,
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
