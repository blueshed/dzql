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

  -- Expand many-to-many relationships (if configured)
  IF l_entity_config.many_to_many IS NOT NULL AND l_entity_config.many_to_many != '{}'::jsonb THEN
    DECLARE
      l_m2m_key text;
      l_m2m_config jsonb;
      l_id_field text;
      l_junction_table text;
      l_local_key text;
      l_foreign_key text;
      l_target_entity text;
      l_expand boolean;
      l_record_id text;
      l_id_array jsonb;
      l_expanded_objects jsonb;
    BEGIN
      -- Get the primary key value from the result
      l_record_id := l_result->>l_pk_cols[1];  -- Assume single PK for now

      FOR l_m2m_key IN SELECT jsonb_object_keys(l_entity_config.many_to_many)
      LOOP
        l_m2m_config := l_entity_config.many_to_many->l_m2m_key;
        l_id_field := l_m2m_config->>'id_field';
        l_junction_table := l_m2m_config->>'junction_table';
        l_local_key := l_m2m_config->>'local_key';
        l_foreign_key := l_m2m_config->>'foreign_key';
        l_target_entity := l_m2m_config->>'target_entity';
        l_expand := COALESCE((l_m2m_config->>'expand')::boolean, false);

        -- Always include array of IDs
        EXECUTE format('
          SELECT COALESCE(jsonb_agg(%I), ''[]''::jsonb)
          FROM %I
          WHERE %I = $1::int
        ', l_foreign_key, l_junction_table, l_local_key)
        INTO l_id_array
        USING l_record_id;

        l_result := l_result || jsonb_build_object(l_id_field, l_id_array);

        -- Conditionally include expanded objects if expand: true
        IF l_expand THEN
          EXECUTE format('
            SELECT COALESCE(jsonb_agg(to_jsonb(t.*)), ''[]''::jsonb)
            FROM %I jt
            JOIN %I t ON t.id = jt.%I
            WHERE jt.%I = $1::int
          ', l_junction_table, l_target_entity, l_foreign_key, l_local_key)
          INTO l_expanded_objects
          USING l_record_id;

          l_result := l_result || jsonb_build_object(l_m2m_key, l_expanded_objects);
        END IF;
      END LOOP;
    END;
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

  -- Expand M2M relationships in existing record (for UPDATE events)
  IF NOT l_is_insert AND l_existing_record IS NOT NULL AND l_entity_config.many_to_many IS NOT NULL AND l_entity_config.many_to_many != '{}'::jsonb THEN
    DECLARE
      l_m2m_key text;
      l_m2m_config jsonb;
      l_id_field text;
      l_junction_table text;
      l_local_key text;
      l_foreign_key text;
      l_target_entity text;
      l_expand boolean;
      l_record_id text;
      l_id_array jsonb;
      l_expanded_objects jsonb;
    BEGIN
      -- Get the primary key value from the existing record
      l_record_id := l_existing_record->>l_pk_cols[1];  -- Assume single PK for now

      FOR l_m2m_key IN SELECT jsonb_object_keys(l_entity_config.many_to_many)
      LOOP
        l_m2m_config := l_entity_config.many_to_many->l_m2m_key;
        l_id_field := l_m2m_config->>'id_field';
        l_junction_table := l_m2m_config->>'junction_table';
        l_local_key := l_m2m_config->>'local_key';
        l_foreign_key := l_m2m_config->>'foreign_key';
        l_target_entity := l_m2m_config->>'target_entity';
        l_expand := COALESCE((l_m2m_config->>'expand')::boolean, false);

        -- Always include array of IDs
        EXECUTE format('
          SELECT COALESCE(jsonb_agg(%I), ''[]''::jsonb)
          FROM %I
          WHERE %I = $1::int
        ', l_foreign_key, l_junction_table, l_local_key)
        INTO l_id_array
        USING l_record_id;

        l_existing_record := l_existing_record || jsonb_build_object(l_id_field, l_id_array);

        -- Conditionally include expanded objects if expand: true
        IF l_expand THEN
          EXECUTE format('
            SELECT COALESCE(jsonb_agg(to_jsonb(t.*)), ''[]''::jsonb)
            FROM %I jt
            JOIN %I t ON t.id = jt.%I
            WHERE jt.%I = $1::int
          ', l_junction_table, l_target_entity, l_foreign_key, l_local_key)
          INTO l_expanded_objects
          USING l_record_id;

          l_existing_record := l_existing_record || jsonb_build_object(l_m2m_key, l_expanded_objects);
        END IF;
      END LOOP;
    END;
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
        -- Skip M2M ID fields and expanded fields (they're not real table columns)
        IF l_entity_config.many_to_many IS NOT NULL THEN
          DECLARE
            l_m2m_id_field text;
            l_m2m_key text;
            l_skip boolean := false;
          BEGIN
            -- Skip M2M ID fields (e.g., tag_ids)
            FOR l_m2m_id_field IN
              SELECT value->>'id_field'
              FROM jsonb_each(l_entity_config.many_to_many)
            LOOP
              IF l_col_name = l_m2m_id_field THEN
                l_skip := true;
                EXIT;
              END IF;
            END LOOP;

            -- Skip M2M expanded fields (e.g., tags)
            IF NOT l_skip THEN
              FOR l_m2m_key IN
                SELECT key
                FROM jsonb_each(l_entity_config.many_to_many)
              LOOP
                IF l_col_name = l_m2m_key THEN
                  l_skip := true;
                  EXIT;
                END IF;
              END LOOP;
            END IF;

            IF NOT l_skip THEN
              l_set_clauses := l_set_clauses || format('%I = %L', l_col_name, l_merged_data ->> l_col_name);
            END IF;
          END;
        ELSE
          l_set_clauses := l_set_clauses || format('%I = %L', l_col_name, l_merged_data ->> l_col_name);
        END IF;
      END IF;
    END LOOP;

    -- Execute UPDATE using composite WHERE clause
    l_sql_stmt := format('UPDATE %I SET %s WHERE %s RETURNING to_jsonb(%I.*)',
                      p_entity,
                      array_to_string(l_set_clauses, ', '),
                      l_pk_where,
                      p_entity);
    EXECUTE l_sql_stmt INTO l_result;


  ELSE
    -- INSERT: Use provided values, let database handle defaults

    -- Auto-inject user_id if table has a user_id column and it's not provided
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
      AND table_name = p_entity
      AND column_name = 'user_id'
    ) AND (l_args_json->>'user_id' IS NULL) THEN
      l_args_json := l_args_json || jsonb_build_object('user_id', p_user_id);
    END IF;

    -- Apply field defaults for INSERT (if configured)
    IF l_entity_config.field_defaults IS NOT NULL AND l_entity_config.field_defaults != '{}' THEN
      FOR l_col_name IN SELECT jsonb_object_keys(l_entity_config.field_defaults)
      LOOP
        -- Only apply default if field is not already provided
        IF NOT (l_args_json ? l_col_name) THEN
          DECLARE
            l_default_value text;
            l_resolved_value text;
          BEGIN
            l_default_value := l_entity_config.field_defaults->>l_col_name;

            -- Resolve variable if it starts with @
            IF l_default_value LIKE '@%' THEN
              l_resolved_value := dzql.resolve_graph_variable(
                l_default_value,
                NULL,  -- no before record for INSERT
                l_args_json,  -- current data being inserted
                p_user_id
              );
            ELSE
              -- Use literal value
              l_resolved_value := l_default_value;
            END IF;

            -- Add to l_args_json
            l_args_json := l_args_json || jsonb_build_object(l_col_name, l_resolved_value);
          END;
        END IF;
      END LOOP;
    END IF;

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
      -- Skip M2M ID fields (they're not real table columns)
      IF l_entity_config.many_to_many IS NOT NULL THEN
        DECLARE
          l_m2m_id_field text;
          l_skip boolean := false;
        BEGIN
          FOR l_m2m_id_field IN
            SELECT value->>'id_field'
            FROM jsonb_each(l_entity_config.many_to_many)
          LOOP
            IF l_col_name = l_m2m_id_field THEN
              l_skip := true;
              EXIT;
            END IF;
          END LOOP;

          IF l_skip THEN
            CONTINUE;
          END IF;
        END;
      END IF;

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

  END IF;

  -- Sync many-to-many relationships (if configured)
  IF l_entity_config.many_to_many IS NOT NULL AND l_entity_config.many_to_many != '{}'::jsonb THEN
    DECLARE
      l_m2m_key text;
      l_m2m_config jsonb;
      l_id_field text;
      l_junction_table text;
      l_local_key text;
      l_foreign_key text;
      l_record_id text;
    BEGIN
      -- Get the primary key value from the result
      l_record_id := l_result->>l_pk_cols[1];  -- Assume single PK for now

      FOR l_m2m_key IN SELECT jsonb_object_keys(l_entity_config.many_to_many)
      LOOP
        l_m2m_config := l_entity_config.many_to_many->l_m2m_key;
        l_id_field := l_m2m_config->>'id_field';

        -- Only sync if the ID field is present in the data
        IF l_args_json ? l_id_field THEN
          l_junction_table := l_m2m_config->>'junction_table';
          l_local_key := l_m2m_config->>'local_key';
          l_foreign_key := l_m2m_config->>'foreign_key';

          -- Delete relationships not in new list
          EXECUTE format('
            DELETE FROM %I
            WHERE %I = $1::int
              AND %I <> ALL($2::int[])
          ', l_junction_table, l_local_key, l_foreign_key)
          USING l_record_id,
                ARRAY(SELECT jsonb_array_elements_text(l_args_json->l_id_field))::int[];

          -- Insert new relationships (ignore conflicts)
          EXECUTE format('
            INSERT INTO %I (%I, %I)
            SELECT $1::int, value::int
            FROM jsonb_array_elements_text($2)
            ON CONFLICT DO NOTHING
          ', l_junction_table, l_local_key, l_foreign_key)
          USING l_record_id, l_args_json->l_id_field;
        END IF;
      END LOOP;
    END;
  END IF;

  -- Expand many-to-many relationships in result (after sync)
  IF l_entity_config.many_to_many IS NOT NULL AND l_entity_config.many_to_many != '{}'::jsonb THEN
    DECLARE
      l_m2m_key text;
      l_m2m_config jsonb;
      l_id_field text;
      l_junction_table text;
      l_local_key text;
      l_foreign_key text;
      l_target_entity text;
      l_expand boolean;
      l_record_id text;
      l_id_array jsonb;
      l_expanded_objects jsonb;
    BEGIN
      -- Get the primary key value from the result
      l_record_id := l_result->>l_pk_cols[1];  -- Assume single PK for now

      FOR l_m2m_key IN SELECT jsonb_object_keys(l_entity_config.many_to_many)
      LOOP
        l_m2m_config := l_entity_config.many_to_many->l_m2m_key;
        l_id_field := l_m2m_config->>'id_field';
        l_junction_table := l_m2m_config->>'junction_table';
        l_local_key := l_m2m_config->>'local_key';
        l_foreign_key := l_m2m_config->>'foreign_key';
        l_target_entity := l_m2m_config->>'target_entity';
        l_expand := COALESCE((l_m2m_config->>'expand')::boolean, false);

        -- Always include array of IDs
        EXECUTE format('
          SELECT COALESCE(jsonb_agg(%I), ''[]''::jsonb)
          FROM %I
          WHERE %I = $1::int
        ', l_foreign_key, l_junction_table, l_local_key)
        INTO l_id_array
        USING l_record_id;

        l_result := l_result || jsonb_build_object(l_id_field, l_id_array);

        -- Conditionally include expanded objects if expand: true
        IF l_expand THEN
          EXECUTE format('
            SELECT COALESCE(jsonb_agg(to_jsonb(t.*)), ''[]''::jsonb)
            FROM %I jt
            JOIN %I t ON t.id = jt.%I
            WHERE jt.%I = $1::int
          ', l_junction_table, l_target_entity, l_foreign_key, l_local_key)
          INTO l_expanded_objects
          USING l_record_id;

          l_result := l_result || jsonb_build_object(l_m2m_key, l_expanded_objects);
        END IF;
      END LOOP;
    END;
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
    data,
    user_id,
    notify_users
  ) VALUES (
    p_entity,
    CASE WHEN l_is_insert THEN 'insert' ELSE 'update' END,
    (
      SELECT jsonb_object_agg(col, l_result ->> col)
      FROM unnest(l_pk_cols) AS col
    ),
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

  -- Apply CASCADE/SET NULL/RESTRICT rules from child entities
  DECLARE
    l_child_entity record;
    l_child_graph_rules jsonb;
    l_delete_rules jsonb;
    l_rule_name text;
    l_rule_action text;
    l_fk_field text;
    l_fk_key text;
    l_child_count int;
  BEGIN
    -- Find all entities that reference this entity
    FOR l_child_entity IN
      SELECT * FROM dzql.entities
      WHERE fk_includes IS NOT NULL
        AND fk_includes != '{}'
    LOOP
      -- Check if this child entity has an FK pointing to the entity being deleted
      FOR l_fk_key IN SELECT jsonb_object_keys(l_child_entity.fk_includes)
      LOOP
        IF l_child_entity.fk_includes->>l_fk_key = p_entity THEN
          -- This child entity references the parent being deleted
          l_child_graph_rules := l_child_entity.graph_rules;

          IF l_child_graph_rules IS NOT NULL AND l_child_graph_rules != '{}' THEN
            l_delete_rules := l_child_graph_rules->'delete';

            IF l_delete_rules IS NOT NULL AND l_delete_rules != '{}' THEN
              -- Check rules for this child entity
              FOR l_rule_name, l_rule_action IN SELECT * FROM jsonb_each_text(l_delete_rules)
              LOOP
                -- The rule_name should match the child entity name
                IF l_rule_name = l_child_entity.table_name THEN
                  -- Determine FK field name (try direct match then _id suffix)
                  l_fk_field := l_fk_key;
                  IF NOT EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = l_child_entity.table_name
                    AND column_name = l_fk_field
                  ) THEN
                    l_fk_field := l_fk_key || '_id';
                  END IF;

                  -- Apply the rule action
                  CASE l_rule_action
                    WHEN 'CASCADE' THEN
                      -- Delete child records via generic_delete to trigger events
                      DECLARE
                        l_child_record record;
                      BEGIN
                        FOR l_child_record IN
                          EXECUTE format(
                            'SELECT * FROM %I WHERE %I = %L',
                            l_child_entity.table_name,
                            l_fk_field,
                            l_record->>'id'
                          )
                        LOOP
                          -- Call generic_delete for each child to ensure events are created
                          PERFORM dzql.generic_delete(
                            l_child_entity.table_name,
                            jsonb_build_object('id', l_child_record.id),
                            p_user_id
                          );
                        END LOOP;
                      END;

                    WHEN 'SET NULL' THEN
                      -- Set FK to NULL in child records
                      EXECUTE format(
                        'UPDATE %I SET %I = NULL WHERE %I = %L',
                        l_child_entity.table_name,
                        l_fk_field,
                        l_fk_field,
                        l_record->>'id'
                      );

                    WHEN 'RESTRICT' THEN
                      -- Check if children exist, prevent delete if so
                      EXECUTE format(
                        'SELECT COUNT(*) FROM %I WHERE %I = %L',
                        l_child_entity.table_name,
                        l_fk_field,
                        l_record->>'id'
                      ) INTO l_child_count;

                      IF l_child_count > 0 THEN
                        RAISE EXCEPTION 'Cannot delete % - % child records exist in %',
                          p_entity, l_child_count, l_child_entity.table_name;
                      END IF;
                  END CASE;
                END IF;
              END LOOP;
            END IF;
          END IF;
        END IF;
      END LOOP;
    END LOOP;
  END;

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
    data,
    user_id,
    notify_users
  ) VALUES (
    p_entity,
    'delete',
    (
      SELECT jsonb_object_agg(col, l_record ->> col)
      FROM unnest(l_pk_cols) AS col
    ),
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

  -- Add soft delete filter if enabled for this entity
  IF l_entity_config.soft_delete THEN
    l_where_clause := l_where_clause || ' AND t.deleted_at IS NULL';
  END IF;

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
