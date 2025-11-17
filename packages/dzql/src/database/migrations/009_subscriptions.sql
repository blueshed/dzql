-- Migration 009: Live Query Subscriptions Infrastructure
-- Adds support for subscribable documents (Pattern 1 from vision.md)

-- ============================================================================
-- Subscribables Registry (Metadata Only)
-- ============================================================================

-- Stores metadata for registered subscribables
-- Note: Active subscriptions are held in-memory on the server
CREATE TABLE IF NOT EXISTS dzql.subscribables (
  name TEXT PRIMARY KEY,
  permission_paths JSONB NOT NULL DEFAULT '{}'::jsonb,
  param_schema JSONB NOT NULL DEFAULT '{}'::jsonb,
  root_entity TEXT NOT NULL,
  relations JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE dzql.subscribables IS
  'Registry of subscribable documents. Subscribables define denormalized views that clients can subscribe to for real-time updates.';

COMMENT ON COLUMN dzql.subscribables.name IS
  'Subscribable identifier (used in subscribe_<name> RPC calls)';

COMMENT ON COLUMN dzql.subscribables.permission_paths IS
  'Access control paths (e.g., {"subscribe": ["@org_id->acts_for[org_id=$]{active}.user_id"]})';

COMMENT ON COLUMN dzql.subscribables.param_schema IS
  'Parameter schema defining subscription key (e.g., {"venue_id": "int"})';

COMMENT ON COLUMN dzql.subscribables.root_entity IS
  'Root table for the subscribable document';

COMMENT ON COLUMN dzql.subscribables.relations IS
  'Related entities to include (e.g., {"org": "organisations", "sites": {"entity": "sites", "filter": "venue_id=$venue_id"}})';

-- Index for quick lookups
CREATE INDEX IF NOT EXISTS idx_subscribables_root_entity
  ON dzql.subscribables(root_entity);

-- ============================================================================
-- Register Subscribable Function
-- ============================================================================

CREATE OR REPLACE FUNCTION dzql.register_subscribable(
  p_name TEXT,
  p_permission_paths JSONB,
  p_param_schema JSONB,
  p_root_entity TEXT,
  p_relations JSONB
) RETURNS TEXT AS $$
DECLARE
  v_result TEXT;
BEGIN
  -- Validate inputs
  IF p_name IS NULL OR p_name = '' THEN
    RAISE EXCEPTION 'Subscribable name cannot be empty';
  END IF;

  IF p_root_entity IS NULL OR p_root_entity = '' THEN
    RAISE EXCEPTION 'Root entity cannot be empty';
  END IF;

  -- Insert or update subscribable
  INSERT INTO dzql.subscribables (
    name,
    permission_paths,
    param_schema,
    root_entity,
    relations,
    created_at,
    updated_at
  ) VALUES (
    p_name,
    COALESCE(p_permission_paths, '{}'::jsonb),
    COALESCE(p_param_schema, '{}'::jsonb),
    p_root_entity,
    COALESCE(p_relations, '{}'::jsonb),
    NOW(),
    NOW()
  )
  ON CONFLICT (name) DO UPDATE SET
    permission_paths = EXCLUDED.permission_paths,
    param_schema = EXCLUDED.param_schema,
    root_entity = EXCLUDED.root_entity,
    relations = EXCLUDED.relations,
    updated_at = NOW();

  v_result := format('Subscribable "%s" registered successfully', p_name);

  RAISE NOTICE '%', v_result;

  RETURN v_result;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION dzql.register_subscribable IS
  'Register a subscribable document definition. Used by the compiler to store subscribable metadata.';

-- ============================================================================
-- Helper Functions
-- ============================================================================

-- Get all registered subscribables
CREATE OR REPLACE FUNCTION dzql.get_subscribables()
RETURNS TABLE (
  name TEXT,
  permission_paths JSONB,
  param_schema JSONB,
  root_entity TEXT,
  relations JSONB,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    s.name,
    s.permission_paths,
    s.param_schema,
    s.root_entity,
    s.relations,
    s.created_at,
    s.updated_at
  FROM dzql.subscribables s
  ORDER BY s.name;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION dzql.get_subscribables IS
  'Retrieve all registered subscribables';

-- Get subscribable by name
CREATE OR REPLACE FUNCTION dzql.get_subscribable(p_name TEXT)
RETURNS TABLE (
  name TEXT,
  permission_paths JSONB,
  param_schema JSONB,
  root_entity TEXT,
  relations JSONB,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    s.name,
    s.permission_paths,
    s.param_schema,
    s.root_entity,
    s.relations,
    s.created_at,
    s.updated_at
  FROM dzql.subscribables s
  WHERE s.name = p_name;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION dzql.get_subscribable IS
  'Retrieve a specific subscribable by name';

-- Get subscribables by root entity
CREATE OR REPLACE FUNCTION dzql.get_subscribables_by_entity(p_entity TEXT)
RETURNS TABLE (
  name TEXT,
  permission_paths JSONB,
  param_schema JSONB,
  root_entity TEXT,
  relations JSONB,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    s.name,
    s.permission_paths,
    s.param_schema,
    s.root_entity,
    s.relations,
    s.created_at,
    s.updated_at
  FROM dzql.subscribables s
  WHERE s.root_entity = p_entity
  ORDER BY s.name;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION dzql.get_subscribables_by_entity IS
  'Retrieve all subscribables for a given root entity';

-- Delete subscribable
CREATE OR REPLACE FUNCTION dzql.delete_subscribable(p_name TEXT)
RETURNS TEXT AS $$
DECLARE
  v_result TEXT;
BEGIN
  DELETE FROM dzql.subscribables
  WHERE name = p_name;

  IF FOUND THEN
    v_result := format('Subscribable "%s" deleted successfully', p_name);
  ELSE
    v_result := format('Subscribable "%s" not found', p_name);
  END IF;

  RAISE NOTICE '%', v_result;

  RETURN v_result;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION dzql.delete_subscribable IS
  'Delete a subscribable by name';

-- ============================================================================
-- Verification
-- ============================================================================

DO $$
BEGIN
  RAISE NOTICE 'Migration 009: Live Query Subscriptions - Complete';
  RAISE NOTICE 'Subscribables table created';
  RAISE NOTICE 'Helper functions installed';
  RAISE NOTICE '';
  RAISE NOTICE 'Usage:';
  RAISE NOTICE '  SELECT dzql.register_subscribable(''name'', permissions, params, root, relations);';
  RAISE NOTICE '  SELECT * FROM dzql.get_subscribables();';
END $$;
