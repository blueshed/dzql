-- DZQL Core Functions - Version 3.0.0
-- Helper functions, utilities, and core DZQL functionality

-- === JSON Helpers ===
CREATE OR REPLACE FUNCTION dzql.jarr(x anyarray)
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT coalesce(to_jsonb(x), '[]'::jsonb);
$$;

-- Convert record to jsonb efficiently
CREATE OR REPLACE FUNCTION dzql.to_jsonb(rec anyelement)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  RETURN to_jsonb(rec);
END $$;

-- Extract object keys as array
CREATE OR REPLACE FUNCTION dzql.keys(obj jsonb)
RETURNS text[] LANGUAGE sql IMMUTABLE AS $$
  SELECT array_agg(key) FROM jsonb_object_keys(obj) AS key;
$$;

-- Build JSON object from key-value pair
CREATE OR REPLACE FUNCTION dzql.j(k text, v jsonb)
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_build_object(k, v);
$$;

-- Merge multiple JSONB objects
CREATE OR REPLACE FUNCTION dzql.merge(variadic parts jsonb[])
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT coalesce(jsonb_strip_nulls(jsonb_object_agg(k, v)), '{}'::jsonb)
  FROM (
    SELECT (t.parts).key as k, (t.parts).value as v
    FROM (SELECT jsonb_each(coalesce(p,'{}'::jsonb)) parts FROM unnest(parts) p) t
  ) s;
$$;

-- === Temporal Filtering Helper ===
CREATE OR REPLACE FUNCTION dzql.apply_temporal_filter(
  p_table regclass,
  p_temporal_fields jsonb,
  p_on_date timestamptz DEFAULT NULL
) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE
  l_valid_from text;
  l_valid_to text;
  l_filter_date timestamptz;
BEGIN
  IF p_temporal_fields IS NULL OR p_temporal_fields = '{}' THEN
    RETURN '';
  END IF;

  l_valid_from := p_temporal_fields->>'valid_from';
  l_valid_to := p_temporal_fields->>'valid_to';
  l_filter_date := coalesce(p_on_date, now());

  IF l_valid_from IS NULL THEN
    RETURN '';
  END IF;

  RETURN format(' AND %I <= %L AND (%I > %L OR %I IS NULL)',
    l_valid_from, l_filter_date,
    l_valid_to, l_filter_date, l_valid_to
  );
END $$;

-- === Describe (introspection) ===
CREATE OR REPLACE FUNCTION dzql.describe()
RETURNS TABLE(
  table_name text,
  label_field text,
  searchable_fields text[],
  fk_includes jsonb,
  temporal_fields jsonb,
  notification_paths jsonb,
  permission_paths jsonb,
  graph_rules jsonb
) LANGUAGE sql AS $$
  SELECT e.table_name, e.label_field, e.searchable_fields, e.fk_includes,
         e.temporal_fields, e.notification_paths, e.permission_paths, e.graph_rules
  FROM dzql.entities e
  ORDER BY e.table_name;
$$;

