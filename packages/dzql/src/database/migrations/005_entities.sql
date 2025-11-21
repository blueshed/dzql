-- DZQL Entity Management - Version 3.0.0
-- Entity registration, API functions creation, and graph rules execution

-- ============================================================================
-- DYNAMIC TRIGGER CREATION (for "execution": "trigger" actions)
-- ============================================================================

CREATE OR REPLACE FUNCTION dzql.create_event_trigger(
  p_table_name text,
  p_trigger_op text, -- 'on_create', 'on_update', 'on_delete'
  p_action_config jsonb
) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  l_trigger_name text;
  l_function_name text;
  l_target_function text;
  l_params jsonb;
  l_param_key text;
  l_param_value text;
  l_param_list text[];
  l_record_ref text;
  l_sql text;
BEGIN
  l_target_function := p_action_config->>'function';
  l_params := p_action_config->'params';

  -- Determine if we should use NEW or OLD record
  IF p_trigger_op = 'on_delete' THEN
    l_record_ref := 'OLD';
  ELSE
    l_record_ref := 'NEW';
  END IF;

  -- Construct the parameter list for the function call
  l_param_list := array[]::text[];
  IF l_params IS NOT NULL THEN
    FOR l_param_key, l_param_value IN SELECT * FROM jsonb_each_text(l_params)
    LOOP
      -- e.g., p_streak_id => NEW.streak_id
      l_param_list := l_param_list || format('%I => %s.%I', l_param_key, l_record_ref, right(l_param_value, -1));
    END LOOP;
  END IF;

  -- Generate unique names for the trigger and its function
  l_function_name := format('dzql_trigger_%s_%s_%s', p_table_name, p_trigger_op, l_target_function);
  l_trigger_name := format('dzql_managed_%s_%s', p_table_name, p_trigger_op);

  -- Create the trigger function
  l_sql := format(
    $SQL$
      CREATE OR REPLACE FUNCTION %I()
      RETURNS TRIGGER AS $trigger_func$
      BEGIN
        PERFORM %I(%s);
        RETURN NULL; -- Result is ignored for AFTER trigger
      END;
      $trigger_func$ LANGUAGE plpgsql;
    $SQL$,
    l_function_name,
    l_target_function,
    array_to_string(l_param_list, ', ')
  );
  EXECUTE l_sql;

  -- Create the trigger
  l_sql := format(
    $SQL$
      DROP TRIGGER IF EXISTS %I ON %I;
      CREATE TRIGGER %I
      AFTER %s ON %I
      FOR EACH ROW
      EXECUTE FUNCTION %I();
    $SQL$,
    l_trigger_name, p_table_name,
    l_trigger_name,
    CASE p_trigger_op WHEN 'on_create' THEN 'INSERT' WHEN 'on_update' THEN 'UPDATE' ELSE 'DELETE' END,
    p_table_name,
    l_function_name
  );
  EXECUTE l_sql;

  RAISE NOTICE 'DZQL: Created trigger % on % for % event', l_trigger_name, p_table_name, p_trigger_op;
