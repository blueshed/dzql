import { compilePermission } from "../compiler/permissions.js";
import { compileGraphRules } from "../compiler/graph_rules.js";
import type { EntityIR, ManyToManyIR } from "../../shared/ir.js";

/** Column info from EntityIR */
interface ColumnInfo {
  name: string;
  type: string;
  isArray: boolean;
}

/**
 * Generate a jsonb_build_object expression that excludes hidden fields.
 * If no hidden fields, returns to_jsonb(alias.*) for efficiency.
 * @param alias - Table alias (e.g., 'venues', 't', 'root')
 * @param columns - All columns from entityIR
 * @param hidden - Array of hidden field names
 */
function buildVisibleJsonb(alias: string, columns: ColumnInfo[], hidden: string[] = []): string {
  if (!hidden || hidden.length === 0) {
    return `to_jsonb(${alias}.*)`;
  }

  const visibleCols = columns.filter(c => !hidden.includes(c.name));
  const pairs = visibleCols.map(c => `'${c.name}', ${alias}.${c.name}`).join(', ');
  return `jsonb_build_object(${pairs})`;
}

export function generateCoreSQL() {
  return `
-- DZQL V2 Core Schema
CREATE SCHEMA IF NOT EXISTS dzql_v2;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Migrations Table
CREATE TABLE IF NOT EXISTS dzql_v2.migrations (
  id text PRIMARY KEY,
  applied_at timestamptz DEFAULT now(),
  checksum text NOT NULL,
  name text NOT NULL
);

-- Events Table (Normalized Row Events)
CREATE TABLE IF NOT EXISTS dzql_v2.events (
  id bigserial PRIMARY KEY,
  commit_id bigint NOT NULL,
  table_name text NOT NULL,
  op text NOT NULL,
  pk jsonb NOT NULL,
  data jsonb,
  old_data jsonb,
  user_id int,
  affected_keys text[] DEFAULT ARRAY[]::text[],
  notify_users int[] DEFAULT ARRAY[]::int[],
  created_at timestamptz DEFAULT now()
);

-- Commit Sequence
CREATE SEQUENCE IF NOT EXISTS dzql_v2.commit_seq;

-- Default compute_affected_keys (returns empty array, overwritten when subscribables exist)
CREATE OR REPLACE FUNCTION dzql_v2.compute_affected_keys(
  p_table TEXT,
  p_op TEXT,
  p_data JSONB
) RETURNS TEXT[]
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  RETURN ARRAY[]::text[];
END;
$$;

-- === AUTH FUNCTIONS ===

-- Register User
CREATE OR REPLACE FUNCTION dzql_v2.register_user(p_params jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = dzql_v2, public
AS $$
DECLARE
  v_user_id int;
  v_email text;
  v_password text;
  v_name text;
  v_options jsonb;
BEGIN
  v_email := p_params->>'email';
  v_password := p_params->>'password';
  v_name := COALESCE(p_params->>'name', v_email);
  v_options := COALESCE(p_params->'options', '{}'::jsonb);

  IF v_email IS NULL OR v_password IS NULL THEN
    RAISE EXCEPTION 'validation_error: email and password required';
  END IF;

  INSERT INTO users (email, password_hash, name)
  VALUES (v_email, crypt(v_password, gen_salt('bf')), v_name)
  RETURNING id INTO v_user_id;

  -- TODO: Handle v_options if needed (e.g. creating orgs)

  -- Return minimal profile (Token generation happens in Runtime layer)
  RETURN jsonb_build_object(
    'user_id', v_user_id,
    'email', v_email,
    'name', v_name
  );
END;
$$;

-- Login User
CREATE OR REPLACE FUNCTION dzql_v2.login_user(p_params jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = dzql_v2, public
AS $$
DECLARE
  v_user record;
BEGIN
  SELECT * INTO v_user FROM users WHERE email = p_params->>'email';

  IF v_user IS NULL OR v_user.password_hash != crypt(p_params->>'password', v_user.password_hash) THEN
    RAISE EXCEPTION 'permission_denied: invalid credentials';
  END IF;

  RETURN jsonb_build_object(
    'user_id', v_user.id,
    'email', v_user.email,
    'name', v_user.name
  );
END;
$$;
`;
}

