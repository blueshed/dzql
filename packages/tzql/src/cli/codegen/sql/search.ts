import { compilePermission } from "../../compiler/permissions.js";
import type { EntityIR, ManyToManyIR, ColumnInfo } from "./types.js";
import { buildVisibleJsonb } from "./utils.js";

// === SEARCH FUNCTION ===
export function generateSearchFunction(name: string, entityIR: EntityIR): string {
  const pk = entityIR.primaryKey[0] || 'id';
  const softDelete = entityIR.softDelete || false;
  const hidden = entityIR.hidden || [];
  const temporal = entityIR.temporal;

  // For dynamic SQL in EXECUTE, we need to use $1 instead of p_user_id
  const viewPermRaw = entityIR.permissions?.view?.length > 0
    ? entityIR.permissions.view.map((rule: string) => compilePermission(name, rule, null, name)).join(' OR ')
    : 'TRUE';
  const viewPerm = viewPermRaw.replace(/p_user_id/g, '$1');

  // Soft delete filter
  const softDeleteFilter = softDelete ? ' AND deleted_at IS NULL' : '';

  // Temporal filter - only return current versions
  const temporalFilter = temporal ? ` AND ${temporal.validTo} IS NULL` : '';

  const labelField = entityIR.labelField || 'id';

  // M2M expansion using LATERAL joins
  const m2m: Record<string, ManyToManyIR> = entityIR.manyToMany || {};
  const m2mKeys = Object.keys(m2m);

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

  // Build SELECT expression (escape single quotes for dynamic SQL)
  const baseSelectExpr = buildVisibleJsonb('t', entityIR.columns, hidden).replace(/'/g, "''");

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
RETURNS SETOF jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = dzql_v2, public
AS $$
DECLARE
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
  -- Note: We avoid ::TEXT casts to preserve index usage on numeric/date columns
  -- The %L format specifier handles proper escaping for all types
  FOR v_field, v_filter IN SELECT * FROM jsonb_each(v_filters)
  LOOP
    -- Handle simple value (exact match)
    IF jsonb_typeof(v_filter) = 'number' THEN
      -- Numeric: compare without casting
      v_where_clause := v_where_clause || format(' AND %I = %s', v_field, v_filter);
    ELSIF jsonb_typeof(v_filter) = 'boolean' THEN
      -- Boolean: compare directly
      v_where_clause := v_where_clause || format(' AND %I = %s', v_field, v_filter);
    ELSIF jsonb_typeof(v_filter) = 'string' THEN
      -- String: use proper quoting
      v_where_clause := v_where_clause || format(' AND %I = %L', v_field, v_filter #>> '{}');
    ELSIF jsonb_typeof(v_filter) = 'object' THEN
      -- Handle operator-based filters
      FOR v_operator, v_value IN SELECT * FROM jsonb_each(v_filter)
      LOOP
        CASE v_operator
          WHEN 'eq' THEN
            IF jsonb_typeof(v_value) = 'number' THEN
              v_where_clause := v_where_clause || format(' AND %I = %s', v_field, v_value);
            ELSE
              v_where_clause := v_where_clause || format(' AND %I = %L', v_field, v_value #>> '{}');
            END IF;
          WHEN 'ne' THEN
            IF jsonb_typeof(v_value) = 'number' THEN
              v_where_clause := v_where_clause || format(' AND %I != %s', v_field, v_value);
            ELSE
              v_where_clause := v_where_clause || format(' AND %I != %L', v_field, v_value #>> '{}');
            END IF;
          WHEN 'gt' THEN
            IF jsonb_typeof(v_value) = 'number' THEN
              v_where_clause := v_where_clause || format(' AND %I > %s', v_field, v_value);
            ELSE
              v_where_clause := v_where_clause || format(' AND %I > %L', v_field, v_value #>> '{}');
            END IF;
          WHEN 'gte' THEN
            IF jsonb_typeof(v_value) = 'number' THEN
              v_where_clause := v_where_clause || format(' AND %I >= %s', v_field, v_value);
            ELSE
              v_where_clause := v_where_clause || format(' AND %I >= %L', v_field, v_value #>> '{}');
            END IF;
          WHEN 'lt' THEN
            IF jsonb_typeof(v_value) = 'number' THEN
              v_where_clause := v_where_clause || format(' AND %I < %s', v_field, v_value);
            ELSE
              v_where_clause := v_where_clause || format(' AND %I < %L', v_field, v_value #>> '{}');
            END IF;
          WHEN 'lte' THEN
            IF jsonb_typeof(v_value) = 'number' THEN
              v_where_clause := v_where_clause || format(' AND %I <= %s', v_field, v_value);
            ELSE
              v_where_clause := v_where_clause || format(' AND %I <= %L', v_field, v_value #>> '{}');
            END IF;
          WHEN 'in' THEN
            -- For IN, we need to handle arrays - cast elements appropriately
            IF jsonb_typeof(v_value->0) = 'number' THEN
              v_where_clause := v_where_clause || format(' AND %I = ANY(ARRAY(SELECT (jsonb_array_elements(%L))::int))', v_field, v_value);
            ELSE
              v_where_clause := v_where_clause || format(' AND %I = ANY(ARRAY(SELECT jsonb_array_elements_text(%L)))', v_field, v_value);
            END IF;
          WHEN 'not_in' THEN
            IF jsonb_typeof(v_value->0) = 'number' THEN
              v_where_clause := v_where_clause || format(' AND %I != ALL(ARRAY(SELECT (jsonb_array_elements(%L))::int))', v_field, v_value);
            ELSE
              v_where_clause := v_where_clause || format(' AND %I != ALL(ARRAY(SELECT jsonb_array_elements_text(%L)))', v_field, v_value);
            END IF;
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

  -- Execute dynamic query and return set of jsonb
  RETURN QUERY EXECUTE format('
    SELECT ${selectExpr}
    FROM (
      SELECT * FROM ${name}
      WHERE (${viewPerm})${softDeleteFilter}${temporalFilter} %s
      ORDER BY %I %s
      LIMIT %L OFFSET %L
    ) t${m2mLateralJoins}
  ', v_where_clause, v_sort_field, v_sort_order,
     COALESCE((p_query->>'limit')::int, 10),
     COALESCE((p_query->>'offset')::int, 0))
  USING p_user_id;
END;
$$;
`;
}
