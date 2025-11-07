-- Graph Rules Extensions: Validation and Custom Function Execution
-- Adds support for 'validate' and 'execute' action types in graph rules

-- === Condition Evaluation ===
-- Evaluates a condition string with variable substitution
CREATE OR REPLACE FUNCTION dzql.evaluate_condition(
  p_condition text,
  p_record_before jsonb,
  p_record_after jsonb,
  p_user_id int
) RETURNS boolean
LANGUAGE plpgsql AS $$
DECLARE
  l_resolved_condition text;
  l_result boolean;
  l_match_array text[];
  l_field_name text;
  l_field_value text;
BEGIN
  -- Replace variables in condition
  l_resolved_condition := p_condition;

  -- Replace @before.field references
  IF p_record_before IS NOT NULL THEN
    LOOP
      l_match_array := regexp_match(l_resolved_condition, '@before\.(\w+)');
      EXIT WHEN l_match_array IS NULL;

      l_field_name := l_match_array[1];
      l_field_value := COALESCE(p_record_before->>l_field_name, 'null');
      l_resolved_condition := regexp_replace(
        l_resolved_condition,
        '@before\.' || l_field_name,
        quote_literal(l_field_value),
        1
      );
    END LOOP;
  END IF;

  -- Replace @after.field references
  IF p_record_after IS NOT NULL THEN
    LOOP
      l_match_array := regexp_match(l_resolved_condition, '@after\.(\w+)');
      EXIT WHEN l_match_array IS NULL;

      l_field_name := l_match_array[1];
      l_field_value := COALESCE(p_record_after->>l_field_name, 'null');
      l_resolved_condition := regexp_replace(
        l_resolved_condition,
        '@after\.' || l_field_name,
        quote_literal(l_field_value),
        1
      );
    END LOOP;
  END IF;

  -- Replace @user_id
  l_resolved_condition := replace(l_resolved_condition, '@user_id', p_user_id::text);

  -- Replace @id (use after if available, otherwise before)
  IF p_record_after IS NOT NULL THEN
    l_resolved_condition := replace(l_resolved_condition, '@id',
      COALESCE(p_record_after->>'id', 'null'));
  ELSIF p_record_before IS NOT NULL THEN
    l_resolved_condition := replace(l_resolved_condition, '@id',
      COALESCE(p_record_before->>'id', 'null'));
  END IF;

  -- Execute the condition
  BEGIN
    EXECUTE 'SELECT (' || l_resolved_condition || ')::boolean' INTO l_result;
    RETURN COALESCE(l_result, false);
  EXCEPTION WHEN OTHERS THEN
    -- If condition evaluation fails, log and return false
    RAISE WARNING 'Graph rule condition evaluation failed: % (condition: %)', SQLERRM, l_resolved_condition;
    RETURN false;
  END;
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

-- === Update execute_graph_rules to support new action types ===
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

-- === Update validate_graph_rules to accept new action types ===
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

        -- Check valid action types (includes new 'validate' and 'execute' types)
        IF l_action_type NOT IN ('create', 'update', 'delete', 'validate', 'execute') THEN
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

        -- Validate new action types
        IF l_action_type IN ('validate', 'execute') AND NOT l_action ? 'function' THEN
          RAISE WARNING 'Action type % requires "function" field', l_action_type;
          RETURN false;
        END IF;

        IF l_action_type IN ('validate', 'execute') AND NOT l_action ? 'params' THEN
          RAISE WARNING 'Action type % requires "params" field', l_action_type;
          RETURN false;
        END IF;
      END LOOP;
    END LOOP;
  END LOOP;

  RETURN true;
END $$;