export function generateSchemaSQL(name: string, entityIR: EntityIR): string {
  const columns = entityIR.columns.map((c: ColumnInfo) => {
    return `${c.name} ${c.type}`;
  }).join(',\n  ');

  return `
CREATE TABLE IF NOT EXISTS ${name} (
  ${columns}
);
`;
}

// === SAVE FUNCTION (Upsert) ===
export function generateSaveFunction(name: string, entityIR: EntityIR): string {
  const cols = entityIR.columns.map((c: ColumnInfo) => c.name);
  const pkFields = entityIR.primaryKey.length > 0 ? entityIR.primaryKey : ['id'];
  const pk = pkFields[0]; // For backwards compatibility with single PK
  const isCompositePK = pkFields.length > 1;
  const fieldDefaults = entityIR.fieldDefaults || {};
  const hidden = entityIR.hidden || [];

  // Build INSERT columns/values
  // Exclude serial columns from INSERT (let DB handle sequence)
  const insertCols = entityIR.columns.filter((c: ColumnInfo) => {
      const isSerial = c.type.toLowerCase().includes('serial');
      return !isSerial;
  });

  const colList = insertCols.map((c: ColumnInfo) => c.name).join(', ');

  // Build value list with field defaults support
  const valList = insertCols.map((c: ColumnInfo) => {
    let cast = '';
    if (c.type.includes('int') || c.type.includes('serial')) cast = '::int';
    else if (c.type.includes('timestamp')) cast = '::timestamptz';
    else if (c.type.includes('date')) cast = '::date';
    else if (c.type.includes('bool')) cast = '::boolean';
    else if (c.type.includes('decimal') || c.type.includes('numeric')) cast = '::numeric';

    const defaultValue = fieldDefaults[c.name];
    if (defaultValue) {
      // Apply field default if not provided in p_data
      let defaultExpr: string;
      if (defaultValue === '@user_id') {
        defaultExpr = 'p_user_id';
      } else if (defaultValue === '@now') {
        defaultExpr = 'now()';
      } else if (defaultValue === '@today') {
        defaultExpr = 'current_date';
      } else {
        // Literal value
        defaultExpr = `'${defaultValue}'${cast}`;
      }
      return `COALESCE((p_data->>'${c.name}')${cast}, ${defaultExpr})`;
    }
    return `(p_data->>'${c.name}')${cast}`;
  }).join(', ');

  // Build UPDATE SET clause (Partial Update) - exclude all PK fields
  const updateSetClause = entityIR.columns
    .filter((c: ColumnInfo) => !pkFields.includes(c.name))
    .map((c: ColumnInfo) => {
      let cast = '';
      if (c.type.includes('int') || c.type.includes('serial')) cast = '::int';
      else if (c.type.includes('timestamp')) cast = '::timestamptz';
      else if (c.type.includes('date')) cast = '::date';
      else if (c.type.includes('bool')) cast = '::boolean';
      else if (c.type.includes('decimal') || c.type.includes('numeric')) cast = '::numeric';

      return `${c.name} = CASE WHEN (p_data ? '${c.name}') THEN (p_data->>'${c.name}')${cast} ELSE ${c.name} END`;
    })
    .join(',\n    ');

  // Build composite PK handling
  const pkExistsCheck = pkFields.map(f => {
    const col = entityIR.columns.find((c: ColumnInfo) => c.name === f);
    let cast = '::int';
    if (col) {
      if (col.type.includes('text') || col.type.includes('varchar')) cast = '';
      else if (col.type.includes('date')) cast = '::date';
      else if (col.type.includes('timestamp')) cast = '::timestamptz';
    }
    return `${f} = (p_data->>'${f}')${cast}`;
  }).join(' AND ');

  const pkWhereClause = pkExistsCheck;

  // Build PK JSONB object for events (use -> to preserve type, not ->> which extracts as text)
  const pkJsonbExpr = pkFields.length === 1
    ? `jsonb_build_object('${pk}', v_result->'${pk}')`
    : `jsonb_build_object(${pkFields.map(f => `'${f}', v_result->'${f}'`).join(', ')})`;

  // Check if all PK fields are present
  const pkNullCheck = pkFields.map(f => `(p_data->>'${f}') IS NOT NULL`).join(' AND ');

  // Permissions & Graph Rules
  const createPerm = entityIR.permissions?.create?.[0]
    ? compilePermission(name, entityIR.permissions.create[0], null, 'p_data')
    : 'TRUE';

  const updatePerm = entityIR.permissions?.update?.[0]
    ? compilePermission(name, entityIR.permissions.update[0], null, 'p_data')
    : 'TRUE';

  const onCreateRules = entityIR.graphRules?.onCreate
    ? compileGraphRules(name, 'create', entityIR.graphRules.onCreate)
    : '';

  const onUpdateRules = entityIR.graphRules?.onUpdate
    ? compileGraphRules(name, 'update', entityIR.graphRules.onUpdate)
    : '';

  // M2M Support
  const m2m: Record<string, ManyToManyIR> = entityIR.manyToMany || {};
  const m2mKeys = Object.keys(m2m);

  // M2M variable declarations
  const m2mVarDeclarations = m2mKeys.map(key => {
    const config: ManyToManyIR = m2m[key];
    return `  v_${config.idField} INT[];`;
  }).join('\n');

  // M2M extraction (remove from p_data before INSERT/UPDATE)
  const m2mExtraction = m2mKeys.map(key => {
    const config: ManyToManyIR = m2m[key];
    return `
  -- M2M: Extract ${key} IDs
  IF p_data ? '${config.idField}' THEN
    v_${config.idField} := ARRAY(SELECT jsonb_array_elements_text(p_data->'${config.idField}')::int);
    p_data := p_data - '${config.idField}';
  END IF;`;
  }).join('\n');

  // M2M sync (after INSERT/UPDATE) - uses first PK field for M2M local key
  // Note: M2M typically uses a single local key (the entity's ID), not composite PK
  const m2mSync = m2mKeys.map(key => {
    const config: ManyToManyIR = m2m[key];
    return `
  -- M2M Sync: ${key} (junction: ${config.junctionTable})
  IF v_${config.idField} IS NOT NULL THEN
    -- Delete relationships not in new list
    DELETE FROM ${config.junctionTable}
    WHERE ${config.localKey} = (v_result->>'${pk}')::int
      AND (${config.foreignKey} <> ALL(v_${config.idField}) OR v_${config.idField} = '{}');

    -- Insert new relationships (idempotent)
    IF array_length(v_${config.idField}, 1) > 0 THEN
      INSERT INTO ${config.junctionTable} (${config.localKey}, ${config.foreignKey})
      SELECT (v_result->>'${pk}')::int, unnest(v_${config.idField})
      ON CONFLICT (${config.localKey}, ${config.foreignKey}) DO NOTHING;
    END IF;
  END IF;`;
  }).join('\n');

  // M2M expansion (add to output)
  const m2mExpansion = m2mKeys.map(key => {
    const config: ManyToManyIR = m2m[key];
    let sql = `
  -- M2M: Add ${config.idField} to output
  v_result := v_result || jsonb_build_object('${config.idField}',
    (SELECT COALESCE(jsonb_agg(${config.foreignKey} ORDER BY ${config.foreignKey}), '[]'::jsonb)
     FROM ${config.junctionTable} WHERE ${config.localKey} = (v_result->>'${pk}')::int));`;

    if (config.expand) {
      sql += `
  -- M2M: Add expanded ${key} to output
  v_result := v_result || jsonb_build_object('${key}',
    (SELECT COALESCE(jsonb_agg(to_jsonb(t.*) ORDER BY t.id), '[]'::jsonb)
     FROM ${config.junctionTable} jt
     JOIN ${config.targetEntity} t ON t.id = jt.${config.foreignKey}
     WHERE jt.${config.localKey} = (v_result->>'${pk}')::int));`;
    }
    return sql;
  }).join('\n');

  return `
CREATE OR REPLACE FUNCTION dzql_v2.save_${name}(p_user_id int, p_data jsonb)
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
  v_notify_users int[];
${m2mVarDeclarations}
BEGIN
  v_commit_id := nextval('dzql_v2.commit_seq');
${m2mExtraction}

  -- Determine Operation & Check Permissions (supports composite PK)
  IF (${pkNullCheck}) AND EXISTS(SELECT 1 FROM ${name} WHERE ${pkWhereClause}) THEN
    v_op := 'update';

    -- Fetch old data for update rules/events
    SELECT to_jsonb(${name}.*) INTO v_old_data FROM ${name} WHERE ${pkWhereClause};

    IF NOT (${updatePerm}) THEN
      RAISE EXCEPTION 'permission_denied';
    END IF;

    -- Perform Partial Update
    UPDATE ${name} SET
    ${updateSetClause}
    WHERE ${pkWhereClause}
    RETURNING to_jsonb(${name}.*) INTO v_result;

    ${onUpdateRules}

  ELSE
    v_op := 'insert';
    IF NOT (${createPerm}) THEN
      RAISE EXCEPTION 'permission_denied';
    END IF;

    -- Perform Insert
    INSERT INTO ${name} (${colList})
    VALUES (${valList})
    RETURNING to_jsonb(${name}.*) INTO v_result;

    ${onCreateRules}
  END IF;
${m2mSync}
${m2mExpansion}

  -- Resolve notification recipients
  v_notify_users := dzql_v2.${name}_notify_users(p_user_id, v_result);

  -- Emit Event with pre-computed affected keys and notify users
  INSERT INTO dzql_v2.events (commit_id, table_name, op, pk, data, old_data, user_id, affected_keys, notify_users)
  VALUES (
    v_commit_id,
    '${name}',
    v_op,
    ${pkJsonbExpr},
    v_result,
    v_old_data, -- NULL for insert
    p_user_id,
    dzql_v2.compute_affected_keys('${name}', v_op, v_result),
    v_notify_users
  );

  -- Notify Runtime
  PERFORM pg_notify('dzql_v2', json_build_object('commit_id', v_commit_id)::text);

  -- Remove hidden fields before returning to client
  RETURN ${hidden.length > 0 ? `v_result - ARRAY[${hidden.map(f => `'${f}'`).join(', ')}]` : 'v_result'};
END;
$$;
`;
}

