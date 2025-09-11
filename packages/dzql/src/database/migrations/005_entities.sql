-- DZQL Entity Management - Version 3.0.0
-- Entity registration, API functions creation, and graph rules execution

-- ============================================================================
-- GRAPH RULES EXECUTION ENGINE
-- ============================================================================

-- Execute graph insert action
CREATE OR REPLACE FUNCTION dzql.execute_graph_insert(
  p_entity text,
  p_data jsonb,
  p_user_id int
) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  l_cols text[];
  l_vals text[];
  l_col_name text;
  l_sql_stmt text;
BEGIN
  -- Graph rules are trusted server-side operations, skip permission checks

  -- Build column and value lists
  FOR l_col_name IN SELECT * FROM jsonb_object_keys(p_data)
  LOOP
    l_cols := l_cols || l_col_name;
    l_vals := l_vals || quote_literal(p_data->>l_col_name);
  END LOOP;

  -- Build and execute INSERT statement
  l_sql_stmt := format('INSERT INTO %I (%s) VALUES (%s)',
    p_entity,
    array_to_string(l_cols, ', '),
    array_to_string(l_vals, ', ')
  );

  EXECUTE l_sql_stmt;

  -- Create event for graph rule action
  INSERT INTO dzql.events (
    table_name,
    op,
    pk,
    before,
    after,
    user_id,
    notify_users
  ) VALUES (
    p_entity,
    'insert',
    jsonb_build_object('id', p_data->>'id'),
    NULL,
    p_data,
    p_user_id,
    dzql.resolve_notification_paths(p_entity, p_data)
  );
END $$;

-- Execute graph update action
CREATE OR REPLACE FUNCTION dzql.execute_graph_update(
  p_entity text,
  p_match jsonb,
  p_data jsonb,
  p_user_id int
) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  l_set_clauses text[];
  l_where_clauses text[];
  l_col_name text;
  l_sql_stmt text;
BEGIN
  -- Check permissions before executing graph rule action
  -- Graph rules are trusted server-side operations, skip permission checks

  -- Build SET clauses
  FOR l_col_name IN SELECT * FROM jsonb_object_keys(p_data)
  LOOP
    l_set_clauses := l_set_clauses || format('%I = %L', l_col_name, p_data->>l_col_name);
  END LOOP;

  -- Build WHERE clauses
  FOR l_col_name IN SELECT * FROM jsonb_object_keys(p_match)
  LOOP
    l_where_clauses := l_where_clauses || format('%I = %L', l_col_name, p_match->>l_col_name);
  END LOOP;

  -- Build and execute UPDATE statement
  l_sql_stmt := format('UPDATE %I SET %s WHERE %s',
    p_entity,
    array_to_string(l_set_clauses, ', '),
    array_to_string(l_where_clauses, ' AND ')
  );

  EXECUTE l_sql_stmt;

  -- Create event for graph rule action
  -- Note: We don't have the before/after data here, just logging the update occurred
  INSERT INTO dzql.events (
    table_name,
    op,
    pk,
    before,
    after,
    user_id,
    notify_users
  ) VALUES (
    p_entity,
    'update',
    p_match,
    NULL,  -- We don't have the before state in this context
    p_data,
    p_user_id,
    '[]'::int[]  -- Graph rule updates don't have notification paths
  );
END $$;

-- Execute graph delete action
CREATE OR REPLACE FUNCTION dzql.execute_graph_delete(
  p_entity text,
  p_match jsonb,
  p_user_id int
) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  l_where_clauses text[];
  l_col_name text;
  l_sql_stmt text;
BEGIN
  -- Check permissions before executing graph rule action
  -- Graph rules are trusted server-side operations, skip permission checks
  -- Build WHERE clauses
  FOR l_col_name IN SELECT * FROM jsonb_object_keys(p_match)
  LOOP
    l_where_clauses := l_where_clauses || format('%I = %L', l_col_name, p_match->>l_col_name);
  END LOOP;

  -- Build and execute DELETE statement
  l_sql_stmt := format('DELETE FROM %I WHERE %s',
    p_entity,
    array_to_string(l_where_clauses, ' AND ')
  );

  EXECUTE l_sql_stmt;

  -- Create event for graph rule action
  INSERT INTO dzql.events (
    table_name,
    op,
    pk,
    before,
    after,
    user_id,
    notify_users
  ) VALUES (
    p_entity,
    'delete',
    p_match,
    NULL,  -- We don't have the before state in this context
    NULL,
    p_user_id,
    '[]'::int[]  -- Graph rule deletes don't have notification paths
  );
