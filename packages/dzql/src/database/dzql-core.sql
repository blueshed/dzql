-- ============================================================================
-- DZQL Core - Minimal Foundation
-- ============================================================================
-- This is the minimal SQL needed for DZQL compiled mode.
-- Run: dzql db:init
-- Or:  psql $DATABASE_URL -f dzql-core.sql
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE SCHEMA IF NOT EXISTS dzql;

-- Version tracking
CREATE TABLE IF NOT EXISTS dzql.meta (
  installed_at TIMESTAMPTZ DEFAULT now(),
  version TEXT NOT NULL
);

INSERT INTO dzql.meta (version)
SELECT '0.5.14'
WHERE NOT EXISTS (SELECT 1 FROM dzql.meta);

-- Entity registry
CREATE TABLE IF NOT EXISTS dzql.entities (
  table_name TEXT PRIMARY KEY,
  label_field TEXT NOT NULL,
  searchable_fields TEXT[] NOT NULL,
  fk_includes JSONB DEFAULT '{}',
  soft_delete BOOLEAN DEFAULT false,
  temporal_fields JSONB DEFAULT '{}',
  notification_paths JSONB DEFAULT '{}',
  permission_paths JSONB DEFAULT '{}',
  graph_rules JSONB DEFAULT '{}',
  field_defaults JSONB DEFAULT '{}',
  many_to_many JSONB DEFAULT '{}'
);

-- Function allowlist
CREATE TABLE IF NOT EXISTS dzql.registry (
  fn_regproc REGPROC PRIMARY KEY,
  description TEXT
);

-- Event audit table
CREATE TABLE IF NOT EXISTS dzql.events (
  event_id BIGSERIAL PRIMARY KEY,
  table_name TEXT NOT NULL,
  op TEXT NOT NULL,
  pk JSONB NOT NULL,
  data JSONB,
  user_id INT,
  notify_users INT[],
  at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS dzql_events_at_idx ON dzql.events (at);
CREATE INDEX IF NOT EXISTS dzql_events_table_pk_idx ON dzql.events (table_name, pk, at);

-- NOTIFY trigger for real-time updates
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

-- Subscribables registry (for compiled subscribables)
CREATE TABLE IF NOT EXISTS dzql.subscribables (
  name TEXT PRIMARY KEY,
  permission_paths JSONB DEFAULT '{}',
  param_schema JSONB DEFAULT '{}',
  root_entity TEXT NOT NULL,
  relations JSONB DEFAULT '{}',
  scope_tables TEXT[] DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Helper to register entities
CREATE OR REPLACE FUNCTION dzql.register_entity(
  p_table_name TEXT,
  p_label_field TEXT,
  p_searchable_fields TEXT[],
  p_fk_includes JSONB DEFAULT '{}',
  p_soft_delete BOOLEAN DEFAULT false,
  p_temporal_fields JSONB DEFAULT '{}',
  p_notification_paths JSONB DEFAULT '{}',
  p_permission_paths JSONB DEFAULT '{}',
  p_graph_rules JSONB DEFAULT '{}',
  p_field_defaults JSONB DEFAULT '{}',
  p_many_to_many JSONB DEFAULT '{}'
) RETURNS VOID AS $$
BEGIN
  INSERT INTO dzql.entities (
    table_name, label_field, searchable_fields, fk_includes,
    soft_delete, temporal_fields, notification_paths, permission_paths,
    graph_rules, field_defaults, many_to_many
  ) VALUES (
    p_table_name, p_label_field, p_searchable_fields, p_fk_includes,
    p_soft_delete, p_temporal_fields, p_notification_paths, p_permission_paths,
    p_graph_rules, p_field_defaults, p_many_to_many
  )
  ON CONFLICT (table_name) DO UPDATE SET
    label_field = EXCLUDED.label_field,
    searchable_fields = EXCLUDED.searchable_fields,
    fk_includes = EXCLUDED.fk_includes,
    soft_delete = EXCLUDED.soft_delete,
    temporal_fields = EXCLUDED.temporal_fields,
    notification_paths = EXCLUDED.notification_paths,
    permission_paths = EXCLUDED.permission_paths,
    graph_rules = EXCLUDED.graph_rules,
    field_defaults = EXCLUDED.field_defaults,
    many_to_many = EXCLUDED.many_to_many;
END;
$$ LANGUAGE plpgsql;

-- Helper to register subscribables
CREATE OR REPLACE FUNCTION dzql.register_subscribable(
  p_name TEXT,
  p_permission_paths JSONB,
  p_param_schema JSONB,
  p_root_entity TEXT,
  p_relations JSONB DEFAULT '{}'
) RETURNS VOID AS $$
DECLARE
  v_scope_tables TEXT[];
BEGIN
  -- Extract scope tables from relations
  SELECT array_agg(DISTINCT tbl) INTO v_scope_tables
  FROM (
    SELECT p_root_entity AS tbl
    UNION ALL
    SELECT value->>'entity' AS tbl
    FROM jsonb_each(p_relations)
    WHERE value->>'entity' IS NOT NULL
  ) t
  WHERE tbl IS NOT NULL;

  INSERT INTO dzql.subscribables (name, permission_paths, param_schema, root_entity, relations, scope_tables)
  VALUES (p_name, p_permission_paths, p_param_schema, p_root_entity, p_relations, v_scope_tables)
  ON CONFLICT (name) DO UPDATE SET
    permission_paths = EXCLUDED.permission_paths,
    param_schema = EXCLUDED.param_schema,
    root_entity = EXCLUDED.root_entity,
    relations = EXCLUDED.relations,
    scope_tables = EXCLUDED.scope_tables;
END;
$$ LANGUAGE plpgsql;