// === DELETE FUNCTION (Cascade or Soft Delete) ===
export function generateDeleteFunction(name: string, entityIR: EntityIR): string {
  const pkFields = entityIR.primaryKey.length > 0 ? entityIR.primaryKey : ['id'];
  const pk = pkFields[0];
  const softDelete = entityIR.softDelete || false;
  const hidden = entityIR.hidden || [];

  // Build composite PK handling
  const pkWhereClause = pkFields.map(f => {
    const col = entityIR.columns.find((c: ColumnInfo) => c.name === f);
    let cast = '::int';
    if (col) {
      if (col.type.includes('text') || col.type.includes('varchar')) cast = '';
      else if (col.type.includes('date')) cast = '::date';
      else if (col.type.includes('timestamp')) cast = '::timestamptz';
    }
    return `${f} = (p_pk->>'${f}')${cast}`;
  }).join(' AND ');

  // Build PK JSONB object for events (use -> to preserve type, not ->> which extracts as text)
  const pkJsonbExpr = pkFields.length === 1
    ? `jsonb_build_object('${pk}', v_old_data->'${pk}')`
    : `jsonb_build_object(${pkFields.map(f => `'${f}', v_old_data->'${f}'`).join(', ')})`;

  // Permissions (Check against v_old_data)
  const deletePerm = entityIR.permissions?.delete?.[0]
    ? compilePermission(name, entityIR.permissions.delete[0], null, 'v_old_data')
    : 'TRUE';

  const onDeleteRules = entityIR.graphRules?.onDelete
    ? compileGraphRules(name, 'delete', entityIR.graphRules.onDelete)
    : '';

  // Soft delete: UPDATE SET deleted_at = now() instead of DELETE
  const deleteOperation = softDelete
    ? `UPDATE ${name} SET deleted_at = now() WHERE ${pkWhereClause}`
    : `DELETE FROM ${name} WHERE ${pkWhereClause}`;

  return `
CREATE OR REPLACE FUNCTION dzql_v2.delete_${name}(p_user_id int, p_pk jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = dzql_v2, public
AS $$
DECLARE
  v_old_data jsonb;
  v_commit_id bigint;
  v_notify_users int[];
BEGIN
  v_commit_id := nextval('dzql_v2.commit_seq');

  -- Fetch old data FIRST for permission check
  SELECT to_jsonb(${name}.*) INTO v_old_data FROM ${name} WHERE ${pkWhereClause};

  IF v_old_data IS NULL THEN
    RAISE EXCEPTION 'not_found';
  END IF;

  -- Permission Check (Delete)
  IF NOT (${deletePerm}) THEN
    RAISE EXCEPTION 'permission_denied';
  END IF;

  -- Graph Rules (Pre-delete cascades)
  ${onDeleteRules}

  -- Perform ${softDelete ? 'Soft ' : ''}Delete
  ${deleteOperation};

  -- Resolve notification recipients
  v_notify_users := dzql_v2.${name}_notify_users(p_user_id, v_old_data);

  -- Emit Event with pre-computed affected keys and notify users (always 'delete' operation for client-side removal)
  INSERT INTO dzql_v2.events (commit_id, table_name, op, pk, data, old_data, user_id, affected_keys, notify_users)
  VALUES (
    v_commit_id,
    '${name}',
    'delete',
    ${pkJsonbExpr},
    v_old_data,  -- Include full data for subscription resolution
    v_old_data,
    p_user_id,
    dzql_v2.compute_affected_keys('${name}', 'delete', v_old_data),
    v_notify_users
  );

  -- Notify Runtime
  PERFORM pg_notify('dzql_v2', json_build_object('commit_id', v_commit_id)::text);

  -- Remove hidden fields before returning to client
  RETURN ${hidden.length > 0 ? `v_old_data - ARRAY[${hidden.map(f => `'${f}'`).join(', ')}]` : 'v_old_data'};
END;
$$;
`;
}