END $$;

-- Main graph rules execution engine
CREATE OR REPLACE FUNCTION dzql.execute_graph_rules(
  p_table_name text,
  p_operation text,  -- 'insert', 'update', 'delete'
  p_record_before jsonb,
  p_record_after jsonb,
  p_user_id int
) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE
  l_entity_config record;
  l_graph_rules jsonb;
  l_trigger_key text;
  l_trigger_rules jsonb;
  l_rule_name text;
  l_rule_config jsonb;
  l_action jsonb;
  l_action_type text;
  l_target_entity text;
  l_action_data jsonb;
  l_action_match jsonb;
  l_resolved_data jsonb;
  l_resolved_match jsonb;
  l_execution_log jsonb := '[]'::jsonb;
  l_condition text;
  l_condition_result boolean;
BEGIN
  -- Get entity configuration
  SELECT * INTO l_entity_config FROM dzql.entities WHERE table_name = p_table_name;

  IF l_entity_config IS NULL THEN
    RETURN jsonb_build_object('status', 'entity_not_found');
  END IF;

  l_graph_rules := l_entity_config.graph_rules;

  -- Early exit if no graph rules
  IF l_graph_rules IS NULL OR l_graph_rules = '{}' THEN
    RETURN jsonb_build_object('status', 'no_rules');
  END IF;

  -- Map operation to trigger key
  l_trigger_key := CASE p_operation
    WHEN 'insert' THEN 'on_create'
    WHEN 'update' THEN 'on_update'
    WHEN 'delete' THEN 'on_delete'
    ELSE NULL
  END;

  IF l_trigger_key IS NULL THEN
    RETURN jsonb_build_object('status', 'invalid_operation', 'operation', p_operation);
  END IF;

  -- Get rules for this trigger
  l_trigger_rules := l_graph_rules->l_trigger_key;

  IF l_trigger_rules IS NULL OR l_trigger_rules = '{}' THEN
    RETURN jsonb_build_object('status', 'no_rules_for_trigger', 'trigger', l_trigger_key);
  END IF;

  -- Execute each rule
  FOR l_rule_name, l_rule_config IN SELECT * FROM jsonb_each(l_trigger_rules)
  LOOP
    -- Check condition if present
    l_condition := l_rule_config->>'condition';
    l_condition_result := true;  -- Default to true if no condition

    -- TODO: Implement condition evaluation
    -- IF l_condition IS NOT NULL THEN
    --   l_condition_result := dzql.evaluate_condition(l_condition, p_record_before, p_record_after, p_user_id);
    -- END IF;

    IF l_condition_result THEN
      -- Execute each action in the rule
      FOR l_action IN SELECT * FROM jsonb_array_elements(l_rule_config->'actions')
      LOOP
        l_action_type := l_action->>'type';
        l_target_entity := l_action->>'entity';
        l_action_data := l_action->'data';
        l_action_match := l_action->'match';

        -- Resolve variables in data and match objects
        IF l_action_data IS NOT NULL THEN
          l_resolved_data := dzql.resolve_graph_data(l_action_data, p_record_before, p_record_after, p_user_id);
        END IF;

        IF l_action_match IS NOT NULL THEN
          l_resolved_match := dzql.resolve_graph_data(l_action_match, p_record_before, p_record_after, p_user_id);
        END IF;

        -- Execute the action
        BEGIN
          CASE l_action_type
            WHEN 'create' THEN
              PERFORM dzql.execute_graph_insert(l_target_entity, l_resolved_data, p_user_id);

            WHEN 'update' THEN
              PERFORM dzql.execute_graph_update(l_target_entity, l_resolved_match, l_resolved_data, p_user_id);

            WHEN 'delete' THEN
              PERFORM dzql.execute_graph_delete(l_target_entity, l_resolved_match, p_user_id);
          END CASE;

          -- Log successful execution
          l_execution_log := l_execution_log || jsonb_build_object(
            'rule', l_rule_name,
            'action_type', l_action_type,
            'target_entity', l_target_entity,
            'status', 'success'
          );

        EXCEPTION
          WHEN OTHERS THEN
            -- Log failed execution but continue with other rules
            l_execution_log := l_execution_log || jsonb_build_object(
              'rule', l_rule_name,
              'action_type', l_action_type,
              'target_entity', l_target_entity,
              'status', 'error',
              'error', SQLERRM
            );
        END;
      END LOOP;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'status', 'completed',
    'trigger', l_trigger_key,
    'execution_log', l_execution_log
  );
