-- DZQL Search Operations - Version 3.0.0
-- Advanced search and filtering capabilities for DZQL entities

-- ============================================================================
-- FILTER PROCESSING HELPERS
-- ============================================================================

-- Get column data type for proper casting
CREATE OR REPLACE FUNCTION dzql.get_column_type(
  p_table_name text,
  p_column_name text
) RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT format_type(atttypid, atttypmod)
  FROM pg_attribute
  WHERE attrelid = p_table_name::regclass
    AND attname = p_column_name
    AND NOT attisdropped
    AND attnum > 0;
$$;

-- Build operator-based WHERE clause fragment using direct SQL
CREATE OR REPLACE FUNCTION dzql.build_operator_clause(
  p_column_name text,
  p_operator_obj jsonb,
  p_column_type text
) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE
  l_op_key text;
  l_op_value jsonb;
  l_clauses text[] := array[]::text[];
BEGIN
  -- Process each operator in the object
  FOR l_op_key, l_op_value IN SELECT * FROM jsonb_each(p_operator_obj)
  LOOP
    CASE lower(l_op_key)
      WHEN 'eq', '=' THEN
        l_clauses := l_clauses || format('%I = %L', p_column_name, l_op_value#>>'{}');

      WHEN 'neq', '!=', '<>' THEN
        l_clauses := l_clauses || format('%I != %L', p_column_name, l_op_value#>>'{}');

      WHEN 'gt', '>' THEN
        l_clauses := l_clauses || format('%I > %L', p_column_name, l_op_value#>>'{}');

      WHEN 'gte', '>=' THEN
        l_clauses := l_clauses || format('%I >= %L', p_column_name, l_op_value#>>'{}');

      WHEN 'lt', '<' THEN
        l_clauses := l_clauses || format('%I < %L', p_column_name, l_op_value#>>'{}');

      WHEN 'lte', '<=' THEN
        l_clauses := l_clauses || format('%I <= %L', p_column_name, l_op_value#>>'{}');

      WHEN 'like' THEN
        l_clauses := l_clauses || format('%I LIKE %L', p_column_name, l_op_value#>>'{}');

      WHEN 'ilike' THEN
        l_clauses := l_clauses || format('%I ILIKE %L', p_column_name, l_op_value#>>'{}');

      WHEN 'in' THEN
        IF jsonb_typeof(l_op_value) = 'array' THEN
          l_clauses := l_clauses || format('%I::TEXT = ANY(%L)',
            p_column_name,
            ARRAY(SELECT jsonb_array_elements_text(l_op_value))
          );
        END IF;

      WHEN 'not_in' THEN
        IF jsonb_typeof(l_op_value) = 'array' THEN
          l_clauses := l_clauses || format('%I::TEXT != ALL(%L)',
            p_column_name,
            ARRAY(SELECT jsonb_array_elements_text(l_op_value))
          );
        END IF;

      WHEN 'between' THEN
        IF jsonb_typeof(l_op_value) = 'array' AND jsonb_array_length(l_op_value) = 2 THEN
          l_clauses := l_clauses || format('%I BETWEEN %L AND %L',
            p_column_name, l_op_value->0#>>'{}', l_op_value->1#>>'{}');
        END IF;

      WHEN 'is_null', 'null' THEN
        IF (l_op_value::text = 'true') THEN
          l_clauses := l_clauses || format('%I IS NULL', p_column_name);
        END IF;

      WHEN 'not_null', 'not' THEN
        IF (l_op_value::text = 'true' OR l_op_value::text = 'null') THEN
          l_clauses := l_clauses || format('%I IS NOT NULL', p_column_name);
        END IF;

      ELSE
        -- Unknown operator, skip silently
        NULL;
    END CASE;
  END LOOP;

  IF array_length(l_clauses, 1) > 0 THEN
    RETURN '(' || array_to_string(l_clauses, ' AND ') || ')';
  ELSE
    RETURN NULL;
  END IF;
END $$;

-- Build complete WHERE clause from filter object
CREATE OR REPLACE FUNCTION dzql.build_where_clause(
  p_table_name text,
  p_filters jsonb
) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE
  l_clauses text[] := array[]::text[];
  l_key text;
  l_value jsonb;
  l_column_type text;
  l_column_exists boolean;
  l_clause text;
BEGIN
  -- Skip _search key (handled separately)
  FOR l_key, l_value IN SELECT key, value FROM jsonb_each(p_filters)
  LOOP
    IF l_key = '_search' THEN
      CONTINUE;
    END IF;

    -- Check if column exists
    SELECT EXISTS (
      SELECT 1 FROM pg_attribute
      WHERE attrelid = p_table_name::regclass
        AND attname = l_key
        AND NOT attisdropped
        AND attnum > 0
    ) INTO l_column_exists;

    IF NOT l_column_exists THEN
      RAISE EXCEPTION 'Column % does not exist in table %', l_key, p_table_name;
    END IF;

    -- Get column type
    l_column_type := dzql.get_column_type(p_table_name, l_key);

    -- Build clause based on value type
    CASE jsonb_typeof(l_value)
      WHEN 'object' THEN
        -- Handle operator objects like {gte: 100, lt: 500}
        l_clause := dzql.build_operator_clause(l_key, l_value, l_column_type);
        IF l_clause IS NOT NULL THEN
          l_clauses := l_clauses || l_clause;
        END IF;

      WHEN 'array' THEN
        -- Handle IN clause
        l_clauses := l_clauses || format('%I = ANY(%L)',
          l_key,
          ARRAY(SELECT jsonb_array_elements_text(l_value))
        );

      WHEN 'null' THEN
        -- Handle IS NULL
        l_clauses := l_clauses || format('%I IS NULL', l_key);

      ELSE
        -- Handle exact match
        l_clauses := l_clauses || format('%I = %L', l_key, l_value#>>'{}');
    END CASE;
  END LOOP;

  IF array_length(l_clauses, 1) > 0 THEN
    RETURN array_to_string(l_clauses, ' AND ');
  ELSE
    RETURN NULL;
  END IF;
END $$;

-- Build text search clause
CREATE OR REPLACE FUNCTION dzql.build_search_clause(
  p_search_text text,
  p_searchable_fields text[]
) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE
  l_search_clauses text[] := array[]::text[];
  l_field text;
BEGIN
  IF p_search_text IS NOT NULL AND p_search_text != '' THEN
    FOREACH l_field IN ARRAY p_searchable_fields
    LOOP
      l_search_clauses := l_search_clauses ||
        format('%I::text ILIKE %L', l_field, '%' || p_search_text || '%');
    END LOOP;

    IF array_length(l_search_clauses, 1) > 0 THEN
      RETURN '(' || array_to_string(l_search_clauses, ' OR ') || ')';
    END IF;
  END IF;

  RETURN NULL;
END $$;

-- ============================================================================
-- GENERIC SEARCH OPERATION
-- ============================================================================

-- Generic SEARCH with advanced filtering support
CREATE OR REPLACE FUNCTION dzql.generic_search(
  p_entity text,
  p_args jsonb,
  p_user_id int
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  l_entity_config record;
  l_filters jsonb;
  l_where_clause text := '';
  l_filter_clause text;
  l_search_clause text;
  l_temporal_clause text;
  l_order_clause text := '';
  l_on_date timestamptz;
  l_page int := 1;
  l_limit int := 50;
  l_offset int := 0;
  l_sort jsonb;
  l_sort_field text;
  l_sort_order text;
  l_base_sql text;
  l_count_sql text;
  l_data_sql text;
  l_total int;
  l_data jsonb;
  l_column_exists boolean;
  l_pk_cols text[];
  l_pk_order text;
  l_fk_includes jsonb;
  l_key text;
  l_value text;
  l_fk_result jsonb;
  l_record jsonb;
  l_processed_data jsonb[] := '{}';
  i int;
BEGIN
  -- Get entity configuration
  SELECT * INTO l_entity_config FROM dzql.entities WHERE table_name = p_entity;

  IF l_entity_config IS NULL THEN
    RAISE EXCEPTION 'DZQL: entity % not configured', p_entity;
  END IF;

  -- Get primary key columns for default ordering
  SELECT array_agg(a.attname ORDER BY a.attnum)
    INTO l_pk_cols
  FROM pg_index i
  JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
  WHERE i.indrelid = p_entity::regclass AND i.indisprimary;

  IF l_pk_cols IS NOT NULL THEN
    l_pk_order := array_to_string(array(SELECT format('t.%I', col) FROM unnest(l_pk_cols) AS col), ', ');
  ELSE
    l_pk_order := 't.*';
  END IF;

  -- Extract filters and parameters
  l_filters := COALESCE(p_args->'filters', p_args->'p_filters', '{}'::jsonb);
  l_on_date := (p_args->>'on_date')::timestamptz;

  -- Extract pagination from args or filters
  l_page := COALESCE(
    (p_args->>'page')::int,
    (l_filters->>'page')::int,
    1
  );
  l_limit := COALESCE(
    (p_args->>'limit')::int,
    (l_filters->>'limit')::int,
    50
  );
  l_offset := (l_page - 1) * l_limit;

  -- Build WHERE clause from filters
  l_filter_clause := dzql.build_where_clause(p_entity, l_filters);

  -- Build text search clause
  l_search_clause := dzql.build_search_clause(
    l_filters->>'_search',
    l_entity_config.searchable_fields
  );

  -- Build temporal filter
  l_temporal_clause := dzql.apply_temporal_filter(
    p_entity::regclass,
    l_entity_config.temporal_fields,
    l_on_date
  );

  -- Extract sort parameters
  l_sort := COALESCE(p_args->'sort', l_filters->'sort');
  IF l_sort IS NOT NULL THEN
    l_sort_field := COALESCE(l_sort->>'field', l_sort->>'column');
    l_sort_order := COALESCE(l_sort->>'order', l_sort->>'dir', 'asc');

    IF l_sort_field IS NOT NULL THEN
      -- Validate sort field exists, fall back to 'id' if invalid
      SELECT EXISTS (
        SELECT 1 FROM pg_attribute
        WHERE attrelid = p_entity::regclass
          AND attname = l_sort_field
          AND NOT attisdropped
          AND attnum > 0
      ) INTO l_column_exists;

      IF NOT l_column_exists THEN
        l_sort_field := 'id'; -- Fall back to default
      END IF;

      l_order_clause := format(' ORDER BY %I %s', l_sort_field,
        CASE WHEN upper(l_sort_order) = 'DESC' THEN 'DESC' ELSE 'ASC' END);
    END IF;
  END IF;

  -- Build complete WHERE clause
  IF l_filter_clause IS NOT NULL THEN
    l_where_clause := 'WHERE ' || l_filter_clause;
  END IF;

  IF l_search_clause IS NOT NULL THEN
    IF l_where_clause = '' THEN
      l_where_clause := 'WHERE ' || l_search_clause;
    ELSE
      l_where_clause := l_where_clause || ' AND (' || l_search_clause || ')';
    END IF;
  END IF;

  IF l_temporal_clause != '' THEN
    IF l_where_clause = '' THEN
      l_where_clause := 'WHERE 1=1' || l_temporal_clause;
    ELSE
      l_where_clause := l_where_clause || l_temporal_clause;
    END IF;
  END IF;

  -- Add permission check to WHERE clause
  IF l_where_clause = '' OR l_where_clause = 'WHERE' THEN
    l_where_clause := format('WHERE dzql.check_permission(%L, ''view'', %L, to_jsonb(t.*))', p_user_id, p_entity);
  ELSE
    l_where_clause := l_where_clause || format(' AND dzql.check_permission(%L, ''view'', %L, to_jsonb(t.*))', p_user_id, p_entity);
  END IF;

  -- Add soft delete filter if enabled for this entity
  IF l_entity_config.soft_delete THEN
    l_where_clause := l_where_clause || ' AND t.deleted_at IS NULL';
  END IF;

  -- Build base SQL
  l_base_sql := format('FROM %I t %s', p_entity, l_where_clause);

  -- Get total count
  l_count_sql := 'SELECT COUNT(*) ' || l_base_sql;
  EXECUTE l_count_sql INTO l_total;

  -- Get paginated data - Always use subquery to ensure LIMIT works correctly
  IF l_order_clause != '' THEN
    l_data_sql := format('SELECT COALESCE(jsonb_agg(to_jsonb(sub.*)), ''[]''::jsonb) FROM (SELECT t.* %s %s LIMIT %L OFFSET %L) sub',
      l_base_sql, l_order_clause, l_limit, l_offset);
  ELSE
    -- Use subquery even without ORDER BY to ensure LIMIT is applied before aggregation
    l_data_sql := format('SELECT COALESCE(jsonb_agg(to_jsonb(sub.*)), ''[]''::jsonb) FROM (SELECT t.* %s ORDER BY %s LIMIT %L OFFSET %L) sub',
      l_base_sql, l_pk_order, l_limit, l_offset);
  END IF;

  EXECUTE l_data_sql INTO l_data;

  -- Process FK dereferencing for each record
  l_fk_includes := l_entity_config.fk_includes;
  IF l_fk_includes IS NOT NULL AND l_fk_includes != '{}' AND l_data IS NOT NULL AND jsonb_array_length(l_data) > 0 THEN
    -- Process each record in the data array
    FOR i IN 0..jsonb_array_length(l_data) - 1 LOOP
      l_record := l_data->i;

      -- Dereference foreign keys for this record
      FOR l_key, l_value IN SELECT key, value FROM jsonb_each_text(l_fk_includes)
      LOOP
        -- Handle different FK reference formats
        IF l_value LIKE '%.%' THEN
          -- Format: "table.field" for reverse foreign keys
          l_fk_result := dzql.resolve_reverse_fk(l_record, l_key, l_value, l_on_date);
        ELSIF l_key = l_value THEN
          -- When key equals value (e.g., "sites": "sites"), it's a reverse FK
          -- The target table has a field named {entity_singular}_id pointing back to this entity
          -- Convert plural entity name to singular (simple rule: remove trailing 's')
          l_fk_result := dzql.resolve_reverse_fk(l_record, l_key,
            l_value || '.' || regexp_replace(p_entity, 's$', '') || '_id', l_on_date);
        ELSE
          -- Format: "table" for direct foreign keys
          l_fk_result := dzql.resolve_direct_fk(l_record, l_key, l_value, l_on_date);
        END IF;

        IF l_fk_result IS NOT NULL THEN
          l_record := l_record || jsonb_build_object(l_key, l_fk_result);
        END IF;
      END LOOP;

      -- Expand many-to-many relationships for this record (if configured)
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
          l_pk_cols text[];
        BEGIN
          -- Get primary key columns for this entity
          SELECT array_agg(a.attname ORDER BY a.attnum)
            INTO l_pk_cols
          FROM pg_index idx
          JOIN pg_attribute a ON a.attrelid = idx.indrelid AND a.attnum = ANY(idx.indkey)
          WHERE idx.indrelid = p_entity::regclass AND idx.indisprimary;

          -- Get the primary key value from the record
          l_record_id := l_record->>l_pk_cols[1];  -- Assume single PK for now

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

            l_record := l_record || jsonb_build_object(l_id_field, l_id_array);

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

              l_record := l_record || jsonb_build_object(l_m2m_key, l_expanded_objects);
            END IF;
          END LOOP;
        END;
      END IF;

      l_processed_data := l_processed_data || l_record;
    END LOOP;

    -- Convert processed data back to jsonb array
    l_data := to_jsonb(l_processed_data);
  END IF;

  RETURN jsonb_build_object(
    'data', COALESCE(l_data, '[]'::jsonb),
    'total', l_total,
    'page', l_page,
    'limit', l_limit,
    'pages', CEIL(l_total::numeric / l_limit)
  );

EXCEPTION
  WHEN OTHERS THEN
    RAISE EXCEPTION 'DZQL: search error for entity %: %', p_entity, SQLERRM;
END $$;

-- ============================================================================
-- SEARCH UTILITIES
-- ============================================================================

-- Build faceted search aggregations
CREATE OR REPLACE FUNCTION dzql.build_search_facets(
  p_entity text,
  p_filters jsonb,
  p_facet_fields text[]
) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE
  l_base_where text;
  l_facet_field text;
  l_facet_sql text;
  l_facet_result jsonb;
  l_facets jsonb := '{}'::jsonb;
BEGIN
  -- Build base WHERE clause (without the facet field being aggregated)
  l_base_where := COALESCE(dzql.build_where_clause(p_entity, p_filters), '1=1');

  -- Build facets for each requested field
  FOREACH l_facet_field IN ARRAY p_facet_fields
  LOOP
    l_facet_sql := format(
      'SELECT COALESCE(jsonb_agg(jsonb_build_object(''value'', %I, ''count'', count)), ''[]''::jsonb)
       FROM (
         SELECT %I, COUNT(*) as count
         FROM %I
         WHERE %s AND %I IS NOT NULL
         GROUP BY %I
         ORDER BY count DESC, %I
         LIMIT 20
       ) facet_data',
      l_facet_field, l_facet_field, p_entity, l_base_where,
      l_facet_field, l_facet_field, l_facet_field
    );

    EXECUTE l_facet_sql INTO l_facet_result;
    l_facets := l_facets || jsonb_build_object(l_facet_field, l_facet_result);
  END LOOP;

  RETURN l_facets;
END $$;

-- Build search suggestions based on searchable fields
CREATE OR REPLACE FUNCTION dzql.build_search_suggestions(
  p_entity text,
  p_partial_text text,
  p_limit int DEFAULT 10
) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE
  l_entity_config record;
  l_field text;
  l_suggestions_sql text;
  l_field_sqls text[] := array[]::text[];
  l_result jsonb;
BEGIN
  -- Get entity configuration
  SELECT * INTO l_entity_config FROM dzql.entities WHERE table_name = p_entity;

  IF l_entity_config IS NULL THEN
    RETURN '[]'::jsonb;
  END IF;

  -- Build UNION query for all searchable fields
  FOREACH l_field IN ARRAY l_entity_config.searchable_fields
  LOOP
    l_field_sqls := l_field_sqls || format(
      'SELECT DISTINCT %I::text as suggestion FROM %I WHERE %I::text ILIKE %L AND %I IS NOT NULL',
      l_field, p_entity, l_field, p_partial_text || '%', l_field
    );
  END LOOP;

  IF array_length(l_field_sqls, 1) = 0 THEN
    RETURN '[]'::jsonb;
  END IF;

  l_suggestions_sql := format(
    'SELECT COALESCE(jsonb_agg(suggestion ORDER BY suggestion), ''[]''::jsonb) FROM (
       %s
       LIMIT %s
     ) suggestions',
    array_to_string(l_field_sqls, ' UNION '),
    p_limit
  );

  EXECUTE l_suggestions_sql INTO l_result;

  RETURN COALESCE(l_result, '[]'::jsonb);
END $$;