// === GET FUNCTION ===
export function generateGetFunction(name: string, entityIR: EntityIR): string {
  const pkFields = entityIR.primaryKey.length > 0 ? entityIR.primaryKey : ['id'];
  const pk = pkFields[0];
  const hidden = entityIR.hidden || [];

  // Build composite PK handling
  const pkWhereClause = pkFields.map(f => {
    const col = entityIR.columns.find((c: ColumnInfo) => c.name === f);
    let cast = '::int';
    if (col) {
      if (col.type.includes('text') || col.type.includes('varchar')) cast = '';
      else if (col.type.includes('date')) cast = '::date';
      else if (col.type.includes('timestamp')) cast = '::timestamptz';
    }
    return `${f} = (p_pk->>'${f}')${cast}`;
  }).join(' AND ');

  const viewPerm = entityIR.permissions?.view?.length > 0
    ? entityIR.permissions.view.map((rule: string) => compilePermission(name, rule, null, name)).join(' OR ')
    : 'TRUE';

  // Build SELECT expression excluding hidden fields
  const selectExpr = buildVisibleJsonb(name, entityIR.columns, hidden);

  // M2M expansion for GET
  const m2m: Record<string, ManyToManyIR> = entityIR.manyToMany || {};
  const m2mKeys = Object.keys(m2m);

  const m2mExpansion = m2mKeys.map(key => {
    const config: ManyToManyIR = m2m[key];
    let sql = `
  -- M2M: Add ${config.idField} to result
  v_result := v_result || jsonb_build_object('${config.idField}',
    (SELECT COALESCE(jsonb_agg(${config.foreignKey} ORDER BY ${config.foreignKey}), '[]'::jsonb)
     FROM ${config.junctionTable} WHERE ${config.localKey} = (v_result->>'${pk}')::int));`;

    if (config.expand) {
      sql += `
  -- M2M: Add expanded ${key} to result
  v_result := v_result || jsonb_build_object('${key}',
    (SELECT COALESCE(jsonb_agg(to_jsonb(t.*) ORDER BY t.id), '[]'::jsonb)
     FROM ${config.junctionTable} jt
     JOIN ${config.targetEntity} t ON t.id = jt.${config.foreignKey}
     WHERE jt.${config.localKey} = (v_result->>'${pk}')::int));`;
    }
    return sql;
  }).join('\n');

  return `
CREATE OR REPLACE FUNCTION dzql_v2.get_${name}(p_user_id int, p_pk jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = dzql_v2, public
AS $$
DECLARE
  v_result jsonb;
BEGIN
  SELECT ${selectExpr} INTO v_result
  FROM ${name}
  WHERE ${pkWhereClause}
    AND (${viewPerm});

  IF v_result IS NULL THEN
    RETURN NULL;
  END IF;
${m2mExpansion}

  RETURN v_result;
END;
$$;
`;
}

