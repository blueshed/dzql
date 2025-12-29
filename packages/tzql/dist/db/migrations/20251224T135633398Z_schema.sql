
CREATE TABLE IF NOT EXISTS users (
  id serial PRIMARY KEY,
  name text NOT NULL,
  email text UNIQUE NOT NULL,
  password_hash text NOT NULL,
  created_at timestamptz DEFAULT now()
);


CREATE OR REPLACE FUNCTION dzql_v2.save_users(p_user_id int, p_data jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = dzql_v2, public
AS $$
DECLARE
  v_result jsonb;
  v_old_data jsonb;
  v_commit_id bigint;
  v_op text;

BEGIN
  v_commit_id := nextval('dzql_v2.commit_seq');


  -- Determine Operation & Check Permissions (supports composite PK)
  IF ((p_data->>'id') IS NOT NULL) AND EXISTS(SELECT 1 FROM users WHERE id = (p_data->>'id')::int) THEN
    v_op := 'update';

    -- Fetch old data for update rules/events
    SELECT to_jsonb(users.*) INTO v_old_data FROM users WHERE id = (p_data->>'id')::int;

    IF NOT ((p_data->>'id')::int = p_user_id) THEN
      RAISE EXCEPTION 'permission_denied';
    END IF;

    -- Perform Partial Update
    UPDATE users SET
    name = CASE WHEN (p_data ? 'name') THEN (p_data->>'name') ELSE name END,
    email = CASE WHEN (p_data ? 'email') THEN (p_data->>'email') ELSE email END,
    password_hash = CASE WHEN (p_data ? 'password_hash') THEN (p_data->>'password_hash') ELSE password_hash END,
    created_at = CASE WHEN (p_data ? 'created_at') THEN (p_data->>'created_at')::timestamptz ELSE created_at END
    WHERE id = (p_data->>'id')::int
    RETURNING to_jsonb(users.*) INTO v_result;

    

  ELSE
    v_op := 'insert';
    IF NOT (TRUE) THEN
      RAISE EXCEPTION 'permission_denied';
    END IF;

    -- Perform Insert
    INSERT INTO users (name, email, password_hash, created_at)
    VALUES ((p_data->>'name'), (p_data->>'email'), (p_data->>'password_hash'), (p_data->>'created_at')::timestamptz)
    RETURNING to_jsonb(users.*) INTO v_result;

    
  END IF;



  -- Emit Event
  INSERT INTO dzql_v2.events (commit_id, table_name, op, pk, data, old_data, user_id)
  VALUES (
    v_commit_id,
    'users',
    v_op,
    jsonb_build_object('id', v_result->'id'),
    v_result,
    v_old_data, -- NULL for insert
    p_user_id
  );

  -- Notify Runtime
  PERFORM pg_notify('dzql_v2', json_build_object('commit_id', v_commit_id)::text);

  -- Remove hidden fields before returning to client
  RETURN v_result - ARRAY['password_hash'];
END;
$$;


CREATE OR REPLACE FUNCTION dzql_v2.delete_users(p_user_id int, p_pk jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = dzql_v2, public
AS $$
DECLARE
  v_old_data jsonb;
  v_commit_id bigint;
BEGIN
  v_commit_id := nextval('dzql_v2.commit_seq');

  -- Fetch old data FIRST for permission check
  SELECT to_jsonb(users.*) INTO v_old_data FROM users WHERE id = (p_pk->>'id')::int;

  IF v_old_data IS NULL THEN
    RAISE EXCEPTION 'not_found';
  END IF;

  -- Permission Check (Delete)
  IF NOT ((v_old_data->>'id')::int = p_user_id) THEN
    RAISE EXCEPTION 'permission_denied';
  END IF;

  -- Graph Rules (Pre-delete cascades)
  

  -- Perform Delete
  DELETE FROM users WHERE id = (p_pk->>'id')::int;

  -- Emit Event (always 'delete' operation for client-side removal)
  INSERT INTO dzql_v2.events (commit_id, table_name, op, pk, data, old_data, user_id)
  VALUES (
    v_commit_id,
    'users',
    'delete',
    jsonb_build_object('id', v_old_data->'id'),
    v_old_data,  -- Include full data for subscription resolution
    v_old_data,
    p_user_id
  );

  -- Notify Runtime
  PERFORM pg_notify('dzql_v2', json_build_object('commit_id', v_commit_id)::text);

  -- Remove hidden fields before returning to client
  RETURN v_old_data - ARRAY['password_hash'];
END;
$$;


CREATE OR REPLACE FUNCTION dzql_v2.get_users(p_user_id int, p_pk jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = dzql_v2, public
AS $$
DECLARE
  v_result jsonb;
BEGIN
  SELECT jsonb_build_object('id', users.id, 'name', users.name, 'email', users.email, 'created_at', users.created_at) INTO v_result
  FROM users
  WHERE id = (p_pk->>'id')::int
    AND (TRUE);

  IF v_result IS NULL THEN
    RETURN NULL;
  END IF;


  RETURN v_result;
END;
$$;


CREATE OR REPLACE FUNCTION dzql_v2.search_users(p_user_id int, p_query jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = dzql_v2, public
AS $$
DECLARE
  v_results jsonb;
  v_filters jsonb;
  v_sort_field text;
  v_sort_order text;
  v_where_clause text := '';
  v_field text;
  v_filter jsonb;
  v_operator text;
  v_value jsonb;
BEGIN
  -- Extract query parameters
  v_filters := COALESCE(p_query->'filters', '{}'::jsonb);
  v_sort_field := COALESCE(p_query->>'sort_field', 'name');
  v_sort_order := COALESCE(p_query->>'sort_order', 'asc');

  -- Build WHERE clause from filters
  FOR v_field, v_filter IN SELECT * FROM jsonb_each(v_filters)
  LOOP
    -- Handle simple value (exact match)
    IF jsonb_typeof(v_filter) IN ('string', 'number', 'boolean') THEN
      v_where_clause := v_where_clause || format(' AND %I::TEXT = %L', v_field, v_filter #>> '{}');
    ELSE
      -- Handle operator-based filters
      FOR v_operator, v_value IN SELECT * FROM jsonb_each(v_filter)
      LOOP
        CASE v_operator
          WHEN 'eq' THEN
            v_where_clause := v_where_clause || format(' AND %I::TEXT = %L', v_field, v_value #>> '{}');
          WHEN 'ne' THEN
            v_where_clause := v_where_clause || format(' AND %I::TEXT != %L', v_field, v_value #>> '{}');
          WHEN 'gt' THEN
            v_where_clause := v_where_clause || format(' AND %I > %L', v_field, v_value #>> '{}');
          WHEN 'gte' THEN
            v_where_clause := v_where_clause || format(' AND %I >= %L', v_field, v_value #>> '{}');
          WHEN 'lt' THEN
            v_where_clause := v_where_clause || format(' AND %I < %L', v_field, v_value #>> '{}');
          WHEN 'lte' THEN
            v_where_clause := v_where_clause || format(' AND %I <= %L', v_field, v_value #>> '{}');
          WHEN 'in' THEN
            v_where_clause := v_where_clause || format(' AND %I::TEXT = ANY(%L)', v_field,
              (SELECT array_agg(value #>> '{}') FROM jsonb_array_elements(v_value) AS value));
          WHEN 'not_in' THEN
            v_where_clause := v_where_clause || format(' AND %I::TEXT != ALL(%L)', v_field,
              (SELECT array_agg(value #>> '{}') FROM jsonb_array_elements(v_value) AS value));
          WHEN 'like' THEN
            v_where_clause := v_where_clause || format(' AND %I LIKE %L', v_field, v_value #>> '{}');
          WHEN 'ilike' THEN
            v_where_clause := v_where_clause || format(' AND %I ILIKE %L', v_field, v_value #>> '{}');
          WHEN 'is_null' THEN
            IF (v_value::text = 'true') THEN
              v_where_clause := v_where_clause || format(' AND %I IS NULL', v_field);
            END IF;
          WHEN 'not_null' THEN
            IF (v_value::text = 'true') THEN
              v_where_clause := v_where_clause || format(' AND %I IS NOT NULL', v_field);
            END IF;
          ELSE
            -- Unknown operator, skip
        END CASE;
      END LOOP;
    END IF;
  END LOOP;

  -- Execute dynamic query (sort inside subquery for correct LIMIT behavior)
  EXECUTE format('
    SELECT COALESCE(jsonb_agg(jsonb_build_object(''id'', t.id, ''name'', t.name, ''email'', t.email, ''created_at'', t.created_at)), ''[]''::jsonb)
    FROM (
      SELECT * FROM users
      WHERE (TRUE) %s
      ORDER BY %I %s
      LIMIT %L OFFSET %L
    ) t
  ', v_where_clause, v_sort_field, v_sort_order,
     COALESCE((p_query->>'limit')::int, 10),
     COALESCE((p_query->>'offset')::int, 0))
  INTO v_results;

  RETURN v_results;
END;
$$;


CREATE TABLE IF NOT EXISTS organisations (
  id serial PRIMARY KEY,
  name text UNIQUE NOT NULL,
  description text
);


CREATE OR REPLACE FUNCTION dzql_v2.save_organisations(p_user_id int, p_data jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = dzql_v2, public
AS $$
DECLARE
  v_result jsonb;
  v_old_data jsonb;
  v_commit_id bigint;
  v_op text;

BEGIN
  v_commit_id := nextval('dzql_v2.commit_seq');


  -- Determine Operation & Check Permissions (supports composite PK)
  IF ((p_data->>'id') IS NOT NULL) AND EXISTS(SELECT 1 FROM organisations WHERE id = (p_data->>'id')::int) THEN
    v_op := 'update';

    -- Fetch old data for update rules/events
    SELECT to_jsonb(organisations.*) INTO v_old_data FROM organisations WHERE id = (p_data->>'id')::int;

    IF NOT (EXISTS (SELECT 1 FROM acts_for WHERE acts_for.org_id = (p_data->>'id')::int AND acts_for.active = true AND acts_for.user_id = p_user_id)) THEN
      RAISE EXCEPTION 'permission_denied';
    END IF;

    -- Perform Partial Update
    UPDATE organisations SET
    name = CASE WHEN (p_data ? 'name') THEN (p_data->>'name') ELSE name END,
    description = CASE WHEN (p_data ? 'description') THEN (p_data->>'description') ELSE description END
    WHERE id = (p_data->>'id')::int
    RETURNING to_jsonb(organisations.*) INTO v_result;

    

  ELSE
    v_op := 'insert';
    IF NOT (TRUE) THEN
      RAISE EXCEPTION 'permission_denied';
    END IF;

    -- Perform Insert
    INSERT INTO organisations (name, description)
    VALUES ((p_data->>'name'), (p_data->>'description'))
    RETURNING to_jsonb(organisations.*) INTO v_result;

    
  -- Graph Rule: Create acts_for
  INSERT INTO acts_for (user_id, org_id, valid_from)
  VALUES (CASE WHEN p_user_id IS NOT NULL THEN p_user_id ELSE NULL END, (v_result->>'id')::int, CURRENT_DATE);

  END IF;



  -- Emit Event
  INSERT INTO dzql_v2.events (commit_id, table_name, op, pk, data, old_data, user_id)
  VALUES (
    v_commit_id,
    'organisations',
    v_op,
    jsonb_build_object('id', v_result->'id'),
    v_result,
    v_old_data, -- NULL for insert
    p_user_id
  );

  -- Notify Runtime
  PERFORM pg_notify('dzql_v2', json_build_object('commit_id', v_commit_id)::text);

  -- Remove hidden fields before returning to client
  RETURN v_result;
END;
$$;


CREATE OR REPLACE FUNCTION dzql_v2.delete_organisations(p_user_id int, p_pk jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = dzql_v2, public
AS $$
DECLARE
  v_old_data jsonb;
  v_commit_id bigint;
BEGIN
  v_commit_id := nextval('dzql_v2.commit_seq');

  -- Fetch old data FIRST for permission check
  SELECT to_jsonb(organisations.*) INTO v_old_data FROM organisations WHERE id = (p_pk->>'id')::int;

  IF v_old_data IS NULL THEN
    RAISE EXCEPTION 'not_found';
  END IF;

  -- Permission Check (Delete)
  IF NOT (EXISTS (SELECT 1 FROM acts_for WHERE acts_for.org_id = (v_old_data->>'id')::int AND acts_for.active = true AND acts_for.user_id = p_user_id)) THEN
    RAISE EXCEPTION 'permission_denied';
  END IF;

  -- Graph Rules (Pre-delete cascades)
  
  -- Graph Rule: Delete acts_for
  DELETE FROM acts_for WHERE org_id = (p_pk->>'id')::int;

  -- Graph Rule: Delete venues
  DELETE FROM venues WHERE org_id = (p_pk->>'id')::int;


  -- Perform Delete
  DELETE FROM organisations WHERE id = (p_pk->>'id')::int;

  -- Emit Event (always 'delete' operation for client-side removal)
  INSERT INTO dzql_v2.events (commit_id, table_name, op, pk, data, old_data, user_id)
  VALUES (
    v_commit_id,
    'organisations',
    'delete',
    jsonb_build_object('id', v_old_data->'id'),
    v_old_data,  -- Include full data for subscription resolution
    v_old_data,
    p_user_id
  );

  -- Notify Runtime
  PERFORM pg_notify('dzql_v2', json_build_object('commit_id', v_commit_id)::text);

  -- Remove hidden fields before returning to client
  RETURN v_old_data;
END;
$$;


CREATE OR REPLACE FUNCTION dzql_v2.get_organisations(p_user_id int, p_pk jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = dzql_v2, public
AS $$
DECLARE
  v_result jsonb;
BEGIN
  SELECT to_jsonb(organisations.*) INTO v_result
  FROM organisations
  WHERE id = (p_pk->>'id')::int
    AND (TRUE);

  IF v_result IS NULL THEN
    RETURN NULL;
  END IF;


  RETURN v_result;
END;
$$;


CREATE OR REPLACE FUNCTION dzql_v2.search_organisations(p_user_id int, p_query jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = dzql_v2, public
AS $$
DECLARE
  v_results jsonb;
  v_filters jsonb;
  v_sort_field text;
  v_sort_order text;
  v_where_clause text := '';
  v_field text;
  v_filter jsonb;
  v_operator text;
  v_value jsonb;
BEGIN
  -- Extract query parameters
  v_filters := COALESCE(p_query->'filters', '{}'::jsonb);
  v_sort_field := COALESCE(p_query->>'sort_field', 'name');
  v_sort_order := COALESCE(p_query->>'sort_order', 'asc');

  -- Build WHERE clause from filters
  FOR v_field, v_filter IN SELECT * FROM jsonb_each(v_filters)
  LOOP
    -- Handle simple value (exact match)
    IF jsonb_typeof(v_filter) IN ('string', 'number', 'boolean') THEN
      v_where_clause := v_where_clause || format(' AND %I::TEXT = %L', v_field, v_filter #>> '{}');
    ELSE
      -- Handle operator-based filters
      FOR v_operator, v_value IN SELECT * FROM jsonb_each(v_filter)
      LOOP
        CASE v_operator
          WHEN 'eq' THEN
            v_where_clause := v_where_clause || format(' AND %I::TEXT = %L', v_field, v_value #>> '{}');
          WHEN 'ne' THEN
            v_where_clause := v_where_clause || format(' AND %I::TEXT != %L', v_field, v_value #>> '{}');
          WHEN 'gt' THEN
            v_where_clause := v_where_clause || format(' AND %I > %L', v_field, v_value #>> '{}');
          WHEN 'gte' THEN
            v_where_clause := v_where_clause || format(' AND %I >= %L', v_field, v_value #>> '{}');
          WHEN 'lt' THEN
            v_where_clause := v_where_clause || format(' AND %I < %L', v_field, v_value #>> '{}');
          WHEN 'lte' THEN
            v_where_clause := v_where_clause || format(' AND %I <= %L', v_field, v_value #>> '{}');
          WHEN 'in' THEN
            v_where_clause := v_where_clause || format(' AND %I::TEXT = ANY(%L)', v_field,
              (SELECT array_agg(value #>> '{}') FROM jsonb_array_elements(v_value) AS value));
          WHEN 'not_in' THEN
            v_where_clause := v_where_clause || format(' AND %I::TEXT != ALL(%L)', v_field,
              (SELECT array_agg(value #>> '{}') FROM jsonb_array_elements(v_value) AS value));
          WHEN 'like' THEN
            v_where_clause := v_where_clause || format(' AND %I LIKE %L', v_field, v_value #>> '{}');
          WHEN 'ilike' THEN
            v_where_clause := v_where_clause || format(' AND %I ILIKE %L', v_field, v_value #>> '{}');
          WHEN 'is_null' THEN
            IF (v_value::text = 'true') THEN
              v_where_clause := v_where_clause || format(' AND %I IS NULL', v_field);
            END IF;
          WHEN 'not_null' THEN
            IF (v_value::text = 'true') THEN
              v_where_clause := v_where_clause || format(' AND %I IS NOT NULL', v_field);
            END IF;
          ELSE
            -- Unknown operator, skip
        END CASE;
      END LOOP;
    END IF;
  END LOOP;

  -- Execute dynamic query (sort inside subquery for correct LIMIT behavior)
  EXECUTE format('
    SELECT COALESCE(jsonb_agg(to_jsonb(t.*)), ''[]''::jsonb)
    FROM (
      SELECT * FROM organisations
      WHERE (TRUE) %s
      ORDER BY %I %s
      LIMIT %L OFFSET %L
    ) t
  ', v_where_clause, v_sort_field, v_sort_order,
     COALESCE((p_query->>'limit')::int, 10),
     COALESCE((p_query->>'offset')::int, 0))
  INTO v_results;

  RETURN v_results;
END;
$$;


CREATE TABLE IF NOT EXISTS acts_for (
  user_id int NOT NULL REFERENCES users(id),
  org_id int NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  valid_from date NOT NULL DEFAULT current_date,
  valid_to date,
  active boolean DEFAULT true
);


CREATE OR REPLACE FUNCTION dzql_v2.save_acts_for(p_user_id int, p_data jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = dzql_v2, public
AS $$
DECLARE
  v_result jsonb;
  v_old_data jsonb;
  v_commit_id bigint;
  v_op text;

BEGIN
  v_commit_id := nextval('dzql_v2.commit_seq');


  -- Determine Operation & Check Permissions (supports composite PK)
  IF ((p_data->>'user_id') IS NOT NULL AND (p_data->>'org_id') IS NOT NULL AND (p_data->>'valid_from') IS NOT NULL) AND EXISTS(SELECT 1 FROM acts_for WHERE user_id = (p_data->>'user_id')::int AND org_id = (p_data->>'org_id')::int AND valid_from = (p_data->>'valid_from')::date) THEN
    v_op := 'update';

    -- Fetch old data for update rules/events
    SELECT to_jsonb(acts_for.*) INTO v_old_data FROM acts_for WHERE user_id = (p_data->>'user_id')::int AND org_id = (p_data->>'org_id')::int AND valid_from = (p_data->>'valid_from')::date;

    IF NOT (TRUE) THEN
      RAISE EXCEPTION 'permission_denied';
    END IF;

    -- Perform Partial Update
    UPDATE acts_for SET
    valid_to = CASE WHEN (p_data ? 'valid_to') THEN (p_data->>'valid_to')::date ELSE valid_to END,
    active = CASE WHEN (p_data ? 'active') THEN (p_data->>'active')::boolean ELSE active END
    WHERE user_id = (p_data->>'user_id')::int AND org_id = (p_data->>'org_id')::int AND valid_from = (p_data->>'valid_from')::date
    RETURNING to_jsonb(acts_for.*) INTO v_result;

    

  ELSE
    v_op := 'insert';
    IF NOT (TRUE) THEN
      RAISE EXCEPTION 'permission_denied';
    END IF;

    -- Perform Insert
    INSERT INTO acts_for (user_id, org_id, valid_from, valid_to, active)
    VALUES ((p_data->>'user_id')::int, (p_data->>'org_id')::int, (p_data->>'valid_from')::date, (p_data->>'valid_to')::date, (p_data->>'active')::boolean)
    RETURNING to_jsonb(acts_for.*) INTO v_result;

    
  END IF;



  -- Emit Event
  INSERT INTO dzql_v2.events (commit_id, table_name, op, pk, data, old_data, user_id)
  VALUES (
    v_commit_id,
    'acts_for',
    v_op,
    jsonb_build_object('user_id', v_result->'user_id', 'org_id', v_result->'org_id', 'valid_from', v_result->'valid_from'),
    v_result,
    v_old_data, -- NULL for insert
    p_user_id
  );

  -- Notify Runtime
  PERFORM pg_notify('dzql_v2', json_build_object('commit_id', v_commit_id)::text);

  -- Remove hidden fields before returning to client
  RETURN v_result;
END;
$$;


CREATE OR REPLACE FUNCTION dzql_v2.delete_acts_for(p_user_id int, p_pk jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = dzql_v2, public
AS $$
DECLARE
  v_old_data jsonb;
  v_commit_id bigint;
BEGIN
  v_commit_id := nextval('dzql_v2.commit_seq');

  -- Fetch old data FIRST for permission check
  SELECT to_jsonb(acts_for.*) INTO v_old_data FROM acts_for WHERE user_id = (p_pk->>'user_id')::int AND org_id = (p_pk->>'org_id')::int AND valid_from = (p_pk->>'valid_from')::date;

  IF v_old_data IS NULL THEN
    RAISE EXCEPTION 'not_found';
  END IF;

  -- Permission Check (Delete)
  IF NOT (TRUE) THEN
    RAISE EXCEPTION 'permission_denied';
  END IF;

  -- Graph Rules (Pre-delete cascades)
  

  -- Perform Delete
  DELETE FROM acts_for WHERE user_id = (p_pk->>'user_id')::int AND org_id = (p_pk->>'org_id')::int AND valid_from = (p_pk->>'valid_from')::date;

  -- Emit Event (always 'delete' operation for client-side removal)
  INSERT INTO dzql_v2.events (commit_id, table_name, op, pk, data, old_data, user_id)
  VALUES (
    v_commit_id,
    'acts_for',
    'delete',
    jsonb_build_object('user_id', v_old_data->'user_id', 'org_id', v_old_data->'org_id', 'valid_from', v_old_data->'valid_from'),
    v_old_data,  -- Include full data for subscription resolution
    v_old_data,
    p_user_id
  );

  -- Notify Runtime
  PERFORM pg_notify('dzql_v2', json_build_object('commit_id', v_commit_id)::text);

  -- Remove hidden fields before returning to client
  RETURN v_old_data;
END;
$$;


CREATE OR REPLACE FUNCTION dzql_v2.get_acts_for(p_user_id int, p_pk jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = dzql_v2, public
AS $$
DECLARE
  v_result jsonb;
BEGIN
  SELECT to_jsonb(acts_for.*) INTO v_result
  FROM acts_for
  WHERE user_id = (p_pk->>'user_id')::int AND org_id = (p_pk->>'org_id')::int AND valid_from = (p_pk->>'valid_from')::date
    AND (TRUE);

  IF v_result IS NULL THEN
    RETURN NULL;
  END IF;


  RETURN v_result;
END;
$$;


CREATE OR REPLACE FUNCTION dzql_v2.search_acts_for(p_user_id int, p_query jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = dzql_v2, public
AS $$
DECLARE
  v_results jsonb;
  v_filters jsonb;
  v_sort_field text;
  v_sort_order text;
  v_where_clause text := '';
  v_field text;
  v_filter jsonb;
  v_operator text;
  v_value jsonb;
BEGIN
  -- Extract query parameters
  v_filters := COALESCE(p_query->'filters', '{}'::jsonb);
  v_sort_field := COALESCE(p_query->>'sort_field', 'org_id');
  v_sort_order := COALESCE(p_query->>'sort_order', 'asc');

  -- Build WHERE clause from filters
  FOR v_field, v_filter IN SELECT * FROM jsonb_each(v_filters)
  LOOP
    -- Handle simple value (exact match)
    IF jsonb_typeof(v_filter) IN ('string', 'number', 'boolean') THEN
      v_where_clause := v_where_clause || format(' AND %I::TEXT = %L', v_field, v_filter #>> '{}');
    ELSE
      -- Handle operator-based filters
      FOR v_operator, v_value IN SELECT * FROM jsonb_each(v_filter)
      LOOP
        CASE v_operator
          WHEN 'eq' THEN
            v_where_clause := v_where_clause || format(' AND %I::TEXT = %L', v_field, v_value #>> '{}');
          WHEN 'ne' THEN
            v_where_clause := v_where_clause || format(' AND %I::TEXT != %L', v_field, v_value #>> '{}');
          WHEN 'gt' THEN
            v_where_clause := v_where_clause || format(' AND %I > %L', v_field, v_value #>> '{}');
          WHEN 'gte' THEN
            v_where_clause := v_where_clause || format(' AND %I >= %L', v_field, v_value #>> '{}');
          WHEN 'lt' THEN
            v_where_clause := v_where_clause || format(' AND %I < %L', v_field, v_value #>> '{}');
          WHEN 'lte' THEN
            v_where_clause := v_where_clause || format(' AND %I <= %L', v_field, v_value #>> '{}');
          WHEN 'in' THEN
            v_where_clause := v_where_clause || format(' AND %I::TEXT = ANY(%L)', v_field,
              (SELECT array_agg(value #>> '{}') FROM jsonb_array_elements(v_value) AS value));
          WHEN 'not_in' THEN
            v_where_clause := v_where_clause || format(' AND %I::TEXT != ALL(%L)', v_field,
              (SELECT array_agg(value #>> '{}') FROM jsonb_array_elements(v_value) AS value));
          WHEN 'like' THEN
            v_where_clause := v_where_clause || format(' AND %I LIKE %L', v_field, v_value #>> '{}');
          WHEN 'ilike' THEN
            v_where_clause := v_where_clause || format(' AND %I ILIKE %L', v_field, v_value #>> '{}');
          WHEN 'is_null' THEN
            IF (v_value::text = 'true') THEN
              v_where_clause := v_where_clause || format(' AND %I IS NULL', v_field);
            END IF;
          WHEN 'not_null' THEN
            IF (v_value::text = 'true') THEN
              v_where_clause := v_where_clause || format(' AND %I IS NOT NULL', v_field);
            END IF;
          ELSE
            -- Unknown operator, skip
        END CASE;
      END LOOP;
    END IF;
  END LOOP;

  -- Execute dynamic query (sort inside subquery for correct LIMIT behavior)
  EXECUTE format('
    SELECT COALESCE(jsonb_agg(to_jsonb(t.*)), ''[]''::jsonb)
    FROM (
      SELECT * FROM acts_for
      WHERE (TRUE) %s
      ORDER BY %I %s
      LIMIT %L OFFSET %L
    ) t
  ', v_where_clause, v_sort_field, v_sort_order,
     COALESCE((p_query->>'limit')::int, 10),
     COALESCE((p_query->>'offset')::int, 0))
  INTO v_results;

  RETURN v_results;
END;
$$;


CREATE TABLE IF NOT EXISTS venues (
  id serial PRIMARY KEY,
  org_id int NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  name text UNIQUE NOT NULL,
  address text NOT NULL,
  description text
);


CREATE OR REPLACE FUNCTION dzql_v2.save_venues(p_user_id int, p_data jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = dzql_v2, public
AS $$
DECLARE
  v_result jsonb;
  v_old_data jsonb;
  v_commit_id bigint;
  v_op text;

BEGIN
  v_commit_id := nextval('dzql_v2.commit_seq');


  -- Determine Operation & Check Permissions (supports composite PK)
  IF ((p_data->>'id') IS NOT NULL) AND EXISTS(SELECT 1 FROM venues WHERE id = (p_data->>'id')::int) THEN
    v_op := 'update';

    -- Fetch old data for update rules/events
    SELECT to_jsonb(venues.*) INTO v_old_data FROM venues WHERE id = (p_data->>'id')::int;

    IF NOT (EXISTS (SELECT 1 FROM acts_for WHERE acts_for.org_id = (p_data->>'org_id')::int AND acts_for.active = true AND acts_for.user_id = p_user_id)) THEN
      RAISE EXCEPTION 'permission_denied';
    END IF;

    -- Perform Partial Update
    UPDATE venues SET
    org_id = CASE WHEN (p_data ? 'org_id') THEN (p_data->>'org_id')::int ELSE org_id END,
    name = CASE WHEN (p_data ? 'name') THEN (p_data->>'name') ELSE name END,
    address = CASE WHEN (p_data ? 'address') THEN (p_data->>'address') ELSE address END,
    description = CASE WHEN (p_data ? 'description') THEN (p_data->>'description') ELSE description END
    WHERE id = (p_data->>'id')::int
    RETURNING to_jsonb(venues.*) INTO v_result;

    

  ELSE
    v_op := 'insert';
    IF NOT (EXISTS (SELECT 1 FROM acts_for WHERE acts_for.org_id = (p_data->>'org_id')::int AND acts_for.active = true AND acts_for.user_id = p_user_id)) THEN
      RAISE EXCEPTION 'permission_denied';
    END IF;

    -- Perform Insert
    INSERT INTO venues (org_id, name, address, description)
    VALUES ((p_data->>'org_id')::int, (p_data->>'name'), (p_data->>'address'), (p_data->>'description'))
    RETURNING to_jsonb(venues.*) INTO v_result;

    
  END IF;



  -- Emit Event
  INSERT INTO dzql_v2.events (commit_id, table_name, op, pk, data, old_data, user_id)
  VALUES (
    v_commit_id,
    'venues',
    v_op,
    jsonb_build_object('id', v_result->'id'),
    v_result,
    v_old_data, -- NULL for insert
    p_user_id
  );

  -- Notify Runtime
  PERFORM pg_notify('dzql_v2', json_build_object('commit_id', v_commit_id)::text);

  -- Remove hidden fields before returning to client
  RETURN v_result;
END;
$$;


CREATE OR REPLACE FUNCTION dzql_v2.delete_venues(p_user_id int, p_pk jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = dzql_v2, public
AS $$
DECLARE
  v_old_data jsonb;
  v_commit_id bigint;
BEGIN
  v_commit_id := nextval('dzql_v2.commit_seq');

  -- Fetch old data FIRST for permission check
  SELECT to_jsonb(venues.*) INTO v_old_data FROM venues WHERE id = (p_pk->>'id')::int;

  IF v_old_data IS NULL THEN
    RAISE EXCEPTION 'not_found';
  END IF;

  -- Permission Check (Delete)
  IF NOT (EXISTS (SELECT 1 FROM acts_for WHERE acts_for.org_id = (v_old_data->>'org_id')::int AND acts_for.active = true AND acts_for.user_id = p_user_id)) THEN
    RAISE EXCEPTION 'permission_denied';
  END IF;

  -- Graph Rules (Pre-delete cascades)
  

  -- Perform Delete
  DELETE FROM venues WHERE id = (p_pk->>'id')::int;

  -- Emit Event (always 'delete' operation for client-side removal)
  INSERT INTO dzql_v2.events (commit_id, table_name, op, pk, data, old_data, user_id)
  VALUES (
    v_commit_id,
    'venues',
    'delete',
    jsonb_build_object('id', v_old_data->'id'),
    v_old_data,  -- Include full data for subscription resolution
    v_old_data,
    p_user_id
  );

  -- Notify Runtime
  PERFORM pg_notify('dzql_v2', json_build_object('commit_id', v_commit_id)::text);

  -- Remove hidden fields before returning to client
  RETURN v_old_data;
END;
$$;


CREATE OR REPLACE FUNCTION dzql_v2.get_venues(p_user_id int, p_pk jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = dzql_v2, public
AS $$
DECLARE
  v_result jsonb;
BEGIN
  SELECT to_jsonb(venues.*) INTO v_result
  FROM venues
  WHERE id = (p_pk->>'id')::int
    AND (TRUE);

  IF v_result IS NULL THEN
    RETURN NULL;
  END IF;


  RETURN v_result;
END;
$$;


CREATE OR REPLACE FUNCTION dzql_v2.search_venues(p_user_id int, p_query jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = dzql_v2, public
AS $$
DECLARE
  v_results jsonb;
  v_filters jsonb;
  v_sort_field text;
  v_sort_order text;
  v_where_clause text := '';
  v_field text;
  v_filter jsonb;
  v_operator text;
  v_value jsonb;
BEGIN
  -- Extract query parameters
  v_filters := COALESCE(p_query->'filters', '{}'::jsonb);
  v_sort_field := COALESCE(p_query->>'sort_field', 'name');
  v_sort_order := COALESCE(p_query->>'sort_order', 'asc');

  -- Build WHERE clause from filters
  FOR v_field, v_filter IN SELECT * FROM jsonb_each(v_filters)
  LOOP
    -- Handle simple value (exact match)
    IF jsonb_typeof(v_filter) IN ('string', 'number', 'boolean') THEN
      v_where_clause := v_where_clause || format(' AND %I::TEXT = %L', v_field, v_filter #>> '{}');
    ELSE
      -- Handle operator-based filters
      FOR v_operator, v_value IN SELECT * FROM jsonb_each(v_filter)
      LOOP
        CASE v_operator
          WHEN 'eq' THEN
            v_where_clause := v_where_clause || format(' AND %I::TEXT = %L', v_field, v_value #>> '{}');
          WHEN 'ne' THEN
            v_where_clause := v_where_clause || format(' AND %I::TEXT != %L', v_field, v_value #>> '{}');
          WHEN 'gt' THEN
            v_where_clause := v_where_clause || format(' AND %I > %L', v_field, v_value #>> '{}');
          WHEN 'gte' THEN
            v_where_clause := v_where_clause || format(' AND %I >= %L', v_field, v_value #>> '{}');
          WHEN 'lt' THEN
            v_where_clause := v_where_clause || format(' AND %I < %L', v_field, v_value #>> '{}');
          WHEN 'lte' THEN
            v_where_clause := v_where_clause || format(' AND %I <= %L', v_field, v_value #>> '{}');
          WHEN 'in' THEN
            v_where_clause := v_where_clause || format(' AND %I::TEXT = ANY(%L)', v_field,
              (SELECT array_agg(value #>> '{}') FROM jsonb_array_elements(v_value) AS value));
          WHEN 'not_in' THEN
            v_where_clause := v_where_clause || format(' AND %I::TEXT != ALL(%L)', v_field,
              (SELECT array_agg(value #>> '{}') FROM jsonb_array_elements(v_value) AS value));
          WHEN 'like' THEN
            v_where_clause := v_where_clause || format(' AND %I LIKE %L', v_field, v_value #>> '{}');
          WHEN 'ilike' THEN
            v_where_clause := v_where_clause || format(' AND %I ILIKE %L', v_field, v_value #>> '{}');
          WHEN 'is_null' THEN
            IF (v_value::text = 'true') THEN
              v_where_clause := v_where_clause || format(' AND %I IS NULL', v_field);
            END IF;
          WHEN 'not_null' THEN
            IF (v_value::text = 'true') THEN
              v_where_clause := v_where_clause || format(' AND %I IS NOT NULL', v_field);
            END IF;
          ELSE
            -- Unknown operator, skip
        END CASE;
      END LOOP;
    END IF;
  END LOOP;

  -- Execute dynamic query (sort inside subquery for correct LIMIT behavior)
  EXECUTE format('
    SELECT COALESCE(jsonb_agg(to_jsonb(t.*)), ''[]''::jsonb)
    FROM (
      SELECT * FROM venues
      WHERE (TRUE) %s
      ORDER BY %I %s
      LIMIT %L OFFSET %L
    ) t
  ', v_where_clause, v_sort_field, v_sort_order,
     COALESCE((p_query->>'limit')::int, 10),
     COALESCE((p_query->>'offset')::int, 0))
  INTO v_results;

  RETURN v_results;
END;
$$;


CREATE TABLE IF NOT EXISTS sites (
  id serial PRIMARY KEY,
  venue_id int NOT NULL REFERENCES venues(id),
  name text NOT NULL,
  description text
);


CREATE OR REPLACE FUNCTION dzql_v2.save_sites(p_user_id int, p_data jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = dzql_v2, public
AS $$
DECLARE
  v_result jsonb;
  v_old_data jsonb;
  v_commit_id bigint;
  v_op text;

BEGIN
  v_commit_id := nextval('dzql_v2.commit_seq');


  -- Determine Operation & Check Permissions (supports composite PK)
  IF ((p_data->>'id') IS NOT NULL) AND EXISTS(SELECT 1 FROM sites WHERE id = (p_data->>'id')::int) THEN
    v_op := 'update';

    -- Fetch old data for update rules/events
    SELECT to_jsonb(sites.*) INTO v_old_data FROM sites WHERE id = (p_data->>'id')::int;

    IF NOT (EXISTS (SELECT 1 FROM acts_for WHERE acts_for.org_id = (SELECT org_id FROM venues WHERE id = (p_data->>'venue_id')::int) AND acts_for.active = true AND acts_for.user_id = p_user_id)) THEN
      RAISE EXCEPTION 'permission_denied';
    END IF;

    -- Perform Partial Update
    UPDATE sites SET
    venue_id = CASE WHEN (p_data ? 'venue_id') THEN (p_data->>'venue_id')::int ELSE venue_id END,
    name = CASE WHEN (p_data ? 'name') THEN (p_data->>'name') ELSE name END,
    description = CASE WHEN (p_data ? 'description') THEN (p_data->>'description') ELSE description END
    WHERE id = (p_data->>'id')::int
    RETURNING to_jsonb(sites.*) INTO v_result;

    

  ELSE
    v_op := 'insert';
    IF NOT (EXISTS (SELECT 1 FROM acts_for WHERE acts_for.org_id = (SELECT org_id FROM venues WHERE id = (p_data->>'venue_id')::int) AND acts_for.active = true AND acts_for.user_id = p_user_id)) THEN
      RAISE EXCEPTION 'permission_denied';
    END IF;

    -- Perform Insert
    INSERT INTO sites (venue_id, name, description)
    VALUES ((p_data->>'venue_id')::int, (p_data->>'name'), (p_data->>'description'))
    RETURNING to_jsonb(sites.*) INTO v_result;

    
  END IF;



  -- Emit Event
  INSERT INTO dzql_v2.events (commit_id, table_name, op, pk, data, old_data, user_id)
  VALUES (
    v_commit_id,
    'sites',
    v_op,
    jsonb_build_object('id', v_result->'id'),
    v_result,
    v_old_data, -- NULL for insert
    p_user_id
  );

  -- Notify Runtime
  PERFORM pg_notify('dzql_v2', json_build_object('commit_id', v_commit_id)::text);

  -- Remove hidden fields before returning to client
  RETURN v_result;
END;
$$;


CREATE OR REPLACE FUNCTION dzql_v2.delete_sites(p_user_id int, p_pk jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = dzql_v2, public
AS $$
DECLARE
  v_old_data jsonb;
  v_commit_id bigint;
BEGIN
  v_commit_id := nextval('dzql_v2.commit_seq');

  -- Fetch old data FIRST for permission check
  SELECT to_jsonb(sites.*) INTO v_old_data FROM sites WHERE id = (p_pk->>'id')::int;

  IF v_old_data IS NULL THEN
    RAISE EXCEPTION 'not_found';
  END IF;

  -- Permission Check (Delete)
  IF NOT (EXISTS (SELECT 1 FROM acts_for WHERE acts_for.org_id = (SELECT org_id FROM venues WHERE id = (v_old_data->>'venue_id')::int) AND acts_for.active = true AND acts_for.user_id = p_user_id)) THEN
    RAISE EXCEPTION 'permission_denied';
  END IF;

  -- Graph Rules (Pre-delete cascades)
  

  -- Perform Delete
  DELETE FROM sites WHERE id = (p_pk->>'id')::int;

  -- Emit Event (always 'delete' operation for client-side removal)
  INSERT INTO dzql_v2.events (commit_id, table_name, op, pk, data, old_data, user_id)
  VALUES (
    v_commit_id,
    'sites',
    'delete',
    jsonb_build_object('id', v_old_data->'id'),
    v_old_data,  -- Include full data for subscription resolution
    v_old_data,
    p_user_id
  );

  -- Notify Runtime
  PERFORM pg_notify('dzql_v2', json_build_object('commit_id', v_commit_id)::text);

  -- Remove hidden fields before returning to client
  RETURN v_old_data;
END;
$$;


CREATE OR REPLACE FUNCTION dzql_v2.get_sites(p_user_id int, p_pk jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = dzql_v2, public
AS $$
DECLARE
  v_result jsonb;
BEGIN
  SELECT to_jsonb(sites.*) INTO v_result
  FROM sites
  WHERE id = (p_pk->>'id')::int
    AND (TRUE);

  IF v_result IS NULL THEN
    RETURN NULL;
  END IF;


  RETURN v_result;
END;
$$;


CREATE OR REPLACE FUNCTION dzql_v2.search_sites(p_user_id int, p_query jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = dzql_v2, public
AS $$
DECLARE
  v_results jsonb;
  v_filters jsonb;
  v_sort_field text;
  v_sort_order text;
  v_where_clause text := '';
  v_field text;
  v_filter jsonb;
  v_operator text;
  v_value jsonb;
BEGIN
  -- Extract query parameters
  v_filters := COALESCE(p_query->'filters', '{}'::jsonb);
  v_sort_field := COALESCE(p_query->>'sort_field', 'name');
  v_sort_order := COALESCE(p_query->>'sort_order', 'asc');

  -- Build WHERE clause from filters
  FOR v_field, v_filter IN SELECT * FROM jsonb_each(v_filters)
  LOOP
    -- Handle simple value (exact match)
    IF jsonb_typeof(v_filter) IN ('string', 'number', 'boolean') THEN
      v_where_clause := v_where_clause || format(' AND %I::TEXT = %L', v_field, v_filter #>> '{}');
    ELSE
      -- Handle operator-based filters
      FOR v_operator, v_value IN SELECT * FROM jsonb_each(v_filter)
      LOOP
        CASE v_operator
          WHEN 'eq' THEN
            v_where_clause := v_where_clause || format(' AND %I::TEXT = %L', v_field, v_value #>> '{}');
          WHEN 'ne' THEN
            v_where_clause := v_where_clause || format(' AND %I::TEXT != %L', v_field, v_value #>> '{}');
          WHEN 'gt' THEN
            v_where_clause := v_where_clause || format(' AND %I > %L', v_field, v_value #>> '{}');
          WHEN 'gte' THEN
            v_where_clause := v_where_clause || format(' AND %I >= %L', v_field, v_value #>> '{}');
          WHEN 'lt' THEN
            v_where_clause := v_where_clause || format(' AND %I < %L', v_field, v_value #>> '{}');
          WHEN 'lte' THEN
            v_where_clause := v_where_clause || format(' AND %I <= %L', v_field, v_value #>> '{}');
          WHEN 'in' THEN
            v_where_clause := v_where_clause || format(' AND %I::TEXT = ANY(%L)', v_field,
              (SELECT array_agg(value #>> '{}') FROM jsonb_array_elements(v_value) AS value));
          WHEN 'not_in' THEN
            v_where_clause := v_where_clause || format(' AND %I::TEXT != ALL(%L)', v_field,
              (SELECT array_agg(value #>> '{}') FROM jsonb_array_elements(v_value) AS value));
          WHEN 'like' THEN
            v_where_clause := v_where_clause || format(' AND %I LIKE %L', v_field, v_value #>> '{}');
          WHEN 'ilike' THEN
            v_where_clause := v_where_clause || format(' AND %I ILIKE %L', v_field, v_value #>> '{}');
          WHEN 'is_null' THEN
            IF (v_value::text = 'true') THEN
              v_where_clause := v_where_clause || format(' AND %I IS NULL', v_field);
            END IF;
          WHEN 'not_null' THEN
            IF (v_value::text = 'true') THEN
              v_where_clause := v_where_clause || format(' AND %I IS NOT NULL', v_field);
            END IF;
          ELSE
            -- Unknown operator, skip
        END CASE;
      END LOOP;
    END IF;
  END LOOP;

  -- Execute dynamic query (sort inside subquery for correct LIMIT behavior)
  EXECUTE format('
    SELECT COALESCE(jsonb_agg(to_jsonb(t.*)), ''[]''::jsonb)
    FROM (
      SELECT * FROM sites
      WHERE (TRUE) %s
      ORDER BY %I %s
      LIMIT %L OFFSET %L
    ) t
  ', v_where_clause, v_sort_field, v_sort_order,
     COALESCE((p_query->>'limit')::int, 10),
     COALESCE((p_query->>'offset')::int, 0))
  INTO v_results;

  RETURN v_results;
END;
$$;


CREATE TABLE IF NOT EXISTS products (
  id serial PRIMARY KEY,
  org_id int NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  name text UNIQUE NOT NULL,
  description text,
  price decimal(10, 2) NOT NULL DEFAULT 0.00,
  created_by int REFERENCES users(id),
  created_at timestamptz,
  deleted_at timestamptz
);


CREATE OR REPLACE FUNCTION dzql_v2.save_products(p_user_id int, p_data jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = dzql_v2, public
AS $$
DECLARE
  v_result jsonb;
  v_old_data jsonb;
  v_commit_id bigint;
  v_op text;

BEGIN
  v_commit_id := nextval('dzql_v2.commit_seq');


  -- Determine Operation & Check Permissions (supports composite PK)
  IF ((p_data->>'id') IS NOT NULL) AND EXISTS(SELECT 1 FROM products WHERE id = (p_data->>'id')::int) THEN
    v_op := 'update';

    -- Fetch old data for update rules/events
    SELECT to_jsonb(products.*) INTO v_old_data FROM products WHERE id = (p_data->>'id')::int;

    IF NOT (EXISTS (SELECT 1 FROM acts_for WHERE acts_for.org_id = (p_data->>'org_id')::int AND acts_for.active = true AND acts_for.user_id = p_user_id)) THEN
      RAISE EXCEPTION 'permission_denied';
    END IF;

    -- Perform Partial Update
    UPDATE products SET
    org_id = CASE WHEN (p_data ? 'org_id') THEN (p_data->>'org_id')::int ELSE org_id END,
    name = CASE WHEN (p_data ? 'name') THEN (p_data->>'name') ELSE name END,
    description = CASE WHEN (p_data ? 'description') THEN (p_data->>'description') ELSE description END,
    price = CASE WHEN (p_data ? 'price') THEN (p_data->>'price')::numeric ELSE price END,
    created_by = CASE WHEN (p_data ? 'created_by') THEN (p_data->>'created_by')::int ELSE created_by END,
    created_at = CASE WHEN (p_data ? 'created_at') THEN (p_data->>'created_at')::timestamptz ELSE created_at END,
    deleted_at = CASE WHEN (p_data ? 'deleted_at') THEN (p_data->>'deleted_at')::timestamptz ELSE deleted_at END
    WHERE id = (p_data->>'id')::int
    RETURNING to_jsonb(products.*) INTO v_result;

    

  ELSE
    v_op := 'insert';
    IF NOT (EXISTS (SELECT 1 FROM acts_for WHERE acts_for.org_id = (p_data->>'org_id')::int AND acts_for.active = true AND acts_for.user_id = p_user_id)) THEN
      RAISE EXCEPTION 'permission_denied';
    END IF;

    -- Perform Insert
    INSERT INTO products (org_id, name, description, price, created_by, created_at, deleted_at)
    VALUES ((p_data->>'org_id')::int, (p_data->>'name'), (p_data->>'description'), (p_data->>'price')::numeric, COALESCE((p_data->>'created_by')::int, p_user_id), COALESCE((p_data->>'created_at')::timestamptz, now()), (p_data->>'deleted_at')::timestamptz)
    RETURNING to_jsonb(products.*) INTO v_result;

    
  END IF;



  -- Emit Event
  INSERT INTO dzql_v2.events (commit_id, table_name, op, pk, data, old_data, user_id)
  VALUES (
    v_commit_id,
    'products',
    v_op,
    jsonb_build_object('id', v_result->'id'),
    v_result,
    v_old_data, -- NULL for insert
    p_user_id
  );

  -- Notify Runtime
  PERFORM pg_notify('dzql_v2', json_build_object('commit_id', v_commit_id)::text);

  -- Remove hidden fields before returning to client
  RETURN v_result;
END;
$$;


CREATE OR REPLACE FUNCTION dzql_v2.delete_products(p_user_id int, p_pk jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = dzql_v2, public
AS $$
DECLARE
  v_old_data jsonb;
  v_commit_id bigint;
BEGIN
  v_commit_id := nextval('dzql_v2.commit_seq');

  -- Fetch old data FIRST for permission check
  SELECT to_jsonb(products.*) INTO v_old_data FROM products WHERE id = (p_pk->>'id')::int;

  IF v_old_data IS NULL THEN
    RAISE EXCEPTION 'not_found';
  END IF;

  -- Permission Check (Delete)
  IF NOT (EXISTS (SELECT 1 FROM acts_for WHERE acts_for.org_id = (v_old_data->>'org_id')::int AND acts_for.active = true AND acts_for.user_id = p_user_id)) THEN
    RAISE EXCEPTION 'permission_denied';
  END IF;

  -- Graph Rules (Pre-delete cascades)
  

  -- Perform Soft Delete
  UPDATE products SET deleted_at = now() WHERE id = (p_pk->>'id')::int;

  -- Emit Event (always 'delete' operation for client-side removal)
  INSERT INTO dzql_v2.events (commit_id, table_name, op, pk, data, old_data, user_id)
  VALUES (
    v_commit_id,
    'products',
    'delete',
    jsonb_build_object('id', v_old_data->'id'),
    v_old_data,  -- Include full data for subscription resolution
    v_old_data,
    p_user_id
  );

  -- Notify Runtime
  PERFORM pg_notify('dzql_v2', json_build_object('commit_id', v_commit_id)::text);

  -- Remove hidden fields before returning to client
  RETURN v_old_data;
END;
$$;


CREATE OR REPLACE FUNCTION dzql_v2.get_products(p_user_id int, p_pk jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = dzql_v2, public
AS $$
DECLARE
  v_result jsonb;
BEGIN
  SELECT to_jsonb(products.*) INTO v_result
  FROM products
  WHERE id = (p_pk->>'id')::int
    AND (TRUE);

  IF v_result IS NULL THEN
    RETURN NULL;
  END IF;


  RETURN v_result;
END;
$$;


CREATE OR REPLACE FUNCTION dzql_v2.search_products(p_user_id int, p_query jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = dzql_v2, public
AS $$
DECLARE
  v_results jsonb;
  v_filters jsonb;
  v_sort_field text;
  v_sort_order text;
  v_where_clause text := '';
  v_field text;
  v_filter jsonb;
  v_operator text;
  v_value jsonb;
BEGIN
  -- Extract query parameters
  v_filters := COALESCE(p_query->'filters', '{}'::jsonb);
  v_sort_field := COALESCE(p_query->>'sort_field', 'name');
  v_sort_order := COALESCE(p_query->>'sort_order', 'asc');

  -- Build WHERE clause from filters
  FOR v_field, v_filter IN SELECT * FROM jsonb_each(v_filters)
  LOOP
    -- Handle simple value (exact match)
    IF jsonb_typeof(v_filter) IN ('string', 'number', 'boolean') THEN
      v_where_clause := v_where_clause || format(' AND %I::TEXT = %L', v_field, v_filter #>> '{}');
    ELSE
      -- Handle operator-based filters
      FOR v_operator, v_value IN SELECT * FROM jsonb_each(v_filter)
      LOOP
        CASE v_operator
          WHEN 'eq' THEN
            v_where_clause := v_where_clause || format(' AND %I::TEXT = %L', v_field, v_value #>> '{}');
          WHEN 'ne' THEN
            v_where_clause := v_where_clause || format(' AND %I::TEXT != %L', v_field, v_value #>> '{}');
          WHEN 'gt' THEN
            v_where_clause := v_where_clause || format(' AND %I > %L', v_field, v_value #>> '{}');
          WHEN 'gte' THEN
            v_where_clause := v_where_clause || format(' AND %I >= %L', v_field, v_value #>> '{}');
          WHEN 'lt' THEN
            v_where_clause := v_where_clause || format(' AND %I < %L', v_field, v_value #>> '{}');
          WHEN 'lte' THEN
            v_where_clause := v_where_clause || format(' AND %I <= %L', v_field, v_value #>> '{}');
          WHEN 'in' THEN
            v_where_clause := v_where_clause || format(' AND %I::TEXT = ANY(%L)', v_field,
              (SELECT array_agg(value #>> '{}') FROM jsonb_array_elements(v_value) AS value));
          WHEN 'not_in' THEN
            v_where_clause := v_where_clause || format(' AND %I::TEXT != ALL(%L)', v_field,
              (SELECT array_agg(value #>> '{}') FROM jsonb_array_elements(v_value) AS value));
          WHEN 'like' THEN
            v_where_clause := v_where_clause || format(' AND %I LIKE %L', v_field, v_value #>> '{}');
          WHEN 'ilike' THEN
            v_where_clause := v_where_clause || format(' AND %I ILIKE %L', v_field, v_value #>> '{}');
          WHEN 'is_null' THEN
            IF (v_value::text = 'true') THEN
              v_where_clause := v_where_clause || format(' AND %I IS NULL', v_field);
            END IF;
          WHEN 'not_null' THEN
            IF (v_value::text = 'true') THEN
              v_where_clause := v_where_clause || format(' AND %I IS NOT NULL', v_field);
            END IF;
          ELSE
            -- Unknown operator, skip
        END CASE;
      END LOOP;
    END IF;
  END LOOP;

  -- Execute dynamic query (sort inside subquery for correct LIMIT behavior)
  EXECUTE format('
    SELECT COALESCE(jsonb_agg(to_jsonb(t.*)), ''[]''::jsonb)
    FROM (
      SELECT * FROM products
      WHERE (TRUE) AND deleted_at IS NULL %s
      ORDER BY %I %s
      LIMIT %L OFFSET %L
    ) t
  ', v_where_clause, v_sort_field, v_sort_order,
     COALESCE((p_query->>'limit')::int, 10),
     COALESCE((p_query->>'offset')::int, 0))
  INTO v_results;

  RETURN v_results;
END;
$$;


CREATE TABLE IF NOT EXISTS packages (
  id serial PRIMARY KEY,
  owner_org_id int NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  sponsor_org_id int REFERENCES organisations(id) ON DELETE SET NULL,
  name text NOT NULL,
  price decimal(10, 2) NOT NULL DEFAULT 0.00,
  status text NOT NULL DEFAULT 'draft'
);


CREATE OR REPLACE FUNCTION dzql_v2.save_packages(p_user_id int, p_data jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = dzql_v2, public
AS $$
DECLARE
  v_result jsonb;
  v_old_data jsonb;
  v_commit_id bigint;
  v_op text;

BEGIN
  v_commit_id := nextval('dzql_v2.commit_seq');


  -- Determine Operation & Check Permissions (supports composite PK)
  IF ((p_data->>'id') IS NOT NULL) AND EXISTS(SELECT 1 FROM packages WHERE id = (p_data->>'id')::int) THEN
    v_op := 'update';

    -- Fetch old data for update rules/events
    SELECT to_jsonb(packages.*) INTO v_old_data FROM packages WHERE id = (p_data->>'id')::int;

    IF NOT (EXISTS (SELECT 1 FROM acts_for WHERE acts_for.org_id = (p_data->>'owner_org_id')::int AND acts_for.active = true AND acts_for.user_id = p_user_id)) THEN
      RAISE EXCEPTION 'permission_denied';
    END IF;

    -- Perform Partial Update
    UPDATE packages SET
    owner_org_id = CASE WHEN (p_data ? 'owner_org_id') THEN (p_data->>'owner_org_id')::int ELSE owner_org_id END,
    sponsor_org_id = CASE WHEN (p_data ? 'sponsor_org_id') THEN (p_data->>'sponsor_org_id')::int ELSE sponsor_org_id END,
    name = CASE WHEN (p_data ? 'name') THEN (p_data->>'name') ELSE name END,
    price = CASE WHEN (p_data ? 'price') THEN (p_data->>'price')::numeric ELSE price END,
    status = CASE WHEN (p_data ? 'status') THEN (p_data->>'status') ELSE status END
    WHERE id = (p_data->>'id')::int
    RETURNING to_jsonb(packages.*) INTO v_result;

    

  ELSE
    v_op := 'insert';
    IF NOT (EXISTS (SELECT 1 FROM acts_for WHERE acts_for.org_id = (p_data->>'owner_org_id')::int AND acts_for.active = true AND acts_for.user_id = p_user_id)) THEN
      RAISE EXCEPTION 'permission_denied';
    END IF;

    -- Perform Insert
    INSERT INTO packages (owner_org_id, sponsor_org_id, name, price, status)
    VALUES ((p_data->>'owner_org_id')::int, (p_data->>'sponsor_org_id')::int, (p_data->>'name'), (p_data->>'price')::numeric, (p_data->>'status'))
    RETURNING to_jsonb(packages.*) INTO v_result;

    
  END IF;



  -- Emit Event
  INSERT INTO dzql_v2.events (commit_id, table_name, op, pk, data, old_data, user_id)
  VALUES (
    v_commit_id,
    'packages',
    v_op,
    jsonb_build_object('id', v_result->'id'),
    v_result,
    v_old_data, -- NULL for insert
    p_user_id
  );

  -- Notify Runtime
  PERFORM pg_notify('dzql_v2', json_build_object('commit_id', v_commit_id)::text);

  -- Remove hidden fields before returning to client
  RETURN v_result;
END;
$$;


CREATE OR REPLACE FUNCTION dzql_v2.delete_packages(p_user_id int, p_pk jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = dzql_v2, public
AS $$
DECLARE
  v_old_data jsonb;
  v_commit_id bigint;
BEGIN
  v_commit_id := nextval('dzql_v2.commit_seq');

  -- Fetch old data FIRST for permission check
  SELECT to_jsonb(packages.*) INTO v_old_data FROM packages WHERE id = (p_pk->>'id')::int;

  IF v_old_data IS NULL THEN
    RAISE EXCEPTION 'not_found';
  END IF;

  -- Permission Check (Delete)
  IF NOT (EXISTS (SELECT 1 FROM acts_for WHERE acts_for.org_id = (v_old_data->>'owner_org_id')::int AND acts_for.active = true AND acts_for.user_id = p_user_id)) THEN
    RAISE EXCEPTION 'permission_denied';
  END IF;

  -- Graph Rules (Pre-delete cascades)
  

  -- Perform Delete
  DELETE FROM packages WHERE id = (p_pk->>'id')::int;

  -- Emit Event (always 'delete' operation for client-side removal)
  INSERT INTO dzql_v2.events (commit_id, table_name, op, pk, data, old_data, user_id)
  VALUES (
    v_commit_id,
    'packages',
    'delete',
    jsonb_build_object('id', v_old_data->'id'),
    v_old_data,  -- Include full data for subscription resolution
    v_old_data,
    p_user_id
  );

  -- Notify Runtime
  PERFORM pg_notify('dzql_v2', json_build_object('commit_id', v_commit_id)::text);

  -- Remove hidden fields before returning to client
  RETURN v_old_data;
END;
$$;


CREATE OR REPLACE FUNCTION dzql_v2.get_packages(p_user_id int, p_pk jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = dzql_v2, public
AS $$
DECLARE
  v_result jsonb;
BEGIN
  SELECT to_jsonb(packages.*) INTO v_result
  FROM packages
  WHERE id = (p_pk->>'id')::int
    AND (EXISTS (SELECT 1 FROM acts_for WHERE acts_for.org_id = packages.owner_org_id AND acts_for.active = true AND acts_for.user_id = p_user_id) OR EXISTS (SELECT 1 FROM acts_for WHERE acts_for.org_id = packages.sponsor_org_id AND acts_for.active = true AND acts_for.user_id = p_user_id));

  IF v_result IS NULL THEN
    RETURN NULL;
  END IF;


  RETURN v_result;
END;
$$;


CREATE OR REPLACE FUNCTION dzql_v2.search_packages(p_user_id int, p_query jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = dzql_v2, public
AS $$
DECLARE
  v_results jsonb;
  v_filters jsonb;
  v_sort_field text;
  v_sort_order text;
  v_where_clause text := '';
  v_field text;
  v_filter jsonb;
  v_operator text;
  v_value jsonb;
BEGIN
  -- Extract query parameters
  v_filters := COALESCE(p_query->'filters', '{}'::jsonb);
  v_sort_field := COALESCE(p_query->>'sort_field', 'name');
  v_sort_order := COALESCE(p_query->>'sort_order', 'asc');

  -- Build WHERE clause from filters
  FOR v_field, v_filter IN SELECT * FROM jsonb_each(v_filters)
  LOOP
    -- Handle simple value (exact match)
    IF jsonb_typeof(v_filter) IN ('string', 'number', 'boolean') THEN
      v_where_clause := v_where_clause || format(' AND %I::TEXT = %L', v_field, v_filter #>> '{}');
    ELSE
      -- Handle operator-based filters
      FOR v_operator, v_value IN SELECT * FROM jsonb_each(v_filter)
      LOOP
        CASE v_operator
          WHEN 'eq' THEN
            v_where_clause := v_where_clause || format(' AND %I::TEXT = %L', v_field, v_value #>> '{}');
          WHEN 'ne' THEN
            v_where_clause := v_where_clause || format(' AND %I::TEXT != %L', v_field, v_value #>> '{}');
          WHEN 'gt' THEN
            v_where_clause := v_where_clause || format(' AND %I > %L', v_field, v_value #>> '{}');
          WHEN 'gte' THEN
            v_where_clause := v_where_clause || format(' AND %I >= %L', v_field, v_value #>> '{}');
          WHEN 'lt' THEN
            v_where_clause := v_where_clause || format(' AND %I < %L', v_field, v_value #>> '{}');
          WHEN 'lte' THEN
            v_where_clause := v_where_clause || format(' AND %I <= %L', v_field, v_value #>> '{}');
          WHEN 'in' THEN
            v_where_clause := v_where_clause || format(' AND %I::TEXT = ANY(%L)', v_field,
              (SELECT array_agg(value #>> '{}') FROM jsonb_array_elements(v_value) AS value));
          WHEN 'not_in' THEN
            v_where_clause := v_where_clause || format(' AND %I::TEXT != ALL(%L)', v_field,
              (SELECT array_agg(value #>> '{}') FROM jsonb_array_elements(v_value) AS value));
          WHEN 'like' THEN
            v_where_clause := v_where_clause || format(' AND %I LIKE %L', v_field, v_value #>> '{}');
          WHEN 'ilike' THEN
            v_where_clause := v_where_clause || format(' AND %I ILIKE %L', v_field, v_value #>> '{}');
          WHEN 'is_null' THEN
            IF (v_value::text = 'true') THEN
              v_where_clause := v_where_clause || format(' AND %I IS NULL', v_field);
            END IF;
          WHEN 'not_null' THEN
            IF (v_value::text = 'true') THEN
              v_where_clause := v_where_clause || format(' AND %I IS NOT NULL', v_field);
            END IF;
          ELSE
            -- Unknown operator, skip
        END CASE;
      END LOOP;
    END IF;
  END LOOP;

  -- Execute dynamic query (sort inside subquery for correct LIMIT behavior)
  EXECUTE format('
    SELECT COALESCE(jsonb_agg(to_jsonb(t.*)), ''[]''::jsonb)
    FROM (
      SELECT * FROM packages
      WHERE (EXISTS (SELECT 1 FROM acts_for WHERE acts_for.org_id = packages.owner_org_id AND acts_for.active = true AND acts_for.user_id = p_user_id) OR EXISTS (SELECT 1 FROM acts_for WHERE acts_for.org_id = packages.sponsor_org_id AND acts_for.active = true AND acts_for.user_id = p_user_id)) %s
      ORDER BY %I %s
      LIMIT %L OFFSET %L
    ) t
  ', v_where_clause, v_sort_field, v_sort_order,
     COALESCE((p_query->>'limit')::int, 10),
     COALESCE((p_query->>'offset')::int, 0))
  INTO v_results;

  RETURN v_results;
END;
$$;


CREATE TABLE IF NOT EXISTS allocations (
  id serial PRIMARY KEY,
  package_id int NOT NULL REFERENCES packages(id),
  site_id int NOT NULL REFERENCES sites(id),
  from_date date NOT NULL,
  to_date date NOT NULL
);


CREATE OR REPLACE FUNCTION dzql_v2.save_allocations(p_user_id int, p_data jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = dzql_v2, public
AS $$
DECLARE
  v_result jsonb;
  v_old_data jsonb;
  v_commit_id bigint;
  v_op text;

BEGIN
  v_commit_id := nextval('dzql_v2.commit_seq');


  -- Determine Operation & Check Permissions (supports composite PK)
  IF ((p_data->>'id') IS NOT NULL) AND EXISTS(SELECT 1 FROM allocations WHERE id = (p_data->>'id')::int) THEN
    v_op := 'update';

    -- Fetch old data for update rules/events
    SELECT to_jsonb(allocations.*) INTO v_old_data FROM allocations WHERE id = (p_data->>'id')::int;

    IF NOT (EXISTS (SELECT 1 FROM acts_for WHERE acts_for.org_id = (SELECT org_id FROM venues WHERE id = (SELECT venue_id FROM sites WHERE id = (p_data->>'site_id')::int)) AND acts_for.active = true AND acts_for.user_id = p_user_id)) THEN
      RAISE EXCEPTION 'permission_denied';
    END IF;

    -- Perform Partial Update
    UPDATE allocations SET
    package_id = CASE WHEN (p_data ? 'package_id') THEN (p_data->>'package_id')::int ELSE package_id END,
    site_id = CASE WHEN (p_data ? 'site_id') THEN (p_data->>'site_id')::int ELSE site_id END,
    from_date = CASE WHEN (p_data ? 'from_date') THEN (p_data->>'from_date')::date ELSE from_date END,
    to_date = CASE WHEN (p_data ? 'to_date') THEN (p_data->>'to_date')::date ELSE to_date END
    WHERE id = (p_data->>'id')::int
    RETURNING to_jsonb(allocations.*) INTO v_result;

    

  ELSE
    v_op := 'insert';
    IF NOT (EXISTS (SELECT 1 FROM acts_for WHERE acts_for.org_id = (SELECT org_id FROM venues WHERE id = (SELECT venue_id FROM sites WHERE id = (p_data->>'site_id')::int)) AND acts_for.active = true AND acts_for.user_id = p_user_id)) THEN
      RAISE EXCEPTION 'permission_denied';
    END IF;

    -- Perform Insert
    INSERT INTO allocations (package_id, site_id, from_date, to_date)
    VALUES ((p_data->>'package_id')::int, (p_data->>'site_id')::int, (p_data->>'from_date')::date, (p_data->>'to_date')::date)
    RETURNING to_jsonb(allocations.*) INTO v_result;

    
  END IF;



  -- Emit Event
  INSERT INTO dzql_v2.events (commit_id, table_name, op, pk, data, old_data, user_id)
  VALUES (
    v_commit_id,
    'allocations',
    v_op,
    jsonb_build_object('id', v_result->'id'),
    v_result,
    v_old_data, -- NULL for insert
    p_user_id
  );

  -- Notify Runtime
  PERFORM pg_notify('dzql_v2', json_build_object('commit_id', v_commit_id)::text);

  -- Remove hidden fields before returning to client
  RETURN v_result;
END;
$$;


CREATE OR REPLACE FUNCTION dzql_v2.delete_allocations(p_user_id int, p_pk jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = dzql_v2, public
AS $$
DECLARE
  v_old_data jsonb;
  v_commit_id bigint;
BEGIN
  v_commit_id := nextval('dzql_v2.commit_seq');

  -- Fetch old data FIRST for permission check
  SELECT to_jsonb(allocations.*) INTO v_old_data FROM allocations WHERE id = (p_pk->>'id')::int;

  IF v_old_data IS NULL THEN
    RAISE EXCEPTION 'not_found';
  END IF;

  -- Permission Check (Delete)
  IF NOT (EXISTS (SELECT 1 FROM acts_for WHERE acts_for.org_id = (SELECT org_id FROM venues WHERE id = (SELECT venue_id FROM sites WHERE id = (v_old_data->>'site_id')::int)) AND acts_for.active = true AND acts_for.user_id = p_user_id)) THEN
    RAISE EXCEPTION 'permission_denied';
  END IF;

  -- Graph Rules (Pre-delete cascades)
  

  -- Perform Delete
  DELETE FROM allocations WHERE id = (p_pk->>'id')::int;

  -- Emit Event (always 'delete' operation for client-side removal)
  INSERT INTO dzql_v2.events (commit_id, table_name, op, pk, data, old_data, user_id)
  VALUES (
    v_commit_id,
    'allocations',
    'delete',
    jsonb_build_object('id', v_old_data->'id'),
    v_old_data,  -- Include full data for subscription resolution
    v_old_data,
    p_user_id
  );

  -- Notify Runtime
  PERFORM pg_notify('dzql_v2', json_build_object('commit_id', v_commit_id)::text);

  -- Remove hidden fields before returning to client
  RETURN v_old_data;
END;
$$;


CREATE OR REPLACE FUNCTION dzql_v2.get_allocations(p_user_id int, p_pk jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = dzql_v2, public
AS $$
DECLARE
  v_result jsonb;
BEGIN
  SELECT to_jsonb(allocations.*) INTO v_result
  FROM allocations
  WHERE id = (p_pk->>'id')::int
    AND (EXISTS (SELECT 1 FROM acts_for WHERE acts_for.org_id = (SELECT org_id FROM venues WHERE id = (SELECT venue_id FROM sites WHERE id = allocations.site_id)) AND acts_for.active = true AND acts_for.user_id = p_user_id) OR EXISTS (SELECT 1 FROM acts_for WHERE acts_for.org_id = (SELECT owner_org_id FROM packages WHERE id = allocations.package_id) AND acts_for.active = true AND acts_for.user_id = p_user_id) OR EXISTS (SELECT 1 FROM acts_for WHERE acts_for.org_id = (SELECT sponsor_org_id FROM packages WHERE id = allocations.package_id) AND acts_for.active = true AND acts_for.user_id = p_user_id) OR EXISTS (SELECT 1 FROM acts_for WHERE acts_for.org_id = (SELECT contractor_org_id FROM contractor_rights WHERE contractor_rights.package_id = allocations.package_id AND contractor_rights.active = true) AND acts_for.active = true AND acts_for.user_id = p_user_id));

  IF v_result IS NULL THEN
    RETURN NULL;
  END IF;


  RETURN v_result;
END;
$$;


CREATE OR REPLACE FUNCTION dzql_v2.search_allocations(p_user_id int, p_query jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = dzql_v2, public
AS $$
DECLARE
  v_results jsonb;
  v_filters jsonb;
  v_sort_field text;
  v_sort_order text;
  v_where_clause text := '';
  v_field text;
  v_filter jsonb;
  v_operator text;
  v_value jsonb;
BEGIN
  -- Extract query parameters
  v_filters := COALESCE(p_query->'filters', '{}'::jsonb);
  v_sort_field := COALESCE(p_query->>'sort_field', 'id');
  v_sort_order := COALESCE(p_query->>'sort_order', 'asc');

  -- Build WHERE clause from filters
  FOR v_field, v_filter IN SELECT * FROM jsonb_each(v_filters)
  LOOP
    -- Handle simple value (exact match)
    IF jsonb_typeof(v_filter) IN ('string', 'number', 'boolean') THEN
      v_where_clause := v_where_clause || format(' AND %I::TEXT = %L', v_field, v_filter #>> '{}');
    ELSE
      -- Handle operator-based filters
      FOR v_operator, v_value IN SELECT * FROM jsonb_each(v_filter)
      LOOP
        CASE v_operator
          WHEN 'eq' THEN
            v_where_clause := v_where_clause || format(' AND %I::TEXT = %L', v_field, v_value #>> '{}');
          WHEN 'ne' THEN
            v_where_clause := v_where_clause || format(' AND %I::TEXT != %L', v_field, v_value #>> '{}');
          WHEN 'gt' THEN
            v_where_clause := v_where_clause || format(' AND %I > %L', v_field, v_value #>> '{}');
          WHEN 'gte' THEN
            v_where_clause := v_where_clause || format(' AND %I >= %L', v_field, v_value #>> '{}');
          WHEN 'lt' THEN
            v_where_clause := v_where_clause || format(' AND %I < %L', v_field, v_value #>> '{}');
          WHEN 'lte' THEN
            v_where_clause := v_where_clause || format(' AND %I <= %L', v_field, v_value #>> '{}');
          WHEN 'in' THEN
            v_where_clause := v_where_clause || format(' AND %I::TEXT = ANY(%L)', v_field,
              (SELECT array_agg(value #>> '{}') FROM jsonb_array_elements(v_value) AS value));
          WHEN 'not_in' THEN
            v_where_clause := v_where_clause || format(' AND %I::TEXT != ALL(%L)', v_field,
              (SELECT array_agg(value #>> '{}') FROM jsonb_array_elements(v_value) AS value));
          WHEN 'like' THEN
            v_where_clause := v_where_clause || format(' AND %I LIKE %L', v_field, v_value #>> '{}');
          WHEN 'ilike' THEN
            v_where_clause := v_where_clause || format(' AND %I ILIKE %L', v_field, v_value #>> '{}');
          WHEN 'is_null' THEN
            IF (v_value::text = 'true') THEN
              v_where_clause := v_where_clause || format(' AND %I IS NULL', v_field);
            END IF;
          WHEN 'not_null' THEN
            IF (v_value::text = 'true') THEN
              v_where_clause := v_where_clause || format(' AND %I IS NOT NULL', v_field);
            END IF;
          ELSE
            -- Unknown operator, skip
        END CASE;
      END LOOP;
    END IF;
  END LOOP;

  -- Execute dynamic query (sort inside subquery for correct LIMIT behavior)
  EXECUTE format('
    SELECT COALESCE(jsonb_agg(to_jsonb(t.*)), ''[]''::jsonb)
    FROM (
      SELECT * FROM allocations
      WHERE (EXISTS (SELECT 1 FROM acts_for WHERE acts_for.org_id = (SELECT org_id FROM venues WHERE id = (SELECT venue_id FROM sites WHERE id = allocations.site_id)) AND acts_for.active = true AND acts_for.user_id = p_user_id) OR EXISTS (SELECT 1 FROM acts_for WHERE acts_for.org_id = (SELECT owner_org_id FROM packages WHERE id = allocations.package_id) AND acts_for.active = true AND acts_for.user_id = p_user_id) OR EXISTS (SELECT 1 FROM acts_for WHERE acts_for.org_id = (SELECT sponsor_org_id FROM packages WHERE id = allocations.package_id) AND acts_for.active = true AND acts_for.user_id = p_user_id) OR EXISTS (SELECT 1 FROM acts_for WHERE acts_for.org_id = (SELECT contractor_org_id FROM contractor_rights WHERE contractor_rights.package_id = allocations.package_id AND contractor_rights.active = true) AND acts_for.active = true AND acts_for.user_id = p_user_id)) %s
      ORDER BY %I %s
      LIMIT %L OFFSET %L
    ) t
  ', v_where_clause, v_sort_field, v_sort_order,
     COALESCE((p_query->>'limit')::int, 10),
     COALESCE((p_query->>'offset')::int, 0))
  INTO v_results;

  RETURN v_results;
END;
$$;


CREATE TABLE IF NOT EXISTS contractor_rights (
  contractor_org_id int NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  sponsor_org_id int NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  package_id int NOT NULL REFERENCES packages(id) ON DELETE CASCADE,
  valid_from date NOT NULL DEFAULT current_date,
  valid_to date
);


CREATE OR REPLACE FUNCTION dzql_v2.save_contractor_rights(p_user_id int, p_data jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = dzql_v2, public
AS $$
DECLARE
  v_result jsonb;
  v_old_data jsonb;
  v_commit_id bigint;
  v_op text;

BEGIN
  v_commit_id := nextval('dzql_v2.commit_seq');


  -- Determine Operation & Check Permissions (supports composite PK)
  IF ((p_data->>'contractor_org_id') IS NOT NULL AND (p_data->>'package_id') IS NOT NULL AND (p_data->>'valid_from') IS NOT NULL) AND EXISTS(SELECT 1 FROM contractor_rights WHERE contractor_org_id = (p_data->>'contractor_org_id')::int AND package_id = (p_data->>'package_id')::int AND valid_from = (p_data->>'valid_from')::date) THEN
    v_op := 'update';

    -- Fetch old data for update rules/events
    SELECT to_jsonb(contractor_rights.*) INTO v_old_data FROM contractor_rights WHERE contractor_org_id = (p_data->>'contractor_org_id')::int AND package_id = (p_data->>'package_id')::int AND valid_from = (p_data->>'valid_from')::date;

    IF NOT (EXISTS (SELECT 1 FROM acts_for WHERE acts_for.org_id = (p_data->>'sponsor_org_id')::int AND acts_for.active = true AND acts_for.user_id = p_user_id)) THEN
      RAISE EXCEPTION 'permission_denied';
    END IF;

    -- Perform Partial Update
    UPDATE contractor_rights SET
    sponsor_org_id = CASE WHEN (p_data ? 'sponsor_org_id') THEN (p_data->>'sponsor_org_id')::int ELSE sponsor_org_id END,
    valid_to = CASE WHEN (p_data ? 'valid_to') THEN (p_data->>'valid_to')::date ELSE valid_to END
    WHERE contractor_org_id = (p_data->>'contractor_org_id')::int AND package_id = (p_data->>'package_id')::int AND valid_from = (p_data->>'valid_from')::date
    RETURNING to_jsonb(contractor_rights.*) INTO v_result;

    

  ELSE
    v_op := 'insert';
    IF NOT (EXISTS (SELECT 1 FROM acts_for WHERE acts_for.org_id = (p_data->>'sponsor_org_id')::int AND acts_for.active = true AND acts_for.user_id = p_user_id)) THEN
      RAISE EXCEPTION 'permission_denied';
    END IF;

    -- Perform Insert
    INSERT INTO contractor_rights (contractor_org_id, sponsor_org_id, package_id, valid_from, valid_to)
    VALUES ((p_data->>'contractor_org_id')::int, (p_data->>'sponsor_org_id')::int, (p_data->>'package_id')::int, (p_data->>'valid_from')::date, (p_data->>'valid_to')::date)
    RETURNING to_jsonb(contractor_rights.*) INTO v_result;

    
  END IF;



  -- Emit Event
  INSERT INTO dzql_v2.events (commit_id, table_name, op, pk, data, old_data, user_id)
  VALUES (
    v_commit_id,
    'contractor_rights',
    v_op,
    jsonb_build_object('contractor_org_id', v_result->'contractor_org_id', 'package_id', v_result->'package_id', 'valid_from', v_result->'valid_from'),
    v_result,
    v_old_data, -- NULL for insert
    p_user_id
  );

  -- Notify Runtime
  PERFORM pg_notify('dzql_v2', json_build_object('commit_id', v_commit_id)::text);

  -- Remove hidden fields before returning to client
  RETURN v_result;
END;
$$;


CREATE OR REPLACE FUNCTION dzql_v2.delete_contractor_rights(p_user_id int, p_pk jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = dzql_v2, public
AS $$
DECLARE
  v_old_data jsonb;
  v_commit_id bigint;
BEGIN
  v_commit_id := nextval('dzql_v2.commit_seq');

  -- Fetch old data FIRST for permission check
  SELECT to_jsonb(contractor_rights.*) INTO v_old_data FROM contractor_rights WHERE contractor_org_id = (p_pk->>'contractor_org_id')::int AND package_id = (p_pk->>'package_id')::int AND valid_from = (p_pk->>'valid_from')::date;

  IF v_old_data IS NULL THEN
    RAISE EXCEPTION 'not_found';
  END IF;

  -- Permission Check (Delete)
  IF NOT (EXISTS (SELECT 1 FROM acts_for WHERE acts_for.org_id = (v_old_data->>'sponsor_org_id')::int AND acts_for.active = true AND acts_for.user_id = p_user_id)) THEN
    RAISE EXCEPTION 'permission_denied';
  END IF;

  -- Graph Rules (Pre-delete cascades)
  

  -- Perform Delete
  DELETE FROM contractor_rights WHERE contractor_org_id = (p_pk->>'contractor_org_id')::int AND package_id = (p_pk->>'package_id')::int AND valid_from = (p_pk->>'valid_from')::date;

  -- Emit Event (always 'delete' operation for client-side removal)
  INSERT INTO dzql_v2.events (commit_id, table_name, op, pk, data, old_data, user_id)
  VALUES (
    v_commit_id,
    'contractor_rights',
    'delete',
    jsonb_build_object('contractor_org_id', v_old_data->'contractor_org_id', 'package_id', v_old_data->'package_id', 'valid_from', v_old_data->'valid_from'),
    v_old_data,  -- Include full data for subscription resolution
    v_old_data,
    p_user_id
  );

  -- Notify Runtime
  PERFORM pg_notify('dzql_v2', json_build_object('commit_id', v_commit_id)::text);

  -- Remove hidden fields before returning to client
  RETURN v_old_data;
END;
$$;


CREATE OR REPLACE FUNCTION dzql_v2.get_contractor_rights(p_user_id int, p_pk jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = dzql_v2, public
AS $$
DECLARE
  v_result jsonb;
BEGIN
  SELECT to_jsonb(contractor_rights.*) INTO v_result
  FROM contractor_rights
  WHERE contractor_org_id = (p_pk->>'contractor_org_id')::int AND package_id = (p_pk->>'package_id')::int AND valid_from = (p_pk->>'valid_from')::date
    AND (TRUE);

  IF v_result IS NULL THEN
    RETURN NULL;
  END IF;


  RETURN v_result;
END;
$$;


CREATE OR REPLACE FUNCTION dzql_v2.search_contractor_rights(p_user_id int, p_query jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = dzql_v2, public
AS $$
DECLARE
  v_results jsonb;
  v_filters jsonb;
  v_sort_field text;
  v_sort_order text;
  v_where_clause text := '';
  v_field text;
  v_filter jsonb;
  v_operator text;
  v_value jsonb;
BEGIN
  -- Extract query parameters
  v_filters := COALESCE(p_query->'filters', '{}'::jsonb);
  v_sort_field := COALESCE(p_query->>'sort_field', 'contractor_org_id');
  v_sort_order := COALESCE(p_query->>'sort_order', 'asc');

  -- Build WHERE clause from filters
  FOR v_field, v_filter IN SELECT * FROM jsonb_each(v_filters)
  LOOP
    -- Handle simple value (exact match)
    IF jsonb_typeof(v_filter) IN ('string', 'number', 'boolean') THEN
      v_where_clause := v_where_clause || format(' AND %I::TEXT = %L', v_field, v_filter #>> '{}');
    ELSE
      -- Handle operator-based filters
      FOR v_operator, v_value IN SELECT * FROM jsonb_each(v_filter)
      LOOP
        CASE v_operator
          WHEN 'eq' THEN
            v_where_clause := v_where_clause || format(' AND %I::TEXT = %L', v_field, v_value #>> '{}');
          WHEN 'ne' THEN
            v_where_clause := v_where_clause || format(' AND %I::TEXT != %L', v_field, v_value #>> '{}');
          WHEN 'gt' THEN
            v_where_clause := v_where_clause || format(' AND %I > %L', v_field, v_value #>> '{}');
          WHEN 'gte' THEN
            v_where_clause := v_where_clause || format(' AND %I >= %L', v_field, v_value #>> '{}');
          WHEN 'lt' THEN
            v_where_clause := v_where_clause || format(' AND %I < %L', v_field, v_value #>> '{}');
          WHEN 'lte' THEN
            v_where_clause := v_where_clause || format(' AND %I <= %L', v_field, v_value #>> '{}');
          WHEN 'in' THEN
            v_where_clause := v_where_clause || format(' AND %I::TEXT = ANY(%L)', v_field,
              (SELECT array_agg(value #>> '{}') FROM jsonb_array_elements(v_value) AS value));
          WHEN 'not_in' THEN
            v_where_clause := v_where_clause || format(' AND %I::TEXT != ALL(%L)', v_field,
              (SELECT array_agg(value #>> '{}') FROM jsonb_array_elements(v_value) AS value));
          WHEN 'like' THEN
            v_where_clause := v_where_clause || format(' AND %I LIKE %L', v_field, v_value #>> '{}');
          WHEN 'ilike' THEN
            v_where_clause := v_where_clause || format(' AND %I ILIKE %L', v_field, v_value #>> '{}');
          WHEN 'is_null' THEN
            IF (v_value::text = 'true') THEN
              v_where_clause := v_where_clause || format(' AND %I IS NULL', v_field);
            END IF;
          WHEN 'not_null' THEN
            IF (v_value::text = 'true') THEN
              v_where_clause := v_where_clause || format(' AND %I IS NOT NULL', v_field);
            END IF;
          ELSE
            -- Unknown operator, skip
        END CASE;
      END LOOP;
    END IF;
  END LOOP;

  -- Execute dynamic query (sort inside subquery for correct LIMIT behavior)
  EXECUTE format('
    SELECT COALESCE(jsonb_agg(to_jsonb(t.*)), ''[]''::jsonb)
    FROM (
      SELECT * FROM contractor_rights
      WHERE (TRUE) %s
      ORDER BY %I %s
      LIMIT %L OFFSET %L
    ) t
  ', v_where_clause, v_sort_field, v_sort_order,
     COALESCE((p_query->>'limit')::int, 10),
     COALESCE((p_query->>'offset')::int, 0))
  INTO v_results;

  RETURN v_results;
END;
$$;


CREATE TABLE IF NOT EXISTS brands (
  id serial PRIMARY KEY,
  org_id int NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text
);


CREATE OR REPLACE FUNCTION dzql_v2.save_brands(p_user_id int, p_data jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = dzql_v2, public
AS $$
DECLARE
  v_result jsonb;
  v_old_data jsonb;
  v_commit_id bigint;
  v_op text;
  v_tag_ids INT[];
BEGIN
  v_commit_id := nextval('dzql_v2.commit_seq');

  -- M2M: Extract tags IDs
  IF p_data ? 'tag_ids' THEN
    v_tag_ids := ARRAY(SELECT jsonb_array_elements_text(p_data->'tag_ids')::int);
    p_data := p_data - 'tag_ids';
  END IF;

  -- Determine Operation & Check Permissions (supports composite PK)
  IF ((p_data->>'id') IS NOT NULL) AND EXISTS(SELECT 1 FROM brands WHERE id = (p_data->>'id')::int) THEN
    v_op := 'update';

    -- Fetch old data for update rules/events
    SELECT to_jsonb(brands.*) INTO v_old_data FROM brands WHERE id = (p_data->>'id')::int;

    IF NOT (EXISTS (SELECT 1 FROM acts_for WHERE acts_for.org_id = (p_data->>'org_id')::int AND acts_for.active = true AND acts_for.user_id = p_user_id)) THEN
      RAISE EXCEPTION 'permission_denied';
    END IF;

    -- Perform Partial Update
    UPDATE brands SET
    org_id = CASE WHEN (p_data ? 'org_id') THEN (p_data->>'org_id')::int ELSE org_id END,
    name = CASE WHEN (p_data ? 'name') THEN (p_data->>'name') ELSE name END,
    description = CASE WHEN (p_data ? 'description') THEN (p_data->>'description') ELSE description END
    WHERE id = (p_data->>'id')::int
    RETURNING to_jsonb(brands.*) INTO v_result;

    

  ELSE
    v_op := 'insert';
    IF NOT (EXISTS (SELECT 1 FROM acts_for WHERE acts_for.org_id = (p_data->>'org_id')::int AND acts_for.active = true AND acts_for.user_id = p_user_id)) THEN
      RAISE EXCEPTION 'permission_denied';
    END IF;

    -- Perform Insert
    INSERT INTO brands (org_id, name, description)
    VALUES ((p_data->>'org_id')::int, (p_data->>'name'), (p_data->>'description'))
    RETURNING to_jsonb(brands.*) INTO v_result;

    
  END IF;

  -- M2M Sync: tags (junction: brand_tags)
  IF v_tag_ids IS NOT NULL THEN
    -- Delete relationships not in new list
    DELETE FROM brand_tags
    WHERE brand_id = (v_result->>'id')::int
      AND (tag_id <> ALL(v_tag_ids) OR v_tag_ids = '{}');

    -- Insert new relationships (idempotent)
    IF array_length(v_tag_ids, 1) > 0 THEN
      INSERT INTO brand_tags (brand_id, tag_id)
      SELECT (v_result->>'id')::int, unnest(v_tag_ids)
      ON CONFLICT (brand_id, tag_id) DO NOTHING;
    END IF;
  END IF;

  -- M2M: Add tag_ids to output
  v_result := v_result || jsonb_build_object('tag_ids',
    (SELECT COALESCE(jsonb_agg(tag_id ORDER BY tag_id), '[]'::jsonb)
     FROM brand_tags WHERE brand_id = (v_result->>'id')::int));

  -- Emit Event
  INSERT INTO dzql_v2.events (commit_id, table_name, op, pk, data, old_data, user_id)
  VALUES (
    v_commit_id,
    'brands',
    v_op,
    jsonb_build_object('id', v_result->'id'),
    v_result,
    v_old_data, -- NULL for insert
    p_user_id
  );

  -- Notify Runtime
  PERFORM pg_notify('dzql_v2', json_build_object('commit_id', v_commit_id)::text);

  -- Remove hidden fields before returning to client
  RETURN v_result;
END;
$$;


CREATE OR REPLACE FUNCTION dzql_v2.delete_brands(p_user_id int, p_pk jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = dzql_v2, public
AS $$
DECLARE
  v_old_data jsonb;
  v_commit_id bigint;
BEGIN
  v_commit_id := nextval('dzql_v2.commit_seq');

  -- Fetch old data FIRST for permission check
  SELECT to_jsonb(brands.*) INTO v_old_data FROM brands WHERE id = (p_pk->>'id')::int;

  IF v_old_data IS NULL THEN
    RAISE EXCEPTION 'not_found';
  END IF;

  -- Permission Check (Delete)
  IF NOT (EXISTS (SELECT 1 FROM acts_for WHERE acts_for.org_id = (v_old_data->>'org_id')::int AND acts_for.active = true AND acts_for.user_id = p_user_id)) THEN
    RAISE EXCEPTION 'permission_denied';
  END IF;

  -- Graph Rules (Pre-delete cascades)
  

  -- Perform Delete
  DELETE FROM brands WHERE id = (p_pk->>'id')::int;

  -- Emit Event (always 'delete' operation for client-side removal)
  INSERT INTO dzql_v2.events (commit_id, table_name, op, pk, data, old_data, user_id)
  VALUES (
    v_commit_id,
    'brands',
    'delete',
    jsonb_build_object('id', v_old_data->'id'),
    v_old_data,  -- Include full data for subscription resolution
    v_old_data,
    p_user_id
  );

  -- Notify Runtime
  PERFORM pg_notify('dzql_v2', json_build_object('commit_id', v_commit_id)::text);

  -- Remove hidden fields before returning to client
  RETURN v_old_data;
END;
$$;


CREATE OR REPLACE FUNCTION dzql_v2.get_brands(p_user_id int, p_pk jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = dzql_v2, public
AS $$
DECLARE
  v_result jsonb;
BEGIN
  SELECT to_jsonb(brands.*) INTO v_result
  FROM brands
  WHERE id = (p_pk->>'id')::int
    AND (TRUE);

  IF v_result IS NULL THEN
    RETURN NULL;
  END IF;

  -- M2M: Add tag_ids to result
  v_result := v_result || jsonb_build_object('tag_ids',
    (SELECT COALESCE(jsonb_agg(tag_id ORDER BY tag_id), '[]'::jsonb)
     FROM brand_tags WHERE brand_id = (v_result->>'id')::int));

  RETURN v_result;
END;
$$;


CREATE OR REPLACE FUNCTION dzql_v2.search_brands(p_user_id int, p_query jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = dzql_v2, public
AS $$
DECLARE
  v_results jsonb;
  v_filters jsonb;
  v_sort_field text;
  v_sort_order text;
  v_where_clause text := '';
  v_field text;
  v_filter jsonb;
  v_operator text;
  v_value jsonb;
BEGIN
  -- Extract query parameters
  v_filters := COALESCE(p_query->'filters', '{}'::jsonb);
  v_sort_field := COALESCE(p_query->>'sort_field', 'name');
  v_sort_order := COALESCE(p_query->>'sort_order', 'asc');

  -- Build WHERE clause from filters
  FOR v_field, v_filter IN SELECT * FROM jsonb_each(v_filters)
  LOOP
    -- Handle simple value (exact match)
    IF jsonb_typeof(v_filter) IN ('string', 'number', 'boolean') THEN
      v_where_clause := v_where_clause || format(' AND %I::TEXT = %L', v_field, v_filter #>> '{}');
    ELSE
      -- Handle operator-based filters
      FOR v_operator, v_value IN SELECT * FROM jsonb_each(v_filter)
      LOOP
        CASE v_operator
          WHEN 'eq' THEN
            v_where_clause := v_where_clause || format(' AND %I::TEXT = %L', v_field, v_value #>> '{}');
          WHEN 'ne' THEN
            v_where_clause := v_where_clause || format(' AND %I::TEXT != %L', v_field, v_value #>> '{}');
          WHEN 'gt' THEN
            v_where_clause := v_where_clause || format(' AND %I > %L', v_field, v_value #>> '{}');
          WHEN 'gte' THEN
            v_where_clause := v_where_clause || format(' AND %I >= %L', v_field, v_value #>> '{}');
          WHEN 'lt' THEN
            v_where_clause := v_where_clause || format(' AND %I < %L', v_field, v_value #>> '{}');
          WHEN 'lte' THEN
            v_where_clause := v_where_clause || format(' AND %I <= %L', v_field, v_value #>> '{}');
          WHEN 'in' THEN
            v_where_clause := v_where_clause || format(' AND %I::TEXT = ANY(%L)', v_field,
              (SELECT array_agg(value #>> '{}') FROM jsonb_array_elements(v_value) AS value));
          WHEN 'not_in' THEN
            v_where_clause := v_where_clause || format(' AND %I::TEXT != ALL(%L)', v_field,
              (SELECT array_agg(value #>> '{}') FROM jsonb_array_elements(v_value) AS value));
          WHEN 'like' THEN
            v_where_clause := v_where_clause || format(' AND %I LIKE %L', v_field, v_value #>> '{}');
          WHEN 'ilike' THEN
            v_where_clause := v_where_clause || format(' AND %I ILIKE %L', v_field, v_value #>> '{}');
          WHEN 'is_null' THEN
            IF (v_value::text = 'true') THEN
              v_where_clause := v_where_clause || format(' AND %I IS NULL', v_field);
            END IF;
          WHEN 'not_null' THEN
            IF (v_value::text = 'true') THEN
              v_where_clause := v_where_clause || format(' AND %I IS NOT NULL', v_field);
            END IF;
          ELSE
            -- Unknown operator, skip
        END CASE;
      END LOOP;
    END IF;
  END LOOP;

  -- Execute dynamic query (sort inside subquery for correct LIMIT behavior)
  EXECUTE format('
    SELECT COALESCE(jsonb_agg(to_jsonb(t.*) || jsonb_build_object(''tag_ids'', m2m_tag_ids.tag_ids)), ''[]''::jsonb)
    FROM (
      SELECT * FROM brands
      WHERE (TRUE) %s
      ORDER BY %I %s
      LIMIT %L OFFSET %L
    ) t
      LEFT JOIN LATERAL (
        SELECT COALESCE(jsonb_agg(tag_id ORDER BY tag_id), ''[]''::jsonb) as tag_ids
        FROM brand_tags
        WHERE brand_id = t.id
      ) m2m_tag_ids ON true
  ', v_where_clause, v_sort_field, v_sort_order,
     COALESCE((p_query->>'limit')::int, 10),
     COALESCE((p_query->>'offset')::int, 0))
  INTO v_results;

  RETURN v_results;
END;
$$;


CREATE TABLE IF NOT EXISTS artwork (
  id serial PRIMARY KEY,
  brand_id int NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  url text NOT NULL,
  ratio decimal(10, 4) NOT NULL
);


CREATE OR REPLACE FUNCTION dzql_v2.save_artwork(p_user_id int, p_data jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = dzql_v2, public
AS $$
DECLARE
  v_result jsonb;
  v_old_data jsonb;
  v_commit_id bigint;
  v_op text;

BEGIN
  v_commit_id := nextval('dzql_v2.commit_seq');


  -- Determine Operation & Check Permissions (supports composite PK)
  IF ((p_data->>'id') IS NOT NULL) AND EXISTS(SELECT 1 FROM artwork WHERE id = (p_data->>'id')::int) THEN
    v_op := 'update';

    -- Fetch old data for update rules/events
    SELECT to_jsonb(artwork.*) INTO v_old_data FROM artwork WHERE id = (p_data->>'id')::int;

    IF NOT (EXISTS (SELECT 1 FROM acts_for WHERE acts_for.org_id = (SELECT org_id FROM brands WHERE id = (p_data->>'brand_id')::int) AND acts_for.active = true AND acts_for.user_id = p_user_id)) THEN
      RAISE EXCEPTION 'permission_denied';
    END IF;

    -- Perform Partial Update
    UPDATE artwork SET
    brand_id = CASE WHEN (p_data ? 'brand_id') THEN (p_data->>'brand_id')::int ELSE brand_id END,
    url = CASE WHEN (p_data ? 'url') THEN (p_data->>'url') ELSE url END,
    ratio = CASE WHEN (p_data ? 'ratio') THEN (p_data->>'ratio')::numeric ELSE ratio END
    WHERE id = (p_data->>'id')::int
    RETURNING to_jsonb(artwork.*) INTO v_result;

    

  ELSE
    v_op := 'insert';
    IF NOT (EXISTS (SELECT 1 FROM acts_for WHERE acts_for.org_id = (SELECT org_id FROM brands WHERE id = (p_data->>'brand_id')::int) AND acts_for.active = true AND acts_for.user_id = p_user_id)) THEN
      RAISE EXCEPTION 'permission_denied';
    END IF;

    -- Perform Insert
    INSERT INTO artwork (brand_id, url, ratio)
    VALUES ((p_data->>'brand_id')::int, (p_data->>'url'), (p_data->>'ratio')::numeric)
    RETURNING to_jsonb(artwork.*) INTO v_result;

    
  END IF;



  -- Emit Event
  INSERT INTO dzql_v2.events (commit_id, table_name, op, pk, data, old_data, user_id)
  VALUES (
    v_commit_id,
    'artwork',
    v_op,
    jsonb_build_object('id', v_result->'id'),
    v_result,
    v_old_data, -- NULL for insert
    p_user_id
  );

  -- Notify Runtime
  PERFORM pg_notify('dzql_v2', json_build_object('commit_id', v_commit_id)::text);

  -- Remove hidden fields before returning to client
  RETURN v_result;
END;
$$;


CREATE OR REPLACE FUNCTION dzql_v2.delete_artwork(p_user_id int, p_pk jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = dzql_v2, public
AS $$
DECLARE
  v_old_data jsonb;
  v_commit_id bigint;
BEGIN
  v_commit_id := nextval('dzql_v2.commit_seq');

  -- Fetch old data FIRST for permission check
  SELECT to_jsonb(artwork.*) INTO v_old_data FROM artwork WHERE id = (p_pk->>'id')::int;

  IF v_old_data IS NULL THEN
    RAISE EXCEPTION 'not_found';
  END IF;

  -- Permission Check (Delete)
  IF NOT (EXISTS (SELECT 1 FROM acts_for WHERE acts_for.org_id = (SELECT org_id FROM brands WHERE id = (v_old_data->>'brand_id')::int) AND acts_for.active = true AND acts_for.user_id = p_user_id)) THEN
    RAISE EXCEPTION 'permission_denied';
  END IF;

  -- Graph Rules (Pre-delete cascades)
  

  -- Perform Delete
  DELETE FROM artwork WHERE id = (p_pk->>'id')::int;

  -- Emit Event (always 'delete' operation for client-side removal)
  INSERT INTO dzql_v2.events (commit_id, table_name, op, pk, data, old_data, user_id)
  VALUES (
    v_commit_id,
    'artwork',
    'delete',
    jsonb_build_object('id', v_old_data->'id'),
    v_old_data,  -- Include full data for subscription resolution
    v_old_data,
    p_user_id
  );

  -- Notify Runtime
  PERFORM pg_notify('dzql_v2', json_build_object('commit_id', v_commit_id)::text);

  -- Remove hidden fields before returning to client
  RETURN v_old_data;
END;
$$;


CREATE OR REPLACE FUNCTION dzql_v2.get_artwork(p_user_id int, p_pk jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = dzql_v2, public
AS $$
DECLARE
  v_result jsonb;
BEGIN
  SELECT to_jsonb(artwork.*) INTO v_result
  FROM artwork
  WHERE id = (p_pk->>'id')::int
    AND (TRUE);

  IF v_result IS NULL THEN
    RETURN NULL;
  END IF;


  RETURN v_result;
END;
$$;


CREATE OR REPLACE FUNCTION dzql_v2.search_artwork(p_user_id int, p_query jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = dzql_v2, public
AS $$
DECLARE
  v_results jsonb;
  v_filters jsonb;
  v_sort_field text;
  v_sort_order text;
  v_where_clause text := '';
  v_field text;
  v_filter jsonb;
  v_operator text;
  v_value jsonb;
BEGIN
  -- Extract query parameters
  v_filters := COALESCE(p_query->'filters', '{}'::jsonb);
  v_sort_field := COALESCE(p_query->>'sort_field', 'url');
  v_sort_order := COALESCE(p_query->>'sort_order', 'asc');

  -- Build WHERE clause from filters
  FOR v_field, v_filter IN SELECT * FROM jsonb_each(v_filters)
  LOOP
    -- Handle simple value (exact match)
    IF jsonb_typeof(v_filter) IN ('string', 'number', 'boolean') THEN
      v_where_clause := v_where_clause || format(' AND %I::TEXT = %L', v_field, v_filter #>> '{}');
    ELSE
      -- Handle operator-based filters
      FOR v_operator, v_value IN SELECT * FROM jsonb_each(v_filter)
      LOOP
        CASE v_operator
          WHEN 'eq' THEN
            v_where_clause := v_where_clause || format(' AND %I::TEXT = %L', v_field, v_value #>> '{}');
          WHEN 'ne' THEN
            v_where_clause := v_where_clause || format(' AND %I::TEXT != %L', v_field, v_value #>> '{}');
          WHEN 'gt' THEN
            v_where_clause := v_where_clause || format(' AND %I > %L', v_field, v_value #>> '{}');
          WHEN 'gte' THEN
            v_where_clause := v_where_clause || format(' AND %I >= %L', v_field, v_value #>> '{}');
          WHEN 'lt' THEN
            v_where_clause := v_where_clause || format(' AND %I < %L', v_field, v_value #>> '{}');
          WHEN 'lte' THEN
            v_where_clause := v_where_clause || format(' AND %I <= %L', v_field, v_value #>> '{}');
          WHEN 'in' THEN
            v_where_clause := v_where_clause || format(' AND %I::TEXT = ANY(%L)', v_field,
              (SELECT array_agg(value #>> '{}') FROM jsonb_array_elements(v_value) AS value));
          WHEN 'not_in' THEN
            v_where_clause := v_where_clause || format(' AND %I::TEXT != ALL(%L)', v_field,
              (SELECT array_agg(value #>> '{}') FROM jsonb_array_elements(v_value) AS value));
          WHEN 'like' THEN
            v_where_clause := v_where_clause || format(' AND %I LIKE %L', v_field, v_value #>> '{}');
          WHEN 'ilike' THEN
            v_where_clause := v_where_clause || format(' AND %I ILIKE %L', v_field, v_value #>> '{}');
          WHEN 'is_null' THEN
            IF (v_value::text = 'true') THEN
              v_where_clause := v_where_clause || format(' AND %I IS NULL', v_field);
            END IF;
          WHEN 'not_null' THEN
            IF (v_value::text = 'true') THEN
              v_where_clause := v_where_clause || format(' AND %I IS NOT NULL', v_field);
            END IF;
          ELSE
            -- Unknown operator, skip
        END CASE;
      END LOOP;
    END IF;
  END LOOP;

  -- Execute dynamic query (sort inside subquery for correct LIMIT behavior)
  EXECUTE format('
    SELECT COALESCE(jsonb_agg(to_jsonb(t.*)), ''[]''::jsonb)
    FROM (
      SELECT * FROM artwork
      WHERE (TRUE) %s
      ORDER BY %I %s
      LIMIT %L OFFSET %L
    ) t
  ', v_where_clause, v_sort_field, v_sort_order,
     COALESCE((p_query->>'limit')::int, 10),
     COALESCE((p_query->>'offset')::int, 0))
  INTO v_results;

  RETURN v_results;
END;
$$;


CREATE TABLE IF NOT EXISTS tags (
  id serial PRIMARY KEY,
  name text NOT NULL UNIQUE,
  color text,
  description text
);


CREATE OR REPLACE FUNCTION dzql_v2.save_tags(p_user_id int, p_data jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = dzql_v2, public
AS $$
DECLARE
  v_result jsonb;
  v_old_data jsonb;
  v_commit_id bigint;
  v_op text;

BEGIN
  v_commit_id := nextval('dzql_v2.commit_seq');


  -- Determine Operation & Check Permissions (supports composite PK)
  IF ((p_data->>'id') IS NOT NULL) AND EXISTS(SELECT 1 FROM tags WHERE id = (p_data->>'id')::int) THEN
    v_op := 'update';

    -- Fetch old data for update rules/events
    SELECT to_jsonb(tags.*) INTO v_old_data FROM tags WHERE id = (p_data->>'id')::int;

    IF NOT (TRUE) THEN
      RAISE EXCEPTION 'permission_denied';
    END IF;

    -- Perform Partial Update
    UPDATE tags SET
    name = CASE WHEN (p_data ? 'name') THEN (p_data->>'name') ELSE name END,
    color = CASE WHEN (p_data ? 'color') THEN (p_data->>'color') ELSE color END,
    description = CASE WHEN (p_data ? 'description') THEN (p_data->>'description') ELSE description END
    WHERE id = (p_data->>'id')::int
    RETURNING to_jsonb(tags.*) INTO v_result;

    

  ELSE
    v_op := 'insert';
    IF NOT (TRUE) THEN
      RAISE EXCEPTION 'permission_denied';
    END IF;

    -- Perform Insert
    INSERT INTO tags (name, color, description)
    VALUES ((p_data->>'name'), (p_data->>'color'), (p_data->>'description'))
    RETURNING to_jsonb(tags.*) INTO v_result;

    
  END IF;



  -- Emit Event
  INSERT INTO dzql_v2.events (commit_id, table_name, op, pk, data, old_data, user_id)
  VALUES (
    v_commit_id,
    'tags',
    v_op,
    jsonb_build_object('id', v_result->'id'),
    v_result,
    v_old_data, -- NULL for insert
    p_user_id
  );

  -- Notify Runtime
  PERFORM pg_notify('dzql_v2', json_build_object('commit_id', v_commit_id)::text);

  -- Remove hidden fields before returning to client
  RETURN v_result;
END;
$$;


CREATE OR REPLACE FUNCTION dzql_v2.delete_tags(p_user_id int, p_pk jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = dzql_v2, public
AS $$
DECLARE
  v_old_data jsonb;
  v_commit_id bigint;
BEGIN
  v_commit_id := nextval('dzql_v2.commit_seq');

  -- Fetch old data FIRST for permission check
  SELECT to_jsonb(tags.*) INTO v_old_data FROM tags WHERE id = (p_pk->>'id')::int;

  IF v_old_data IS NULL THEN
    RAISE EXCEPTION 'not_found';
  END IF;

  -- Permission Check (Delete)
  IF NOT (TRUE) THEN
    RAISE EXCEPTION 'permission_denied';
  END IF;

  -- Graph Rules (Pre-delete cascades)
  

  -- Perform Delete
  DELETE FROM tags WHERE id = (p_pk->>'id')::int;

  -- Emit Event (always 'delete' operation for client-side removal)
  INSERT INTO dzql_v2.events (commit_id, table_name, op, pk, data, old_data, user_id)
  VALUES (
    v_commit_id,
    'tags',
    'delete',
    jsonb_build_object('id', v_old_data->'id'),
    v_old_data,  -- Include full data for subscription resolution
    v_old_data,
    p_user_id
  );

  -- Notify Runtime
  PERFORM pg_notify('dzql_v2', json_build_object('commit_id', v_commit_id)::text);

  -- Remove hidden fields before returning to client
  RETURN v_old_data;
END;
$$;


CREATE OR REPLACE FUNCTION dzql_v2.get_tags(p_user_id int, p_pk jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = dzql_v2, public
AS $$
DECLARE
  v_result jsonb;
BEGIN
  SELECT to_jsonb(tags.*) INTO v_result
  FROM tags
  WHERE id = (p_pk->>'id')::int
    AND (TRUE);

  IF v_result IS NULL THEN
    RETURN NULL;
  END IF;


  RETURN v_result;
END;
$$;


CREATE OR REPLACE FUNCTION dzql_v2.search_tags(p_user_id int, p_query jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = dzql_v2, public
AS $$
DECLARE
  v_results jsonb;
  v_filters jsonb;
  v_sort_field text;
  v_sort_order text;
  v_where_clause text := '';
  v_field text;
  v_filter jsonb;
  v_operator text;
  v_value jsonb;
BEGIN
  -- Extract query parameters
  v_filters := COALESCE(p_query->'filters', '{}'::jsonb);
  v_sort_field := COALESCE(p_query->>'sort_field', 'name');
  v_sort_order := COALESCE(p_query->>'sort_order', 'asc');

  -- Build WHERE clause from filters
  FOR v_field, v_filter IN SELECT * FROM jsonb_each(v_filters)
  LOOP
    -- Handle simple value (exact match)
    IF jsonb_typeof(v_filter) IN ('string', 'number', 'boolean') THEN
      v_where_clause := v_where_clause || format(' AND %I::TEXT = %L', v_field, v_filter #>> '{}');
    ELSE
      -- Handle operator-based filters
      FOR v_operator, v_value IN SELECT * FROM jsonb_each(v_filter)
      LOOP
        CASE v_operator
          WHEN 'eq' THEN
            v_where_clause := v_where_clause || format(' AND %I::TEXT = %L', v_field, v_value #>> '{}');
          WHEN 'ne' THEN
            v_where_clause := v_where_clause || format(' AND %I::TEXT != %L', v_field, v_value #>> '{}');
          WHEN 'gt' THEN
            v_where_clause := v_where_clause || format(' AND %I > %L', v_field, v_value #>> '{}');
          WHEN 'gte' THEN
            v_where_clause := v_where_clause || format(' AND %I >= %L', v_field, v_value #>> '{}');
          WHEN 'lt' THEN
            v_where_clause := v_where_clause || format(' AND %I < %L', v_field, v_value #>> '{}');
          WHEN 'lte' THEN
            v_where_clause := v_where_clause || format(' AND %I <= %L', v_field, v_value #>> '{}');
          WHEN 'in' THEN
            v_where_clause := v_where_clause || format(' AND %I::TEXT = ANY(%L)', v_field,
              (SELECT array_agg(value #>> '{}') FROM jsonb_array_elements(v_value) AS value));
          WHEN 'not_in' THEN
            v_where_clause := v_where_clause || format(' AND %I::TEXT != ALL(%L)', v_field,
              (SELECT array_agg(value #>> '{}') FROM jsonb_array_elements(v_value) AS value));
          WHEN 'like' THEN
            v_where_clause := v_where_clause || format(' AND %I LIKE %L', v_field, v_value #>> '{}');
          WHEN 'ilike' THEN
            v_where_clause := v_where_clause || format(' AND %I ILIKE %L', v_field, v_value #>> '{}');
          WHEN 'is_null' THEN
            IF (v_value::text = 'true') THEN
              v_where_clause := v_where_clause || format(' AND %I IS NULL', v_field);
            END IF;
          WHEN 'not_null' THEN
            IF (v_value::text = 'true') THEN
              v_where_clause := v_where_clause || format(' AND %I IS NOT NULL', v_field);
            END IF;
          ELSE
            -- Unknown operator, skip
        END CASE;
      END LOOP;
    END IF;
  END LOOP;

  -- Execute dynamic query (sort inside subquery for correct LIMIT behavior)
  EXECUTE format('
    SELECT COALESCE(jsonb_agg(to_jsonb(t.*)), ''[]''::jsonb)
    FROM (
      SELECT * FROM tags
      WHERE (TRUE) %s
      ORDER BY %I %s
      LIMIT %L OFFSET %L
    ) t
  ', v_where_clause, v_sort_field, v_sort_order,
     COALESCE((p_query->>'limit')::int, 10),
     COALESCE((p_query->>'offset')::int, 0))
  INTO v_results;

  RETURN v_results;
END;
$$;


CREATE TABLE IF NOT EXISTS brand_tags (
  brand_id int NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  tag_id int NOT NULL REFERENCES tags(id) ON DELETE CASCADE
);
