-- DZQL Core Operations - Version 3.0.0
-- Generic CRUD operations for entities (get, save, delete, lookup)

-- === Foreign Key Resolution Helpers ===
-- Resolve direct foreign key (field -> table lookup)
CREATE OR REPLACE FUNCTION dzql.resolve_direct_fk(
  p_record jsonb,
  p_fk_field text,
  p_target_table text,
  p_on_date timestamptz DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE
  l_fk_id text;
  l_temporal_config record;
  l_temporal_filter text;
  l_sql text;
  l_result jsonb;
BEGIN
  -- Get foreign key value
  -- First try the field directly, then try with _id suffix
  l_fk_id := p_record->>p_fk_field;

  IF l_fk_id IS NULL THEN
    -- Try with _id suffix (e.g., 'org' -> 'org_id')
    l_fk_id := p_record->>(p_fk_field || '_id');
  END IF;

  IF l_fk_id IS NULL THEN
    RETURN NULL;
  END IF;

  -- Get temporal configuration for target table
  SELECT temporal_fields INTO l_temporal_config
  FROM dzql.entities
  WHERE table_name = p_target_table;

  -- Build temporal filter
  l_temporal_filter := dzql.apply_temporal_filter(
    p_target_table::regclass,
    COALESCE(l_temporal_config.temporal_fields, '{}'::jsonb),
    p_on_date
  );

  -- Build and execute query
  l_sql := format('SELECT to_jsonb(t.*) FROM %I t WHERE id = %L%s',
    p_target_table, l_fk_id, l_temporal_filter);

  EXECUTE l_sql INTO l_result;

  RETURN l_result;
END $$;

-- Resolve reverse foreign key (table.field -> this record)
CREATE OR REPLACE FUNCTION dzql.resolve_reverse_fk(
  p_record jsonb,
  p_result_field text,
  p_table_field text,
  p_on_date timestamptz DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE
  l_parts text[];
  l_target_table text;
  l_target_field text;
  l_record_id text;
  l_temporal_config record;
  l_temporal_filter text;
  l_sql text;
  l_result jsonb;
BEGIN
  -- Parse "table.field" format
  l_parts := string_to_array(p_table_field, '.');
  IF array_length(l_parts, 1) != 2 THEN
    RETURN NULL;
  END IF;

  l_target_table := l_parts[1];
  l_target_field := l_parts[2];
  l_record_id := p_record->>'id';

  IF l_record_id IS NULL THEN
    RETURN NULL;
  END IF;

  -- Get temporal configuration for target table
  SELECT temporal_fields INTO l_temporal_config
  FROM dzql.entities
  WHERE table_name = l_target_table;

  -- Build temporal filter
  l_temporal_filter := dzql.apply_temporal_filter(
    l_target_table::regclass,
    COALESCE(l_temporal_config.temporal_fields, '{}'::jsonb),
    p_on_date
  );

  -- Build and execute query
  l_sql := format('SELECT COALESCE(jsonb_agg(to_jsonb(t.*)), ''[]''::jsonb) FROM %I t WHERE %I = %L%s',
    l_target_table, l_target_field, l_record_id, l_temporal_filter);

  EXECUTE l_sql INTO l_result;

  RETURN l_result;
END $$;

-- === Generic GET Operation ===
-- Generic GET with foreign key dereferencing and temporal filtering
CREATE OR REPLACE FUNCTION dzql.generic_get(
  p_entity text,
  p_args jsonb,
  p_user_id int
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  l_entity_config record;
  l_pk_field text;
  l_pk_value text;
  l_on_date timestamptz;
  l_base_sql text;
  l_temporal_filter text;
  l_result jsonb;
  l_fk_includes jsonb;
  l_key text;
  l_value text;
  l_fk_result jsonb;
  l_pk_cols text[];
  l_is_compound_key boolean;
  l_lookup_result jsonb;
BEGIN
  -- Get entity configuration
  SELECT * INTO l_entity_config FROM dzql.entities WHERE table_name = p_entity;

  IF l_entity_config IS NULL THEN
    RAISE EXCEPTION 'DZQL: entity % not configured', p_entity;
  END IF;

  -- Get primary key columns to check if this is a compound key
  SELECT array_agg(a.attname ORDER BY a.attnum)
    INTO l_pk_cols
  FROM pg_index i
  JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
  WHERE i.indrelid = p_entity::regclass AND i.indisprimary;

  -- Check if this is a compound key
  l_is_compound_key := array_length(l_pk_cols, 1) > 1;

  -- For compound keys, use LOOKUP logic and return the label
  IF l_is_compound_key THEN
    l_lookup_result := dzql.generic_lookup(p_entity, p_args, p_user_id);

    IF l_lookup_result IS NOT NULL AND jsonb_array_length(l_lookup_result) > 0 THEN
      RETURN l_lookup_result->0->'label';
    ELSE
      RETURN NULL;
    END IF;
  END IF;

  -- Extract primary key
  l_pk_field := 'id';
  l_pk_value := p_args ->> ('p_' || p_entity || '_id');
  IF l_pk_value IS NULL THEN
    l_pk_value := p_args ->> 'p_id';
  END IF;
  IF l_pk_value IS NULL THEN
    l_pk_value := p_args ->> 'id';
  END IF;

  IF l_pk_value IS NULL THEN
    RAISE EXCEPTION 'DZQL: no primary key provided for entity %', p_entity;
  END IF;

  -- Extract temporal parameter
  l_on_date := (p_args ->> 'on_date')::timestamptz;

  -- Build temporal filter
  l_temporal_filter := dzql.apply_temporal_filter(
    p_entity::regclass,
    l_entity_config.temporal_fields,
    l_on_date
  );

  -- Build base query
  l_base_sql := format('SELECT to_jsonb(t.*) FROM %I t WHERE %I = %L%s',
                    p_entity, l_pk_field, l_pk_value, l_temporal_filter);

  EXECUTE l_base_sql INTO l_result;

  IF l_result IS NULL THEN
    RAISE EXCEPTION 'DZQL: record not found in %', p_entity;
  END IF;

  -- Check view permission
  IF NOT dzql.check_permission(p_user_id, 'view', p_entity, l_result) THEN
    RAISE EXCEPTION 'Permission denied: view on %', p_entity;
  END IF;

  -- Dereference foreign keys
  l_fk_includes := l_entity_config.fk_includes;
  IF l_fk_includes IS NOT NULL AND l_fk_includes != '{}' THEN
    FOR l_key, l_value IN SELECT key, value FROM jsonb_each_text(l_fk_includes)
    LOOP
      -- Handle different FK reference formats
      IF l_value LIKE '%.%' THEN
        -- Format: "table.field" for reverse foreign keys
        l_fk_result := dzql.resolve_reverse_fk(l_result, l_key, l_value, l_on_date);
      ELSIF l_key = l_value THEN
        -- When key equals value (e.g., "sites": "sites"), it's a reverse FK
        -- The target table has a field named {entity_singular}_id pointing back to this entity
        -- Convert plural entity name to singular (simple rule: remove trailing 's')
        l_fk_result := dzql.resolve_reverse_fk(l_result, l_key,
          l_value || '.' || regexp_replace(p_entity, 's$', '') || '_id', l_on_date);
      ELSE
        -- Format: "table" for direct foreign keys
        l_fk_result := dzql.resolve_direct_fk(l_result, l_key, l_value, l_on_date);
      END IF;

      IF l_fk_result IS NOT NULL THEN
        l_result := l_result || jsonb_build_object(l_key, l_fk_result);
      END IF;
    END LOOP;
  END IF;

  RETURN l_result;
END $$;

-- === Generic SAVE Operation ===
-- Generic SAVE with upsert capability and graph rules
CREATE OR REPLACE FUNCTION dzql.generic_save(
  p_entity text,
  p_args jsonb,
  p_user_id int
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  l_entity_config record;
  l_pk_cols text[];
  l_cols text[];
  l_vals text[];
  l_set_clauses text[];
  l_col_name text;
  l_sql_stmt text;
  l_existing_record jsonb;
  l_merged_data jsonb;
  l_result jsonb;
  l_record_id text;
  l_args_json jsonb;
  l_operation text;
  l_permission_record jsonb;
  l_graph_rules_result jsonb;
  l_is_insert boolean := false;
  l_pk_where text;
  l_pk_where_clauses text[] := array[]::text[];
  i int;
BEGIN
  -- Ensure p_args is proper JSONB
  l_args_json := p_args::jsonb;

  -- Get entity configuration
  SELECT * INTO l_entity_config FROM dzql.entities WHERE table_name = p_entity;

  IF l_entity_config IS NULL THEN
    RAISE EXCEPTION 'DZQL: entity % not configured', p_entity;
  END IF;

  -- Get primary key columns
  SELECT array_agg(a.attname ORDER BY a.attnum)
    INTO l_pk_cols
  FROM pg_index i
  JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
  WHERE i.indrelid = p_entity::regclass AND i.indisprimary;

  IF l_pk_cols IS NULL THEN
    RAISE EXCEPTION 'DZQL: entity % has no primary key', p_entity;
  END IF;

  -- Check if this is an update (has all PKs) or insert (missing any PK)
  -- Check if any PK column is missing
  FOR i IN 1..array_length(l_pk_cols, 1) LOOP
    IF l_args_json ->> l_pk_cols[i] IS NULL THEN
      l_is_insert := true;
      EXIT;
    END IF;
  END LOOP;

  -- If all PK columns provided, check if record exists
  IF NOT l_is_insert THEN
    -- Build composite WHERE clause for existing record check
    FOR i IN 1..array_length(l_pk_cols, 1) LOOP
      l_pk_where_clauses := l_pk_where_clauses ||
        format('%I = %L', l_pk_cols[i], l_args_json ->> l_pk_cols[i]);
    END LOOP;
    l_pk_where := array_to_string(l_pk_where_clauses, ' AND ');

    -- Get existing record using composite WHERE clause
    l_sql_stmt := format('SELECT to_jsonb(t.*) FROM %I t WHERE %s', p_entity, l_pk_where);
    EXECUTE l_sql_stmt INTO l_existing_record;

    IF l_existing_record IS NULL THEN
      -- Record doesn't exist. For composite keys, treat as INSERT.
      -- For single-column PKs, this is an error (user provided non-existent ID).
      IF array_length(l_pk_cols, 1) > 1 THEN
        -- Composite key: treat as INSERT
        l_is_insert := true;
      ELSE
        -- Single PK: this is an error
        RAISE EXCEPTION 'DZQL: record with %=% not found in %',
          l_pk_cols[1], l_args_json ->> l_pk_cols[1], p_entity;
      END IF;
    END IF;
  END IF;

  IF NOT l_is_insert THEN
    -- UPDATE: Merge with existing record

    -- Check update permission on existing record
    l_operation := 'update';
    l_permission_record := l_existing_record;
    IF NOT dzql.check_permission(p_user_id, l_operation, p_entity, l_permission_record) THEN
      RAISE EXCEPTION 'Permission denied: % on %', l_operation, p_entity;
    END IF;

    -- Merge existing data with new data (new data takes precedence)
    l_merged_data := l_existing_record || l_args_json;

    -- Build SET clauses for UPDATE
    l_set_clauses := array[]::text[];
    FOR l_col_name IN SELECT jsonb_object_keys(l_merged_data)
    LOOP
      -- Don't update any primary key columns
      IF NOT (l_col_name = ANY(l_pk_cols)) THEN
        l_set_clauses := l_set_clauses || format('%I = %L', l_col_name, l_merged_data ->> l_col_name);
      END IF;
    END LOOP;

    -- Execute UPDATE using composite WHERE clause
    l_sql_stmt := format('UPDATE %I SET %s WHERE %s RETURNING to_jsonb(%I.*)',
                      p_entity,
                      array_to_string(l_set_clauses, ', '),
                      l_pk_where,
                      p_entity);
    EXECUTE l_sql_stmt INTO l_result;

    -- Execute graph rules for update
    l_graph_rules_result := dzql.execute_graph_rules(
      p_entity,
      'update',
      l_existing_record,
      l_result,
      p_user_id
    );

  ELSE
    -- INSERT: Use provided values, let database handle defaults

    -- Check create permission on new values
    l_operation := 'create';
    l_permission_record := l_args_json;
    IF NOT dzql.check_permission(p_user_id, l_operation, p_entity, l_permission_record) THEN
      RAISE EXCEPTION 'Permission denied: % on %', l_operation, p_entity;
    END IF;

    l_cols := array[]::text[];
    l_vals := array[]::text[];

    FOR l_col_name IN SELECT jsonb_object_keys(l_args_json)
    LOOP
      IF l_args_json ->> l_col_name IS NOT NULL AND l_args_json ->> l_col_name != '' THEN
        l_cols := l_cols || quote_ident(l_col_name);
        l_vals := l_vals || quote_literal(l_args_json ->> l_col_name);
      END IF;
    END LOOP;

    IF array_length(l_cols, 1) = 0 THEN
      RAISE EXCEPTION 'DZQL: no valid columns provided for insert into %', p_entity;
    END IF;

    -- Execute INSERT
    l_sql_stmt := format('INSERT INTO %I (%s) VALUES (%s) RETURNING to_jsonb(%I.*)',
                      p_entity,
                      array_to_string(l_cols, ', '),
                      array_to_string(l_vals, ', '),
                      p_entity);
    EXECUTE l_sql_stmt INTO l_result;

    -- Execute graph rules for insert
    l_graph_rules_result := dzql.execute_graph_rules(
      p_entity,
      'insert',
      NULL,
      l_result,
      p_user_id
    );
  END IF;

  -- Execute graph rules for the appropriate operation
  l_graph_rules_result := dzql.execute_graph_rules(
    p_entity,
    CASE WHEN l_is_insert THEN 'insert' ELSE 'update' END,
    CASE WHEN l_is_insert THEN NULL ELSE l_existing_record END,
    l_result,
    p_user_id
  );

  -- Create event for the operation (INSERT or UPDATE)
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
    CASE WHEN l_is_insert THEN 'insert' ELSE 'update' END,
    (
      SELECT jsonb_object_agg(col, l_result ->> col)
      FROM unnest(l_pk_cols) AS col
    ),
    CASE WHEN NOT l_is_insert THEN l_existing_record ELSE NULL END,
    l_result,
    p_user_id,
    dzql.resolve_notification_paths(p_entity, l_result)
  );

  -- Add graph rules execution summary to result if rules were executed
  IF l_graph_rules_result IS NOT NULL AND l_graph_rules_result != '{}' THEN
    l_result := l_result || jsonb_build_object('_graph_rules', l_graph_rules_result);
  END IF;

  RETURN l_result;
END $$;

-- === Generic DELETE Operation ===
-- Generic DELETE with cascading support and graph rules
CREATE OR REPLACE FUNCTION dzql.generic_delete(
  p_entity text,
  p_args jsonb,
  p_user_id int
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  l_entity_config record;
  l_pk_cols text[];
  l_pk_where text;
  l_pk_where_clauses text[] := array[]::text[];
  l_record jsonb;
  l_graph_rules_result jsonb;
  i int;
  l_pk_provided boolean := true;
BEGIN
  -- Get entity configuration
  SELECT * INTO l_entity_config FROM dzql.entities WHERE table_name = p_entity;

  IF l_entity_config IS NULL THEN
    RAISE EXCEPTION 'DZQL: entity % not configured', p_entity;
  END IF;

  -- Get primary key columns
  SELECT array_agg(a.attname ORDER BY a.attnum)
    INTO l_pk_cols
  FROM pg_index i
  JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
  WHERE i.indrelid = p_entity::regclass AND i.indisprimary;

  IF l_pk_cols IS NULL THEN
    RAISE EXCEPTION 'DZQL: entity % has no primary key', p_entity;
  END IF;

  -- Build composite WHERE clause from provided PK values
  FOR i IN 1..array_length(l_pk_cols, 1) LOOP
    DECLARE
      l_pk_value text := p_args ->> l_pk_cols[i];
    BEGIN
      IF l_pk_value IS NULL THEN
        l_pk_provided := false;
        EXIT;
      END IF;
      l_pk_where_clauses := l_pk_where_clauses ||
        format('%I = %L', l_pk_cols[i], l_pk_value);
    END;
  END LOOP;

  IF NOT l_pk_provided THEN
    RAISE EXCEPTION 'DZQL: no primary key provided for entity %', p_entity;
  END IF;

  l_pk_where := array_to_string(l_pk_where_clauses, ' AND ');

  -- Get existing record for permission check and graph rules
  EXECUTE format('SELECT to_jsonb(t.*) FROM %I t WHERE %s', p_entity, l_pk_where)
  INTO l_record;

  IF l_record IS NULL THEN
    RAISE EXCEPTION 'DZQL: record not found in %', p_entity;
  END IF;

  -- Check delete permission on existing record
  IF NOT dzql.check_permission(p_user_id, 'delete', p_entity, l_record) THEN
    RAISE EXCEPTION 'Permission denied: delete on %', p_entity;
  END IF;

  -- Execute graph rules for delete
  l_graph_rules_result := dzql.execute_graph_rules(
    p_entity,
    'delete',
    l_record,
    NULL,
    p_user_id
  );

  -- Perform the actual delete using composite WHERE clause
  IF l_entity_config.soft_delete THEN
    EXECUTE format('UPDATE %I SET deleted_at = now() WHERE %s', p_entity, l_pk_where);
  ELSE
    EXECUTE format('DELETE FROM %I WHERE %s', p_entity, l_pk_where);
  END IF;




  -- Create event for the delete operation
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
    (
      SELECT jsonb_object_agg(col, l_record ->> col)
      FROM unnest(l_pk_cols) AS col
    ),
    l_record,
    NULL,
    p_user_id,
    dzql.resolve_notification_paths(p_entity, l_record)
  );

  -- Add graph rules execution summary to result if rules were executed
  IF l_graph_rules_result IS NOT NULL AND l_graph_rules_result != '{}' THEN
    l_record := l_record || jsonb_build_object('graph_rules', l_graph_rules_result);
  END IF;

  RETURN l_record;
END $$;

-- === Generic LOOKUP Operation ===
-- Generic LOOKUP for autocomplete/dropdown data
CREATE OR REPLACE FUNCTION dzql.generic_lookup(
  p_entity text,
  p_args jsonb,
  p_user_id int
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  l_entity_config record;
  l_filter text;
  l_label_field text;
  l_where_clause text;
  l_temporal_filter text;
  l_on_date timestamptz;
  l_sql_stmt text;
  l_result jsonb;
  l_pk_cols text[];
  l_pk_value_expr text;
  l_is_compound_key boolean;
  l_fk_includes jsonb;
  l_key text;
  l_value text;
  l_fk_result jsonb;
  l_record jsonb;
  l_processed_data jsonb[] := '{}';
  l_label_obj jsonb;
  i int;
BEGIN
  -- Get entity configuration
  SELECT * INTO l_entity_config FROM dzql.entities WHERE table_name = p_entity;

  IF l_entity_config IS NULL THEN
    RAISE EXCEPTION 'DZQL: entity % not configured', p_entity;
  END IF;

  -- Get primary key columns
  SELECT array_agg(a.attname ORDER BY a.attnum)
    INTO l_pk_cols
  FROM pg_index i
  JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
  WHERE i.indrelid = p_entity::regclass AND i.indisprimary;

  IF l_pk_cols IS NULL THEN
    RAISE EXCEPTION 'DZQL: entity % has no primary key', p_entity;
  END IF;

  -- Check if this is a compound key
  l_is_compound_key := array_length(l_pk_cols, 1) > 1;

  -- Build primary key value expression
  IF l_is_compound_key THEN
    -- Composite primary key - concatenate values
    l_pk_value_expr := format('CONCAT(%s)', array_to_string(array(SELECT format('%I', col) FROM unnest(l_pk_cols) AS col), ', ''-'', '));
  ELSE
    -- Single primary key
    l_pk_value_expr := l_pk_cols[1];
  END IF;

  -- Extract parameters
  l_filter := p_args ->> 'p_filter';
  l_on_date := (p_args ->> 'on_date')::timestamptz;
  l_label_field := l_entity_config.label_field;

  -- Build WHERE clause for filter
  IF l_filter IS NOT NULL AND l_filter != '' THEN
    l_where_clause := format('%I ILIKE %L', l_label_field, '%' || l_filter || '%');
  ELSE
    l_where_clause := '1=1';
  END IF;

  -- Add temporal filter
  l_temporal_filter := dzql.apply_temporal_filter(
    p_entity::regclass,
    l_entity_config.temporal_fields,
    l_on_date
  );

  l_where_clause := l_where_clause || l_temporal_filter;

  IF l_is_compound_key AND l_entity_config.fk_includes IS NOT NULL AND l_entity_config.fk_includes != '{}' THEN
    -- For compound keys with FK includes, build full dereferenced labels
    l_sql_stmt := format(
      'SELECT COALESCE(jsonb_agg(to_jsonb(t.*) ORDER BY %I), ''[]''::jsonb)
       FROM %I t WHERE %s AND dzql.check_permission(%L, ''view'', %L, to_jsonb(t.*)) LIMIT 50',
      l_label_field, p_entity, l_where_clause, p_user_id, p_entity
    );

    EXECUTE l_sql_stmt INTO l_result;

    -- Process FK dereferencing for each record
    l_fk_includes := l_entity_config.fk_includes;
    IF l_result IS NOT NULL AND jsonb_array_length(l_result) > 0 THEN
      -- Process each record in the result array
      FOR i IN 0..jsonb_array_length(l_result) - 1 LOOP
        l_record := l_result->i;
        l_label_obj := l_record; -- Start with base record

        -- Dereference foreign keys for this record, getting only label fields
        FOR l_key, l_value IN SELECT key, value FROM jsonb_each_text(l_fk_includes)
        LOOP
          -- Handle direct FK only for compound keys (resolve_direct_fk returns full record)
          l_fk_result := dzql.resolve_direct_fk(l_record, l_key, l_value, l_on_date);

          -- Extract just the label_field from the target entity
          IF l_fk_result IS NOT NULL THEN
            -- Get the target entity's label_field
            SELECT label_field INTO l_label_field FROM dzql.entities WHERE table_name = l_value;
            IF l_label_field IS NOT NULL THEN
              l_label_obj := l_label_obj || jsonb_build_object(l_key, l_fk_result ->> l_label_field);
            END IF;
          END IF;
        END LOOP;

        -- Build the lookup entry with dereferenced label
        l_processed_data := l_processed_data || jsonb_build_object(
          'label', l_label_obj,
          'value', (
            SELECT string_agg(l_record ->> col, '-' ORDER BY ordinality)
            FROM unnest(l_pk_cols) WITH ORDINALITY AS col
          )
        );
      END LOOP;

      -- Convert processed data to final result
      l_result := to_jsonb(l_processed_data);
    ELSE
      l_result := '[]'::jsonb;
    END IF;
  ELSE
    -- For simple entities, use the original approach
    l_sql_stmt := format(
      'SELECT COALESCE(jsonb_agg(jsonb_build_object(''label'', %I, ''value'', %s) ORDER BY %I), ''[]''::jsonb)
       FROM %I t WHERE %s AND dzql.check_permission(%L, ''view'', %L, to_jsonb(t.*)) LIMIT 50',
      l_label_field, l_pk_value_expr, l_label_field, p_entity, l_where_clause, p_user_id, p_entity
    );

    EXECUTE l_sql_stmt INTO l_result;
  END IF;

  RETURN COALESCE(l_result, '[]'::jsonb);
EXCEPTION
  WHEN OTHERS THEN
    RAISE EXCEPTION 'DZQL: lookup error for entity %: %', p_entity, SQLERRM;
END $$;

-- === Generic Dispatcher Function ===
-- Routes operations to their specific implementation functions
CREATE OR REPLACE FUNCTION dzql.generic_exec(
  p_operation text,
  p_entity text,
  p_args jsonb,
  p_user_id int
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
BEGIN
  CASE lower(p_operation)
    WHEN 'get' THEN
      RETURN dzql.generic_get(p_entity, p_args, p_user_id);
    WHEN 'save' THEN
      RETURN dzql.generic_save(p_entity, p_args, p_user_id);
    WHEN 'delete' THEN
      RETURN dzql.generic_delete(p_entity, p_args, p_user_id);
    WHEN 'lookup' THEN
      RETURN dzql.generic_lookup(p_entity, p_args, p_user_id);
    WHEN 'search' THEN
      RETURN dzql.generic_search(p_entity, p_args, p_user_id);
    ELSE
      RAISE EXCEPTION 'DZQL: unknown operation %', p_operation;
  END CASE;
END $$;
