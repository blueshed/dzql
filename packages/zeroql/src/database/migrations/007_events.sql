-- ZeroQL Framework - Event System and Real-time Notifications
-- Events are created ONLY by API operations (generic_save, generic_delete)
-- This ensures proper user context and security

-- ============================================================================
-- NOTIFY EVENT FUNCTION
-- ============================================================================
-- Event notification trigger - handles all real-time notifications
CREATE OR REPLACE FUNCTION zeroql.notify_event()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  -- Send real-time notification to single channel
  -- For DELETE operations, send the 'before' data since 'after' is NULL
  PERFORM pg_notify('zeroql', jsonb_build_object(
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

-- ============================================================================
-- CREATE TRIGGER ON EVENTS TABLE
-- ============================================================================
-- Create trigger on events table to handle notifications
DROP TRIGGER IF EXISTS zeroql_events_notify ON zeroql.events;
CREATE TRIGGER zeroql_events_notify
  AFTER INSERT ON zeroql.events
  FOR EACH ROW EXECUTE FUNCTION zeroql.notify_event();

-- ============================================================================
-- HELPER FUNCTIONS
-- ============================================================================

-- Get event history for a specific record (audit trail)
CREATE OR REPLACE FUNCTION zeroql.get_record_history(
  p_table_name text,
  p_record_id text,
  p_limit int DEFAULT 50
) RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(jsonb_agg(
    to_jsonb(e) ORDER BY e.at DESC
  ), '[]'::jsonb)
  FROM (
    SELECT * FROM zeroql.events e
    WHERE e.table_name = p_table_name
      AND e.pk->>'id' = p_record_id
    ORDER BY e.at DESC
    LIMIT p_limit
  ) e;
$$;

-- Get recent actions by a user
CREATE OR REPLACE FUNCTION zeroql.get_user_actions(
  p_user_id int,
  p_limit int DEFAULT 100
) RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(jsonb_agg(
    to_jsonb(e) ORDER BY e.at DESC
  ), '[]'::jsonb)
  FROM (
    SELECT * FROM zeroql.events e
    WHERE e.user_id = p_user_id
    ORDER BY e.at DESC
    LIMIT p_limit
  ) e;
$$;

-- Get event catchup data for synchronization
CREATE OR REPLACE FUNCTION zeroql.catchup(p_context_id text, p_since_event_id bigint)
RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT coalesce(jsonb_agg(to_jsonb(e) order by e.event_id), '[]'::jsonb)
  FROM zeroql.events e
  WHERE e.event_id > p_since_event_id;
$$;

-- Get single event by ID
CREATE OR REPLACE FUNCTION zeroql.get_event(p_event_id bigint)
RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT to_jsonb(e) FROM zeroql.events e WHERE e.event_id = p_event_id;
$$;

-- Get recent events on a table
CREATE OR REPLACE FUNCTION zeroql.get_table_events(
  p_table_name text,
  p_limit int DEFAULT 100
) RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(jsonb_agg(
    to_jsonb(e) ORDER BY e.at DESC
  ), '[]'::jsonb)
  FROM (
    SELECT * FROM zeroql.events e
    WHERE e.table_name = p_table_name
    ORDER BY e.at DESC
    LIMIT p_limit
  ) e;
$$;

-- Comments
COMMENT ON FUNCTION zeroql.notify_event() IS 'Broadcasts event notifications via PostgreSQL NOTIFY for real-time updates';
COMMENT ON FUNCTION zeroql.get_record_history(text, text, int) IS 'Returns audit trail for a specific record';
COMMENT ON FUNCTION zeroql.get_user_actions(int, int) IS 'Returns recent actions performed by a user';
COMMENT ON FUNCTION zeroql.get_table_events(text, int) IS 'Returns recent events for a table';

-- ============================================================================
-- CLEANUP OLD TRIGGER SYSTEM
-- ============================================================================
-- Remove any table triggers that were created by the old system
DO $$
DECLARE
  l_table_name text;
BEGIN
  -- Remove old emit_row_change function if it exists
  DROP FUNCTION IF EXISTS zeroql.emit_row_change() CASCADE;

  -- Clean up any existing table triggers from registered entities
  FOR l_table_name IN
    SELECT table_name FROM zeroql.entities
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I',
      l_table_name || '_zeroql_events', l_table_name);
  END LOOP;

  RAISE NOTICE 'Cleaned up old table trigger system';
END $$;
