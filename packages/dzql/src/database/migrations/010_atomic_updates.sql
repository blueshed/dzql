-- Migration 010: Atomic Updates for Subscribables
-- Adds extract_scope_tables function and updates register_subscribable to auto-populate scope_tables

-- ============================================================================
-- Helper function to extract scope tables from relations
-- ============================================================================

CREATE OR REPLACE FUNCTION dzql.extract_scope_tables(
  p_root_entity TEXT,
  p_relations JSONB
) RETURNS TEXT[] AS $$
DECLARE
  v_tables TEXT[];
  v_key TEXT;
  v_value JSONB;
  v_entity TEXT;
  v_nested JSONB;
BEGIN
  -- Start with root entity (may be NULL for dashboard mode)
  IF p_root_entity IS NOT NULL AND p_root_entity != '' THEN
    v_tables := ARRAY[p_root_entity];
  ELSE
    v_tables := ARRAY[]::TEXT[];
  END IF;

  -- Return early if no relations
  IF p_relations IS NULL OR p_relations = '{}'::jsonb THEN
    RETURN v_tables;
  END IF;

  -- Iterate through relations
  FOR v_key, v_value IN SELECT * FROM jsonb_each(p_relations)
  LOOP
    -- Handle string relation (simple FK expansion): "org": "organisations"
    IF jsonb_typeof(v_value) = 'string' THEN
      v_entity := v_value #>> '{}';
      IF v_entity IS NOT NULL AND v_entity != '' THEN
        v_tables := array_append(v_tables, v_entity);
      END IF;
    -- Handle object relation: {"entity": "sites", "filter": "..."}
    ELSIF jsonb_typeof(v_value) = 'object' THEN
      v_entity := v_value ->> 'entity';
      IF v_entity IS NOT NULL AND v_entity != '' THEN
        v_tables := array_append(v_tables, v_entity);
      END IF;

      -- Recursively handle nested relations (include or relations)
      v_nested := v_value -> 'include';
      IF v_nested IS NOT NULL AND jsonb_typeof(v_nested) = 'object' THEN
        v_tables := v_tables || dzql.extract_scope_tables(NULL, v_nested);
      END IF;

      v_nested := v_value -> 'relations';
      IF v_nested IS NOT NULL AND jsonb_typeof(v_nested) = 'object' THEN
        v_tables := v_tables || dzql.extract_scope_tables(NULL, v_nested);
      END IF;
    END IF;
  END LOOP;

  -- Remove duplicates and nulls
  SELECT array_agg(DISTINCT t) INTO v_tables
  FROM unnest(v_tables) t
  WHERE t IS NOT NULL;

  RETURN COALESCE(v_tables, ARRAY[]::TEXT[]);
END;
$$ LANGUAGE plpgsql IMMUTABLE;

COMMENT ON FUNCTION dzql.extract_scope_tables IS
  'Extract all table names from a subscribable definition (root entity + all relations recursively)';

-- ============================================================================
-- Update register_subscribable to auto-populate scope_tables
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
  v_scope_tables TEXT[];
BEGIN
  -- Validate inputs
  IF p_name IS NULL OR p_name = '' THEN
    RAISE EXCEPTION 'Subscribable name cannot be empty';
  END IF;

  -- NULL root_entity is allowed for dashboard mode (pure collections)
  -- But if relations is also empty, that's an error
  IF (p_root_entity IS NULL OR p_root_entity = '') AND
     (p_relations IS NULL OR p_relations = '{}'::jsonb) THEN
    RAISE EXCEPTION 'Subscribable must have either a root entity or relations';
  END IF;

  -- Extract scope tables from root entity and relations
  v_scope_tables := dzql.extract_scope_tables(p_root_entity, p_relations);

  -- Insert or update subscribable
  INSERT INTO dzql.subscribables (
    name,
    permission_paths,
    param_schema,
    root_entity,
    relations,
    scope_tables,
    created_at,
    updated_at
  ) VALUES (
    p_name,
    COALESCE(p_permission_paths, '{}'::jsonb),
    COALESCE(p_param_schema, '{}'::jsonb),
    NULLIF(p_root_entity, ''),  -- Store empty string as NULL
    COALESCE(p_relations, '{}'::jsonb),
    v_scope_tables,
    NOW(),
    NOW()
  )
  ON CONFLICT (name) DO UPDATE SET
    permission_paths = EXCLUDED.permission_paths,
    param_schema = EXCLUDED.param_schema,
    root_entity = EXCLUDED.root_entity,
    relations = EXCLUDED.relations,
    scope_tables = EXCLUDED.scope_tables,
    updated_at = NOW();

  v_result := format('Subscribable "%s" registered successfully with scope tables: %s',
                     p_name, array_to_string(v_scope_tables, ', '));

  RAISE NOTICE '%', v_result;

  RETURN v_result;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- Backfill existing subscribables with scope_tables
-- ============================================================================

UPDATE dzql.subscribables s
SET scope_tables = dzql.extract_scope_tables(s.root_entity, s.relations)
WHERE scope_tables = '{}' OR scope_tables IS NULL;

-- ============================================================================
-- Verification
-- ============================================================================

DO $$
BEGIN
  RAISE NOTICE 'Migration 010: Atomic Updates - Complete';
  RAISE NOTICE 'Created dzql.extract_scope_tables() function';
  RAISE NOTICE 'Updated dzql.register_subscribable() to auto-populate scope_tables';
  RAISE NOTICE 'Backfilled existing subscribables';
END $$;