// === SEARCH FUNCTION ===
export function generateSearchFunction(name: string, entityIR: EntityIR): string {
  const pk = entityIR.primaryKey[0] || 'id';
  const softDelete = entityIR.softDelete || false;
  const hidden = entityIR.hidden || [];

  const viewPerm = entityIR.permissions?.view?.length > 0
    ? entityIR.permissions.view.map((rule: string) => compilePermission(name, rule, null, name)).join(' OR ')
    : 'TRUE';

  // Soft delete filter - exclude deleted records from search
  const softDeleteFilter = softDelete ? ' AND deleted_at IS NULL' : '';

  // Get the label field for default sorting
  const labelField = entityIR.labelField || 'id';

  // M2M expansion for SEARCH using LATERAL joins
  const m2m: Record<string, ManyToManyIR> = entityIR.manyToMany || {};
  const m2mKeys = Object.keys(m2m);

  // Build LATERAL joins for each M2M relationship
  const m2mLateralJoins = m2mKeys.map(key => {
    const config: ManyToManyIR = m2m[key];
    let sql = `
      LEFT JOIN LATERAL (
        SELECT COALESCE(jsonb_agg(${config.foreignKey} ORDER BY ${config.foreignKey}), ''[]''::jsonb) as ${config.idField}
        FROM ${config.junctionTable}
        WHERE ${config.localKey} = t.${pk}
      ) m2m_${config.idField} ON true`;

    if (config.expand) {
      sql += `
      LEFT JOIN LATERAL (
        SELECT COALESCE(jsonb_agg(to_jsonb(target.*) ORDER BY target.id), ''[]''::jsonb) as ${key}
        FROM ${config.junctionTable} jt
        JOIN ${config.targetEntity} target ON target.id = jt.${config.foreignKey}
        WHERE jt.${config.localKey} = t.${pk}
      ) m2m_${key} ON true`;
    }
    return sql;
  }).join('');

  // Build base SELECT expression excluding hidden fields (escape single quotes for dynamic SQL)
  const baseSelectExpr = buildVisibleJsonb('t', entityIR.columns, hidden).replace(/'/g, "''");

  // Build SELECT expression that merges M2M fields
  const m2mSelectMerge = m2mKeys.map(key => {
    const config = m2m[key];
    let merge = ` || jsonb_build_object(''${config.idField}'', m2m_${config.idField}.${config.idField})`;
    if (config.expand) {
      merge += ` || jsonb_build_object(''${key}'', m2m_${key}.${key})`;
    }
    return merge;
  }).join('');

  const selectExpr = m2mKeys.length > 0
    ? `${baseSelectExpr}${m2mSelectMerge}`
    : baseSelectExpr;

  return `
CREATE OR REPLACE FUNCTION dzql_v2.search_${name}(p_user_id int, p_query jsonb)
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
  v_sort_field := COALESCE(p_query->>'sort_field', '${labelField}');
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
    SELECT COALESCE(jsonb_agg(${selectExpr}), ''[]''::jsonb)
    FROM (
      SELECT * FROM ${name}
      WHERE (${viewPerm})${softDeleteFilter} %s
      ORDER BY %I %s
      LIMIT %L OFFSET %L
    ) t${m2mLateralJoins}
  ', v_where_clause, v_sort_field, v_sort_order,
     COALESCE((p_query->>'limit')::int, 10),
     COALESCE((p_query->>'offset')::int, 0))
  INTO v_results;

  RETURN v_results;
END;
$$;
`;
}

// === AGGREGATE GENERATOR ===
export function generateEntitySQL(name: string, entityIR: EntityIR): string {
  // Import here to avoid circular dependency
  const { generateNotificationFunction } = require('./notification.js');

  return [
    generateNotificationFunction(name, entityIR),
    generateSaveFunction(name, entityIR),
    generateDeleteFunction(name, entityIR),
    generateGetFunction(name, entityIR),
    generateSearchFunction(name, entityIR)
  ].join('\n');
}