-- === Legacy Exec Dispatcher (for custom functions) ===
CREATE OR REPLACE FUNCTION dzql.exec(
  exposed text,
  args jsonb DEFAULT '{}',
  p_user_id int DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  l_fn_regproc regproc;
  l_result jsonb;
  l_arg_names text[];
  l_arg_values text[];
  l_call_sql text;
  l_key text;
  l_value jsonb;
  l_user_id int;
BEGIN
  -- Get user_id from session if not provided
  l_user_id := coalesce(p_user_id, nullif(current_setting('dzql.user_id', true), '')::int);

  -- Check if function is registered
  SELECT fn_regproc INTO l_fn_regproc FROM dzql.registry WHERE fn_regproc = exposed::regproc;
  IF l_fn_regproc IS NULL THEN
    RAISE EXCEPTION 'Function % not found or not registered', exposed;
  END IF;

  -- Build function call with user_id as first parameter
  l_arg_names := array['p_user_id'];
  l_arg_values := array[coalesce(l_user_id, 0)::text];

  -- Add other parameters
  IF args IS NOT NULL AND args != '{}' THEN
    FOR l_key, l_value IN SELECT key, value FROM jsonb_each(args)
    LOOP
      l_arg_names := l_arg_names || ('p_' || l_key);
      CASE jsonb_typeof(l_value)
        WHEN 'string' THEN
          l_arg_values := l_arg_values || (l_value #>> '{}');
        WHEN 'number' THEN
          l_arg_values := l_arg_values || (l_value #>> '{}');
        WHEN 'boolean' THEN
          l_arg_values := l_arg_values || (l_value #>> '{}');
        WHEN 'null' THEN
          l_arg_values := l_arg_values || 'NULL';
        ELSE
          l_arg_values := l_arg_values || (l_value::text);
      END CASE;
    END LOOP;
  END IF;

  -- Build and execute function call
  l_call_sql := format('SELECT %I(%s)', exposed, array_to_string(l_arg_values, ','));

  BEGIN
    EXECUTE l_call_sql INTO l_result;
  EXCEPTION
    WHEN OTHERS THEN
      RAISE EXCEPTION 'DZQL: exec error for %: %', exposed, SQLERRM;
  END;

  RETURN l_result;
END $$;

-- === Path Resolution Functions ===
-- Resolve notification/permission paths to user IDs
-- === Path Resolution Functions ===
-- Resolve a single path segment (handles @field, table[condition], and FK traversal)
CREATE OR REPLACE FUNCTION dzql.resolve_path_segment(
  p_table_name text,
  p_record jsonb,
  p_segment text
) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE
  l_result jsonb;
  l_parts text[];
  l_field_name text;
  l_table_name text;
  l_condition text;
  l_is_active boolean := false;
  l_sql text;
  l_current_record jsonb;
  l_step text;
  l_hops text[];
  l_final_field text;
BEGIN
  -- Handle simple field reference: @field_name
  IF p_segment LIKE '@%' THEN
    l_field_name := substring(p_segment from 2);
    IF p_record ? l_field_name AND p_record->>l_field_name IS NOT NULL THEN
      DECLARE
        l_field_value text;
      BEGIN
        l_field_value := p_record->>l_field_name;
        -- Try to convert to integer and return as array
        RETURN to_jsonb(array[l_field_value::int]);
      EXCEPTION WHEN OTHERS THEN
        -- If conversion fails, return as text array
        RETURN to_jsonb(array[l_field_value]);
      END;
    END IF;
    RETURN null;
  END IF;

  -- Handle conditional queries: table[condition]{active}.field
  IF p_segment ~ '\[.*\]' THEN
    -- Extract parts: table[condition]{active}.field
    l_table_name := split_part(p_segment, '[', 1);
    l_condition := split_part(split_part(p_segment, '[', 2), ']', 1);
    -- Get field name after the closing bracket
    l_step := split_part(p_segment, ']', 2);
    -- Remove {active} if present
    l_step := replace(l_step, '{active}', '');
    -- Get field name after the dot
    l_field_name := ltrim(l_step, '.');
    l_is_active := p_segment LIKE '%{active}%';

    -- Replace @ references in condition with actual values from the record (if we have one)
    IF p_record IS NOT NULL THEN
      DECLARE
        l_ref_field text;
      BEGIN
        WHILE l_condition ~ '@[a-z_]+' LOOP
          l_ref_field := substring(l_condition from '@([a-z_]+)');
          l_condition := replace(l_condition, '@' || l_ref_field,
                               quote_literal(p_record->>l_ref_field));
        END LOOP;
      END;
    END IF;

    -- Build and execute query
    l_sql := format('SELECT array_agg(%I) FROM %I WHERE %s',
                    l_field_name, l_table_name, l_condition);

    -- Add temporal filtering if {active}
    IF l_is_active THEN
      -- Get temporal field configuration for this table
      DECLARE
        l_temporal_config record;
        l_valid_from_field text;
        l_valid_to_field text;
      BEGIN
        SELECT temporal_fields INTO l_temporal_config
        FROM dzql.entities
        WHERE table_name = l_table_name;

        IF l_temporal_config.temporal_fields IS NOT NULL AND l_temporal_config.temporal_fields != '{}' THEN
          l_valid_from_field := l_temporal_config.temporal_fields->>'valid_from';
          l_valid_to_field := l_temporal_config.temporal_fields->>'valid_to';

          IF l_valid_from_field IS NOT NULL THEN
            l_sql := l_sql || format(' AND %I <= now() AND (%I > now() OR %I IS NULL)',
              l_valid_from_field, l_valid_to_field, l_valid_to_field);
          END IF;
        END IF;
      END;
    END IF;

    DECLARE
      l_ids int[];
    BEGIN
      EXECUTE l_sql INTO l_ids;
      IF l_ids IS NOT NULL THEN
        RETURN to_jsonb(l_ids);
      ELSE
        RETURN null;
      END IF;
    END;
  END IF;

  -- Handle foreign key traversal (single or multi-hop)
  IF p_segment ~ '\.' AND p_record IS NOT NULL THEN
    -- For paths like site_id.venue_id.org_id, we need to:
    -- 1. Follow site_id to get the site record
    -- 2. Follow venue_id from that to get the venue record
    -- 3. Extract org_id from the venue record

    l_current_record := p_record;
    l_parts := string_to_array(p_segment, '.');

    -- We need to track which table we're currently in for FK resolution
    DECLARE
      l_current_table_name text;
    BEGIN
      l_current_table_name := p_table_name;

      -- Process each part except the last (which is the field to extract)
      FOR i IN 1..(array_length(l_parts, 1) - 1) LOOP
        l_step := l_parts[i];

        -- If current record has this field, follow it as a foreign key
        IF l_current_record ? l_step THEN
          -- Get the FK value
          DECLARE
            l_fk_value text;
            l_fk_sql text;
            l_entity_config record;
            l_fk_target text;
          BEGIN
            l_fk_value := l_current_record->>l_step;

            -- Look up the current table's FK configuration
            IF l_current_table_name IS NOT NULL THEN
              SELECT fk_includes INTO l_entity_config
              FROM dzql.entities
              WHERE table_name = l_current_table_name;

              IF l_entity_config.fk_includes IS NOT NULL AND l_entity_config.fk_includes ? l_step THEN
                -- The fk_includes tells us which table this FK points to
                l_table_name := l_entity_config.fk_includes->>l_step;
              ELSIF l_entity_config.fk_includes IS NOT NULL THEN
                -- Check if the field without _id suffix is in fk_includes
                l_fk_target := regexp_replace(l_step, '_id$', '');
                IF l_entity_config.fk_includes ? l_fk_target THEN
                  l_table_name := l_entity_config.fk_includes->>l_fk_target;
                END IF;
              END IF;
            END IF;

            -- If we still don't have a table name, try pattern matching
            IF l_table_name IS NULL THEN
              DECLARE
                l_pattern text;
              BEGIN
                -- Remove _id suffix and try to find a matching table
                l_pattern := regexp_replace(l_step, '_id$', '');

                -- Check for common patterns
                IF EXISTS(SELECT 1 FROM dzql.entities WHERE table_name = l_pattern || 's') THEN
                  l_table_name := l_pattern || 's';
                ELSIF EXISTS(SELECT 1 FROM dzql.entities WHERE table_name = l_pattern) THEN
                  l_table_name := l_pattern;
                END IF;
              END;
            END IF;

            IF l_table_name IS NULL THEN
              RAISE WARNING 'Could not determine target table for FK field % in table %', l_step, coalesce(l_current_table_name, 'unknown');
              RETURN null;
            END IF;

            -- Query the related table
            l_fk_sql := format('SELECT to_jsonb(t.*) FROM %I t WHERE t.id = %L', l_table_name, l_fk_value);
            EXECUTE l_fk_sql INTO l_current_record;

            IF l_current_record IS NULL THEN
              RETURN null; -- FK broken
            END IF;

            -- Update current table context for next iteration
            l_current_table_name := l_table_name;
          END;
        ELSE
          RETURN null; -- Field not found
        END IF;
      END LOOP;
    END;

    -- Extract the final field value
    l_final_field := l_parts[array_length(l_parts, 1)];
    IF l_current_record ? l_final_field THEN
      RETURN to_jsonb(array[l_current_record->>l_final_field]::int[]);
    END IF;

    RETURN null;
  END IF;

  RETURN null;
END $$;

-- Resolve notification/permission paths to user IDs
CREATE OR REPLACE FUNCTION dzql.resolve_notification_path(
  p_table_name text,
  p_record jsonb,
  p_path text
) RETURNS int[]
LANGUAGE plpgsql AS $$
DECLARE
  l_result_ids int[] := '{}';
  l_continuation_parts text[];
  l_current_segment text;
  l_current_result jsonb;
  l_current_ids int[];
  l_sql text;
  l_field_name text;
  l_table_name text;
  l_condition text;
  l_is_active boolean := false;
  l_i int;
BEGIN
  -- Split by continuation operator (->) if present
  IF p_path ~ '->' THEN
    l_continuation_parts := string_to_array(p_path, '->');

    -- Process first segment with the original record
    l_current_result := dzql.resolve_path_segment(p_table_name, p_record, l_continuation_parts[1]);

    -- Process each continuation segment
    FOR l_i IN 2..array_length(l_continuation_parts, 1) LOOP
      l_current_segment := l_continuation_parts[l_i];

      -- Replace $ with the result from previous segment
      IF l_current_result IS NOT NULL THEN
        -- Handle array results
        IF jsonb_typeof(l_current_result) = 'array' THEN
          -- For each ID in the array, resolve the path and collect results
          l_current_ids := '{}';
          DECLARE
            l_j int;
            l_temp_segment text;
            l_temp_ids int[];
            l_temp_value int;
            l_segment_table text;
            l_segment_record jsonb;
          BEGIN
            FOR l_j IN 0..jsonb_array_length(l_current_result) - 1 LOOP
              l_temp_segment := replace(l_continuation_parts[l_i], '$', (l_current_result->>l_j)::text);

              -- Handle table.field syntax in continuation segments
              IF l_temp_segment ~ '^[a-z_]+\.[a-z_]+' THEN
                l_segment_table := split_part(l_temp_segment, '.', 1);
                l_field_name := split_part(l_temp_segment, '.', 2);
                -- Query the table directly to get the field value
                l_sql := format('SELECT %I FROM %I WHERE id = %L', l_field_name, l_segment_table, (l_current_result->>l_j)::int);
                EXECUTE l_sql INTO l_temp_value;
                l_temp_ids := array[l_temp_value];
              ELSE
                l_temp_ids := array(SELECT jsonb_array_elements_text(dzql.resolve_path_segment(null, null, l_temp_segment))::int);
              END IF;

              l_current_ids := l_current_ids || coalesce(l_temp_ids, '{}');
            END LOOP;
          END;
          l_current_result := to_jsonb(l_current_ids);
        ELSE
          -- Single value result
          l_current_segment := replace(l_current_segment, '$', l_current_result::text);

          -- Handle table.field syntax in continuation segments
          IF l_current_segment ~ '^[a-z_]+\.[a-z_]+' THEN
            l_table_name := split_part(l_current_segment, '.', 1);
            l_field_name := split_part(l_current_segment, '.', 2);
            -- Query the table directly to get the field value
            DECLARE
              l_field_value int;
            BEGIN
              l_sql := format('SELECT %I FROM %I WHERE id = %L', l_field_name, l_table_name, l_current_result::text::int);
              EXECUTE l_sql INTO l_field_value;
              l_current_result := to_jsonb(array[l_field_value]);
            END;
          ELSE
            l_current_result := dzql.resolve_path_segment(null, null, l_current_segment);
          END IF;
        END IF;
      ELSE
        RETURN '{}';  -- Path broken
      END IF;
    END LOOP;

    -- Convert final result to int array
    IF jsonb_typeof(l_current_result) = 'array' THEN
      l_result_ids := array(SELECT jsonb_array_elements_text(l_current_result)::int);
    ELSE
      l_result_ids := array[l_current_result::text::int];
    END IF;

    RETURN coalesce(l_result_ids, '{}');
  ELSE
    -- No continuation, process as single segment
    l_current_result := dzql.resolve_path_segment(p_table_name, p_record, p_path);

    -- Convert result to int array
    IF l_current_result IS NOT NULL THEN
      IF jsonb_typeof(l_current_result) = 'array' THEN
        l_result_ids := array(SELECT jsonb_array_elements_text(l_current_result)::int);
      ELSIF l_current_result::text != 'null' THEN
        l_result_ids := array[l_current_result::text::int];
      END IF;
    END IF;

    RETURN coalesce(l_result_ids, '{}');
  END IF;
EXCEPTION
  WHEN others THEN
    RAISE WARNING 'Failed to resolve path %: %', p_path, SQLERRM;
    RETURN '{}';
END $$;

-- Backward compatibility alias
CREATE OR REPLACE FUNCTION dzql.resolve_path_to_users(
  p_path text,
  p_record jsonb,
  p_table_name text DEFAULT NULL
) RETURNS int[]
LANGUAGE plpgsql AS $$
BEGIN
  RETURN dzql.resolve_notification_path(p_table_name, p_record, p_path);
END $$;

-- === Permission Validation ===
CREATE OR REPLACE FUNCTION dzql.validate_permission_paths(
  p_table_name text,
  p_permission_paths jsonb
) RETURNS boolean
LANGUAGE plpgsql AS $$
DECLARE
  l_operation text;
  l_paths jsonb;
BEGIN
  -- Check if permission_paths is valid JSON object
  IF jsonb_typeof(p_permission_paths) != 'object' THEN
    RETURN false;
  END IF;

  -- Check valid operation keys
  FOR l_operation IN SELECT key FROM jsonb_object_keys(p_permission_paths) AS key
  LOOP
    IF l_operation NOT IN ('create', 'update', 'delete', 'view') THEN
      RAISE WARNING 'Invalid permission operation: %', l_operation;
      RETURN false;
    END IF;

    l_paths := p_permission_paths->l_operation;
    IF jsonb_typeof(l_paths) != 'array' THEN
      RAISE WARNING 'Permission paths for % must be an array', l_operation;
      RETURN false;
    END IF;
  END LOOP;

  RETURN true;
END $$;

-- Check if user has permission for operation
CREATE OR REPLACE FUNCTION dzql.check_permission(
  p_user_id int,
  p_operation text,
  p_entity text,
  p_record jsonb
) RETURNS boolean
LANGUAGE plpgsql AS $$
DECLARE
  l_entity_config record;
  l_permission_paths jsonb;
  l_path text;
  l_allowed_users int[];
BEGIN
  -- Get entity configuration
  SELECT * INTO l_entity_config FROM dzql.entities WHERE table_name = p_entity;

  IF l_entity_config IS NULL THEN
    RETURN true; -- Entity not configured - permissive default like old version
  END IF;

  l_permission_paths := l_entity_config.permission_paths->p_operation;

  -- Empty array means public access
  IF l_permission_paths IS NULL OR jsonb_array_length(l_permission_paths) = 0 THEN
    RETURN true;
  END IF;

  -- Check each permission path
  FOR l_path IN SELECT jsonb_array_elements_text(l_permission_paths)
  LOOP
    l_allowed_users := dzql.resolve_notification_path(p_entity, p_record, l_path);

    IF p_user_id = ANY(l_allowed_users) THEN
      RETURN true;
    END IF;
  END LOOP;

  RETURN false;
END $$;

-- Resolve all notification paths for an entity to user IDs
CREATE OR REPLACE FUNCTION dzql.resolve_notification_paths(
  p_table_name text,
  p_record jsonb
) RETURNS int[]
LANGUAGE plpgsql AS $$
DECLARE
  l_entity_config record;
  l_all_user_ids int[] := '{}';
  l_path_group_key text;
  l_path_array jsonb;
  l_path text;
  l_user_ids int[];
BEGIN
  -- Get entity configuration
  SELECT * INTO l_entity_config
  FROM dzql.entities
  WHERE table_name = p_table_name;

  IF l_entity_config.notification_paths IS NULL THEN
    RETURN '{}';
  END IF;

  -- Process each notification path group (ownership, commercial, delegated, etc.)
  FOR l_path_group_key IN SELECT jsonb_object_keys(l_entity_config.notification_paths)
  LOOP
    l_path_array := l_entity_config.notification_paths->l_path_group_key;

    -- Process each path in the group
    FOR l_path IN SELECT jsonb_array_elements_text(l_path_array)
    LOOP
      l_user_ids := dzql.resolve_notification_path(p_table_name, p_record, l_path);
      l_all_user_ids := l_all_user_ids || l_user_ids;
    END LOOP;
  END LOOP;

  -- Remove duplicates and return user_ids directly (paths now resolve to user_ids)
  l_all_user_ids := array(SELECT DISTINCT unnest(l_all_user_ids));

  RETURN coalesce(l_all_user_ids, '{}');
END $$;

-- === Utility Functions ===
-- Set current user for audit trail
CREATE OR REPLACE FUNCTION dzql.set_current_user(p_user_id int)
RETURNS void
LANGUAGE sql AS $$
  SELECT set_config('app.current_user_id', p_user_id::text, false);
$$;

-- === Graph Rules Helper Functions ===
-- Validate graph rules structure
CREATE OR REPLACE FUNCTION dzql.validate_graph_rules(
  p_rules jsonb
) RETURNS boolean
LANGUAGE plpgsql AS $$
DECLARE
  l_trigger_key text;
  l_trigger_rules jsonb;
  l_rule_name text;
  l_rule_config jsonb;
  l_action jsonb;
  l_action_type text;
BEGIN
  -- Check if rules is empty or null (valid)
  IF p_rules IS NULL OR p_rules = '{}' THEN
    RETURN true;
  END IF;

  -- Validate top-level trigger types
  FOR l_trigger_key, l_trigger_rules IN SELECT * FROM jsonb_each(p_rules)
  LOOP
    -- Check valid trigger types
    IF l_trigger_key NOT IN ('on_create', 'on_update', 'on_delete', 'on_field_change') THEN
      RAISE WARNING 'Invalid trigger type: %', l_trigger_key;
      RETURN false;
    END IF;

    -- Validate each rule within the trigger
    FOR l_rule_name, l_rule_config IN SELECT * FROM jsonb_each(l_trigger_rules)
    LOOP
      -- Check required fields
      IF NOT l_rule_config ? 'actions' THEN
        RAISE WARNING 'Rule % missing required "actions" field', l_rule_name;
        RETURN false;
      END IF;

      -- Validate each action
      FOR l_action IN SELECT * FROM jsonb_array_elements(l_rule_config->'actions')
      LOOP
        l_action_type := l_action->>'type';

        -- Check valid action types
        IF l_action_type NOT IN ('create', 'update', 'delete') THEN
          RAISE WARNING 'Invalid action type: %', l_action_type;
          RETURN false;
        END IF;

        -- Check required fields per action type
        IF l_action_type IN ('create', 'update') AND NOT l_action ? 'entity' THEN
          RAISE WARNING 'Action type % requires "entity" field', l_action_type;
          RETURN false;
        END IF;

        IF l_action_type = 'create' AND NOT l_action ? 'data' THEN
          RAISE WARNING 'Action type "create" requires "data" field';
          RETURN false;
        END IF;

        IF l_action_type IN ('update', 'delete') AND NOT l_action ? 'match' THEN
          RAISE WARNING 'Action type % requires "match" field', l_action_type;
          RETURN false;
        END IF;
      END LOOP;
    END LOOP;
  END LOOP;

  RETURN true;
END $$;

-- Resolve graph variables like @user_id, @field_name, etc.
CREATE OR REPLACE FUNCTION dzql.resolve_graph_variable(
  p_variable text,
  p_record_before jsonb,
  p_record_after jsonb,
  p_user_id int
) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE
  l_result text;
  l_field_name text;
  l_record jsonb;
BEGIN
  -- Handle built-in variables
  CASE p_variable
    WHEN '@user_id' THEN
      l_result := p_user_id::text;
    WHEN '@now' THEN
      l_result := now()::text;
    WHEN '@today' THEN
      l_result := current_date::text;
    ELSE
      -- Handle field variables like @field_name or @field_name_before
      IF p_variable LIKE '@%_before' THEN
        l_field_name := substring(p_variable from 2 for length(p_variable) - 8);
        l_record := p_record_before;
      ELSE
        l_field_name := substring(p_variable from 2);
        l_record := COALESCE(p_record_after, p_record_before);
      END IF;

      l_result := l_record->>l_field_name;
  END CASE;

  RETURN l_result;
END $$;

-- Resolve data object with variable substitution
CREATE OR REPLACE FUNCTION dzql.resolve_graph_data(
  p_data jsonb,
  p_record_before jsonb,
  p_record_after jsonb,
  p_user_id int
) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE
  l_result jsonb := '{}';
  l_key text;
  l_value text;
BEGIN
  FOR l_key, l_value IN SELECT * FROM jsonb_each_text(p_data)
  LOOP
    IF l_value LIKE '@%' THEN
      l_value := dzql.resolve_graph_variable(l_value, p_record_before, p_record_after, p_user_id);
    END IF;

    l_result := l_result || jsonb_build_object(l_key, l_value);
  END LOOP;

  RETURN l_result;
END $$;