END;
$$;


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
    data,
    user_id,
    notify_users
  ) VALUES (
    p_entity,
    'insert',
    jsonb_build_object('id', p_data->>'id'),
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
  INSERT INTO dzql.events (
    table_name,
    op,
    pk,
    data,
    user_id,
    notify_users
  ) VALUES (
    p_entity,
    'update',
    p_match,
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
    data,
    user_id,
    notify_users
  ) VALUES (
    p_entity,
    'delete',
    p_match,
    NULL,
    p_user_id,
    '[]'::int[]  -- Graph rule deletes don't have notification paths
  );
END $$;

-- === Validate Action ===
-- Calls a validation function and raises exception if it returns false
CREATE OR REPLACE FUNCTION dzql.execute_graph_validate(
  p_function_name text,
  p_params jsonb,
  p_error_message text DEFAULT 'Validation failed'
) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  l_result boolean;
  l_sql text;
  l_param_list text[];
  l_key text;
  l_value text;
BEGIN
  -- Validate function name (prevent SQL injection)
  IF NOT p_function_name ~ '^[a-z_][a-z0-9_]*$' THEN
    RAISE EXCEPTION 'Invalid function name: %', p_function_name;
  END IF;

  -- Build parameter list
  l_param_list := array[]::text[];
  FOR l_key, l_value IN SELECT * FROM jsonb_each_text(p_params)
  LOOP
    l_param_list := l_param_list || (l_key || ' => ' || quote_literal(l_value));
  END LOOP;

  -- Build and execute function call
  IF array_length(l_param_list, 1) > 0 THEN
    l_sql := format('SELECT %I(%s)', p_function_name, array_to_string(l_param_list, ', '));
  ELSE
    l_sql := format('SELECT %I()', p_function_name);
  END IF;

  EXECUTE l_sql INTO l_result;

  -- Raise exception if validation failed
  IF NOT COALESCE(l_result, false) THEN
    RAISE EXCEPTION '%', p_error_message;
  END IF;
END $$;

-- === Execute Action ===
-- Calls a custom function with parameters (fire-and-forget)
CREATE OR REPLACE FUNCTION dzql.execute_graph_function(
  p_function_name text,
  p_params jsonb
) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE
  l_result jsonb;
  l_sql text;
  l_param_list text[];
  l_key text;
  l_value text;
BEGIN
  -- Validate function name (prevent SQL injection)
  IF NOT p_function_name ~ '^[a-z_][a-z0-9_]*$' THEN
    RAISE EXCEPTION 'Invalid function name: %', p_function_name;
  END IF;

  -- Build parameter list
  l_param_list := array[]::text[];
  FOR l_key, l_value IN SELECT * FROM jsonb_each_text(p_params)
  LOOP
    l_param_list := l_param_list || (l_key || ' => ' || quote_literal(l_value));
  END LOOP;

  -- Build and execute function call
  IF array_length(l_param_list, 1) > 0 THEN
    l_sql := format('SELECT %I(%s)', p_function_name, array_to_string(l_param_list, ', '));
  ELSE
    l_sql := format('SELECT %I()', p_function_name);
  END IF;

  EXECUTE l_sql INTO l_result;

  RETURN COALESCE(l_result, '{}'::jsonb);
EXCEPTION WHEN OTHERS THEN
  -- Log error but don't fail the transaction
  RAISE WARNING 'Graph rule function execution failed: % (function: %)', SQLERRM, p_function_name;
  RETURN jsonb_build_object('error', SQLERRM);
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
  l_function_name text;
  l_function_params jsonb;
  l_error_message text;
  l_function_result jsonb;
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

    IF l_condition IS NOT NULL THEN
      l_condition_result := dzql.evaluate_condition(l_condition, p_record_before, p_record_after, p_user_id);
    END IF;

    IF l_condition_result THEN
      -- Execute each action in the rule
      FOR l_action IN SELECT * FROM jsonb_array_elements(l_rule_config->'actions')
      LOOP
        -- If action is handled by a native trigger, skip it in the immediate executor
        IF l_action->>'execution' = 'trigger' THEN
          CONTINUE;
        END IF;

        l_action_type := l_action->>'type';

        -- Execute the action based on type
        BEGIN
          CASE l_action_type
            -- Existing action types
            WHEN 'create' THEN
              l_target_entity := l_action->>'entity';
              l_action_data := l_action->'data';
              l_resolved_data := dzql.resolve_graph_data(l_action_data, p_record_before, p_record_after, p_user_id);
              PERFORM dzql.execute_graph_insert(l_target_entity, l_resolved_data, p_user_id);

            WHEN 'update' THEN
              l_target_entity := l_action->>'entity';
              l_action_data := l_action->'data';
              l_action_match := l_action->'match';
              l_resolved_data := dzql.resolve_graph_data(l_action_data, p_record_before, p_record_after, p_user_id);
              l_resolved_match := dzql.resolve_graph_data(l_action_match, p_record_before, p_record_after, p_user_id);
              PERFORM dzql.execute_graph_update(l_target_entity, l_resolved_match, l_resolved_data, p_user_id);

            WHEN 'delete' THEN
              l_target_entity := l_action->>'entity';
              l_action_match := l_action->'match';
              l_resolved_match := dzql.resolve_graph_data(l_action_match, p_record_before, p_record_after, p_user_id);
              PERFORM dzql.execute_graph_delete(l_target_entity, l_resolved_match, p_user_id);

            -- NEW: Validation action
            WHEN 'validate' THEN
              l_function_name := l_action->>'function';
              l_function_params := l_action->'params';
              l_error_message := COALESCE(l_action->>'error_message', 'Validation failed');
              l_resolved_data := dzql.resolve_graph_data(l_function_params, p_record_before, p_record_after, p_user_id);
              PERFORM dzql.execute_graph_validate(l_function_name, l_resolved_data, l_error_message);

            -- NEW: Execute function action
            WHEN 'execute' THEN
              l_function_name := l_action->>'function';
              l_function_params := l_action->'params';
              l_resolved_data := dzql.resolve_graph_data(l_function_params, p_record_before, p_record_after, p_user_id);
              l_function_result := dzql.execute_graph_function(l_function_name, l_resolved_data);

            ELSE
              RAISE WARNING 'Unknown graph rule action type: %', l_action_type;
          END CASE;

          -- Log successful execution
          l_execution_log := l_execution_log || jsonb_build_object(
            'rule', l_rule_name,
            'action', l_action_type,
            'status', 'success'
          );

        EXCEPTION WHEN OTHERS THEN
          -- Log error and re-raise for validate actions, otherwise just log
          l_execution_log := l_execution_log || jsonb_build_object(
            'rule', l_rule_name,
            'action', l_action_type,
            'status', 'error',
            'error', SQLERRM
          );

          -- Re-raise exceptions from validate actions to prevent operation
          IF l_action_type = 'validate' THEN
            RAISE;
          END IF;
        END;
      END LOOP;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'status', 'success',
    'trigger', l_trigger_key,
    'executed_actions', l_execution_log
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
  p_graph_rules jsonb DEFAULT '{}',
  p_field_defaults jsonb DEFAULT '{}'
) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  l_trigger_op text;
  l_rule_name text;
  l_rule_config jsonb;
  l_action jsonb;
  l_many_to_many jsonb;
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

  -- Extract many_to_many from graph_rules if present
  l_many_to_many := COALESCE(p_graph_rules->'many_to_many', '{}'::jsonb);

  -- Insert or update entity configuration
  INSERT INTO dzql.entities
    (table_name, label_field, searchable_fields, fk_includes, soft_delete, temporal_fields, notification_paths, permission_paths, graph_rules, field_defaults, many_to_many)
  VALUES
    (p_table_name, p_label_field, p_searchable_fields, p_fk_includes, p_soft_delete, p_temporal_fields, p_notification_paths, p_permission_paths, p_graph_rules, p_field_defaults, l_many_to_many)
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

  -- Create API functions for this entity
  PERFORM dzql.create_entity_functions(p_table_name);

  -- Create managed triggers for any 'execution: trigger' actions
  IF p_graph_rules IS NOT NULL AND p_graph_rules != '{}' THEN
    FOREACH l_trigger_op IN ARRAY ARRAY['on_create', 'on_update', 'on_delete']
    LOOP
      IF p_graph_rules ? l_trigger_op THEN
        FOR l_rule_name, l_rule_config IN SELECT * FROM jsonb_each(p_graph_rules->l_trigger_op)
        LOOP
          FOR l_action IN SELECT * FROM jsonb_array_elements(l_rule_config->'actions')
          LOOP
            IF l_action->>'execution' = 'trigger' THEN
              PERFORM dzql.create_event_trigger(p_table_name, l_trigger_op, l_action);
            END IF;
          END LOOP;
        END LOOP;
      END IF;
    END LOOP;
  END IF;

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
