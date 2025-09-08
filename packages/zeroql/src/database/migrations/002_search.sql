-- ZeroQL Search Filtering Enhancement
-- Migration: 002_search.sql
-- Adds advanced filtering capabilities to generic_search

-- ============================================================================
-- FILTER PROCESSING HELPERS
-- ============================================================================

-- Get column data type for proper casting
CREATE OR REPLACE FUNCTION zeroql.get_column_type(
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
CREATE OR REPLACE FUNCTION zeroql.build_operator_clause(
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
          l_clauses := l_clauses || format('%I = ANY(%L)',
            p_column_name,
            ARRAY(SELECT jsonb_array_elements_text(l_op_value))
          );
        END IF;

      WHEN 'not_in' THEN
        IF jsonb_typeof(l_op_value) = 'array' THEN
          l_clauses := l_clauses || format('%I != ALL(%L)',
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

  -- Combine clauses with AND
  IF array_length(l_clauses, 1) > 0 THEN
    RETURN '(' || array_to_string(l_clauses, ' AND ') || ')';
  ELSE
    RETURN NULL;
  END IF;
END $$;

-- Build complete WHERE clause from filters
CREATE OR REPLACE FUNCTION zeroql.build_where_clause(
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
  l_operator_clause text;
BEGIN
  -- Process each filter
  FOR l_key, l_value IN SELECT * FROM jsonb_each(p_filters)
  LOOP
    -- Skip special keys
    CONTINUE WHEN l_key IN ('page', 'limit', 'sort', '_search', 'on_date');

    -- Check if column exists
    SELECT EXISTS(
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
    l_column_type := zeroql.get_column_type(p_table_name, l_key);

    -- Handle different value types
    CASE jsonb_typeof(l_value)
      WHEN 'object' THEN
        -- Handle operators
        l_operator_clause := zeroql.build_operator_clause(l_key, l_value, l_column_type);
        IF l_operator_clause IS NOT NULL THEN
          l_clauses := l_clauses || l_operator_clause;
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
CREATE OR REPLACE FUNCTION zeroql.build_search_clause(
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
-- ENHANCED GENERIC SEARCH
-- ============================================================================

-- Enhanced generic_search with full filtering support
CREATE OR REPLACE FUNCTION zeroql.generic_search(
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
BEGIN
  -- Get entity configuration
  SELECT * INTO l_entity_config FROM zeroql.entities WHERE table_name = p_entity;

  IF l_entity_config IS NULL THEN
    RAISE EXCEPTION 'ZeroQL: entity % not configured', p_entity;
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
  l_filter_clause := zeroql.build_where_clause(p_entity, l_filters);
  IF l_filter_clause IS NOT NULL THEN
    l_where_clause := l_filter_clause;
  END IF;

  -- Handle text search
  IF l_filters ? '_search' AND l_filters->>'_search' != '' THEN
    l_search_clause := zeroql.build_search_clause(
      l_filters->>'_search',
      l_entity_config.searchable_fields
    );

    IF l_search_clause IS NOT NULL THEN
      IF l_where_clause != '' THEN
        l_where_clause := l_where_clause || ' AND ' || l_search_clause;
      ELSE
        l_where_clause := l_search_clause;
      END IF;
    END IF;
  END IF;

  -- Apply temporal filtering
  IF l_on_date IS NOT NULL AND l_entity_config.temporal_fields IS NOT NULL
     AND l_entity_config.temporal_fields != '{}' THEN
    l_temporal_clause := format('%I <= %L AND (%I > %L OR %I IS NULL)',
      l_entity_config.temporal_fields->>'valid_from', l_on_date,
      l_entity_config.temporal_fields->>'valid_to', l_on_date,
      l_entity_config.temporal_fields->>'valid_to'
    );

    IF l_where_clause != '' THEN
      l_where_clause := l_where_clause || ' AND ' || l_temporal_clause;
    ELSE
      l_where_clause := l_temporal_clause;
    END IF;
  END IF;

  -- Handle sorting
  l_sort := COALESCE(p_args->'sort', l_filters->'sort', NULL);
  IF l_sort IS NOT NULL THEN
    CASE jsonb_typeof(l_sort)
      WHEN 'object' THEN
        -- Single sort
        l_sort_field := l_sort->>'field';
        l_sort_order := upper(COALESCE(l_sort->>'order', 'ASC'));

        IF l_sort_order NOT IN ('ASC', 'DESC') THEN
          l_sort_order := 'ASC';
        END IF;

        -- Verify column exists
        IF EXISTS(
          SELECT 1 FROM pg_attribute
          WHERE attrelid = p_entity::regclass
            AND attname = l_sort_field
            AND NOT attisdropped
            AND attnum > 0
        ) THEN
          l_order_clause := format(' ORDER BY %I %s', l_sort_field, l_sort_order);
        ELSE
          l_order_clause := ' ORDER BY id ASC';
        END IF;

      ELSE
        l_order_clause := ' ORDER BY id ASC';
    END CASE;
  ELSE
    l_order_clause := ' ORDER BY id ASC';
  END IF;

  -- Build base FROM clause
  l_base_sql := format('FROM %I t', p_entity);

  -- Add permission filtering
  IF l_where_clause != '' THEN
    l_base_sql := l_base_sql || format(' WHERE (%s) AND zeroql.check_permission(%L, ''view'', %L, to_jsonb(t.*))',
      l_where_clause, p_user_id, p_entity);
  ELSE
    l_base_sql := l_base_sql || format(' WHERE zeroql.check_permission(%L, ''view'', %L, to_jsonb(t.*))',
      p_user_id, p_entity);
  END IF;

  -- Execute count query
  l_count_sql := 'SELECT COUNT(*) ' || l_base_sql;
  EXECUTE l_count_sql INTO l_total;

  -- Execute data query
  l_data_sql := format('SELECT COALESCE(jsonb_agg(x), ''[]''::jsonb) FROM (SELECT to_jsonb(t.*) as x %s %s LIMIT %s OFFSET %s) sub',
    l_base_sql,
    l_order_clause,
    l_limit,
    l_offset
  );
  EXECUTE l_data_sql INTO l_data;

  -- Return result
  RETURN jsonb_build_object(
    'data', l_data,
    'total', COALESCE(l_total, 0),
    'page', l_page,
    'limit', l_limit
  );

EXCEPTION WHEN OTHERS THEN
  -- Re-raise the exception to the client
  RAISE;
END $$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION zeroql.generic_search TO PUBLIC;
GRANT EXECUTE ON FUNCTION zeroql.get_column_type TO PUBLIC;
GRANT EXECUTE ON FUNCTION zeroql.build_operator_clause TO PUBLIC;
GRANT EXECUTE ON FUNCTION zeroql.build_where_clause TO PUBLIC;
GRANT EXECUTE ON FUNCTION zeroql.build_search_clause TO PUBLIC;