END $$;

-- ============================================================================
-- API FUNCTION CREATION
-- ============================================================================

-- Create API functions for an entity
CREATE OR REPLACE FUNCTION dzql.create_entity_functions(p_table_name text)
RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  l_get_fn_name text;
  l_save_fn_name text;
  l_delete_fn_name text;
  l_lookup_fn_name text;
  l_search_fn_name text;
BEGIN
  -- Generate function names
  l_get_fn_name := 'get_' || p_table_name;
  l_save_fn_name := 'save_' || p_table_name;
  l_delete_fn_name := 'delete_' || p_table_name;
  l_lookup_fn_name := 'lookup_' || p_table_name;
  l_search_fn_name := 'search_' || p_table_name;

  -- Create GET function
  EXECUTE format('
    CREATE OR REPLACE FUNCTION dzql.%I(p_args jsonb, p_user_id int)
    RETURNS jsonb
    LANGUAGE sql
    AS $func$
      SELECT dzql.generic_get(%L, p_args, p_user_id);
    $func$;
  ', l_get_fn_name, p_table_name);

  -- Create SAVE function
  EXECUTE format('
    CREATE OR REPLACE FUNCTION dzql.%I(p_args jsonb, p_user_id int)
    RETURNS jsonb
    LANGUAGE sql
    AS $func$
      SELECT dzql.generic_save(%L, p_args, p_user_id);
    $func$;
  ', l_save_fn_name, p_table_name);

  -- Create DELETE function
  EXECUTE format('
    CREATE OR REPLACE FUNCTION dzql.%I(p_args jsonb, p_user_id int)
    RETURNS jsonb
    LANGUAGE sql
    AS $func$
      SELECT dzql.generic_delete(%L, p_args, p_user_id);
    $func$;
  ', l_delete_fn_name, p_table_name);

  -- Create LOOKUP function
  EXECUTE format('
    CREATE OR REPLACE FUNCTION dzql.%I(p_args jsonb, p_user_id int)
    RETURNS jsonb
    LANGUAGE sql
    AS $func$
      SELECT dzql.generic_lookup(%L, p_args, p_user_id);
    $func$;
  ', l_lookup_fn_name, p_table_name);

  -- Create SEARCH function
  EXECUTE format('
    CREATE OR REPLACE FUNCTION dzql.%I(p_args jsonb, p_user_id int)
    RETURNS jsonb
    LANGUAGE sql
    AS $func$
      SELECT dzql.generic_search(%L, p_args, p_user_id);
    $func$;
  ', l_search_fn_name, p_table_name);
END $$;

-- ============================================================================
-- ENTITY REGISTRATION
-- ============================================================================

-- Register entity function with full graph rules support
CREATE OR REPLACE FUNCTION dzql.register_entity(
  p_table_name text,
  p_label_field text,
  p_searchable_fields text[],
  p_fk_includes jsonb DEFAULT '{}',
  p_soft_delete boolean DEFAULT false,
  p_temporal_fields jsonb DEFAULT '{}',
  p_notification_paths jsonb DEFAULT '{}',
  p_permission_paths jsonb DEFAULT '{}',
  p_graph_rules jsonb DEFAULT '{}'
) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  -- Validate permission paths if provided
  IF p_permission_paths IS NOT NULL AND p_permission_paths != '{}' THEN
    IF NOT dzql.validate_permission_paths(p_table_name, p_permission_paths) THEN
      RAISE EXCEPTION 'Invalid permission paths for entity %', p_table_name;
    END IF;
  END IF;

  -- Validate graph rules if provided
  IF p_graph_rules IS NOT NULL AND p_graph_rules != '{}' THEN
    IF NOT dzql.validate_graph_rules(p_graph_rules) THEN
      RAISE EXCEPTION 'Invalid graph rules for entity %', p_table_name;
    END IF;
  END IF;

  -- Insert or update entity configuration
  INSERT INTO dzql.entities
    (table_name, label_field, searchable_fields, fk_includes, soft_delete, temporal_fields, notification_paths, permission_paths, graph_rules)
  VALUES
    (p_table_name, p_label_field, p_searchable_fields, p_fk_includes, p_soft_delete, p_temporal_fields, p_notification_paths, p_permission_paths, p_graph_rules)
  ON CONFLICT (table_name) DO UPDATE SET
    label_field = EXCLUDED.label_field,
    searchable_fields = EXCLUDED.searchable_fields,
    fk_includes = EXCLUDED.fk_includes,
    soft_delete = EXCLUDED.soft_delete,
    temporal_fields = EXCLUDED.temporal_fields,
    notification_paths = EXCLUDED.notification_paths,
    permission_paths = EXCLUDED.permission_paths,
    graph_rules = EXCLUDED.graph_rules;

  -- Create API functions for this entity
  PERFORM dzql.create_entity_functions(p_table_name);

  -- Log successful registration
  RAISE NOTICE 'DZQL: Entity % registered successfully with graph rules support', p_table_name;
END $$;

-- ============================================================================
-- ENTITY UTILITIES
-- ============================================================================

-- Unregister an entity (removes configuration and API functions)
CREATE OR REPLACE FUNCTION dzql.unregister_entity(p_table_name text)
RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  l_fn_names text[] := ARRAY['get_', 'save_', 'delete_', 'lookup_', 'search_'];
  l_fn_name text;
BEGIN
  -- Remove entity configuration
  DELETE FROM dzql.entities WHERE table_name = p_table_name;

  -- Drop API functions
  FOREACH l_fn_name IN ARRAY l_fn_names
  LOOP
    EXECUTE format('DROP FUNCTION IF EXISTS dzql.%I(jsonb, int)', l_fn_name || p_table_name);
  END LOOP;

  RAISE NOTICE 'DZQL: Entity % unregistered successfully', p_table_name;
END $$;

-- List all registered entities
CREATE OR REPLACE FUNCTION dzql.list_entities()
RETURNS TABLE(
  table_name text,
  label_field text,
  searchable_fields text[],
  has_fk_includes boolean,
  soft_delete boolean,
  has_temporal_fields boolean,
  has_notification_paths boolean,
  has_permission_paths boolean,
  has_graph_rules boolean
)
LANGUAGE sql AS $$
  SELECT
    e.table_name,
    e.label_field,
    e.searchable_fields,
    (e.fk_includes IS NOT NULL AND e.fk_includes != '{}') as has_fk_includes,
    e.soft_delete,
    (e.temporal_fields IS NOT NULL AND e.temporal_fields != '{}') as has_temporal_fields,
    (e.notification_paths IS NOT NULL AND e.notification_paths != '{}') as has_notification_paths,
    (e.permission_paths IS NOT NULL AND e.permission_paths != '{}') as has_permission_paths,
    (e.graph_rules IS NOT NULL AND e.graph_rules != '{}') as has_graph_rules
  FROM dzql.entities e
  ORDER BY e.table_name;
$$;

-- Get detailed entity configuration
CREATE OR REPLACE FUNCTION dzql.get_entity_config(p_table_name text)
RETURNS jsonb
LANGUAGE sql AS $$
  SELECT to_jsonb(e.*)
  FROM dzql.entities e
  WHERE e.table_name = p_table_name;
$$;

-- Update entity graph rules only
CREATE OR REPLACE FUNCTION dzql.update_entity_graph_rules(
  p_table_name text,
  p_graph_rules jsonb
) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  -- Validate graph rules
  IF p_graph_rules IS NOT NULL AND p_graph_rules != '{}' THEN
    IF NOT dzql.validate_graph_rules(p_graph_rules) THEN
      RAISE EXCEPTION 'Invalid graph rules for entity %', p_table_name;
    END IF;
  END IF;

  -- Update only graph rules
  UPDATE dzql.entities
  SET graph_rules = p_graph_rules
  WHERE table_name = p_table_name;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Entity % not found', p_table_name;
  END IF;

  RAISE NOTICE 'DZQL: Graph rules updated for entity %', p_table_name;
END $$;
