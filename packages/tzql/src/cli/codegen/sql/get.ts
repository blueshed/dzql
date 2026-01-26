import { compilePermission } from "../../compiler/permissions.js";
import type { EntityIR, ManyToManyIR, IncludeIR, ColumnInfo } from "./types.js";
import { buildVisibleJsonb } from "./utils.js";

// === GET FUNCTION ===
export function generateGetFunction(name: string, entityIR: EntityIR): string {
  const pkFields = entityIR.primaryKey.length > 0 ? entityIR.primaryKey : ['id'];
  const pk = pkFields[0];
  const hidden = entityIR.hidden || [];
  const temporal = entityIR.temporal;

  // For temporal entities WITH refField, we query by ref (the stable identifier)
  // Temporal entities without refField use standard PK lookup
  let pkWhereClause: string;
  let temporalFilter = '';

  if (temporal?.refField) {
    const refField = temporal.refField;
    const validFrom = temporal.validFrom;
    const validTo = temporal.validTo;

    // Build standard PK lookup for fallback
    const standardPkClause = pkFields.map(f => {
      const col = entityIR.columns.find((c: ColumnInfo) => c.name === f);
      let cast = '::int';
      if (col) {
        if (col.type.includes('text') || col.type.includes('varchar')) cast = '';
        else if (col.type.includes('date')) cast = '::date';
        else if (col.type.includes('timestamp')) cast = '::timestamptz';
      }
      return `${f} = (p_pk->>'${f}')${cast}`;
    }).join(' AND ');

    // Query by ref OR by id, with temporal filtering for ref-based queries
    // If p_pk has refField: query by ref with validity check
    // Otherwise: query by standard PK (id)
    pkWhereClause = `(
      ((p_pk ? '${refField}') AND ${refField} = (p_pk->>'${refField}')::int)
      OR
      (NOT (p_pk ? '${refField}') AND ${standardPkClause})
    )`;

    // Temporal filter: only apply when querying by ref
    temporalFilter = `
    AND (
      NOT (p_pk ? '${refField}')
      OR (
        (p_pk ? 'as_of') AND ${validFrom} <= (p_pk->>'as_of')::timestamptz AND (${validTo} IS NULL OR ${validTo} > (p_pk->>'as_of')::timestamptz)
      )
      OR (
        NOT (p_pk ? 'as_of') AND ${validTo} IS NULL
      )
    )`;
  } else {
    // Non-temporal: standard PK lookup
    pkWhereClause = pkFields.map(f => {
      const col = entityIR.columns.find((c: ColumnInfo) => c.name === f);
      let cast = '::int';
      if (col) {
        if (col.type.includes('text') || col.type.includes('varchar')) cast = '';
        else if (col.type.includes('date')) cast = '::date';
        else if (col.type.includes('timestamp')) cast = '::timestamptz';
      }
      return `${f} = (p_pk->>'${f}')${cast}`;
    }).join(' AND ');
  }

  const viewPerm = entityIR.permissions?.view?.length > 0
    ? entityIR.permissions.view.map((rule: string) => compilePermission(name, rule, null, name)).join(' OR ')
    : 'TRUE';

  const selectExpr = buildVisibleJsonb(name, entityIR.columns, hidden);

  // FK expansion
  const includes: Record<string, IncludeIR> = entityIR.includes || {};
  const fkExpansion = Object.entries(includes).map(([key, config]) => {
    const targetEntity = config.entity;
    const fkField = `${key}_id`;
    const hasFkColumn = entityIR.columns.some((c: ColumnInfo) => c.name === fkField);

    if (hasFkColumn) {
      return `
  -- FK: Add ${key} to result (from ${fkField})
  IF (v_result->>'${fkField}') IS NOT NULL THEN
    v_result := v_result || jsonb_build_object('${key}',
      (SELECT to_jsonb(t.*) FROM ${targetEntity} t WHERE t.id = (v_result->>'${fkField}')::int));
  END IF;`;
    }
    return '';
  }).filter(s => s).join('\n');

  // M2M expansion
  const m2m: Record<string, ManyToManyIR> = entityIR.manyToMany || {};
  const m2mExpansion = Object.entries(m2m).map(([key, config]) => {
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
  WHERE ${pkWhereClause}${temporalFilter}
    AND (${viewPerm});

  IF v_result IS NULL THEN
    RETURN NULL;
  END IF;
${fkExpansion}
${m2mExpansion}

  RETURN v_result;
END;
$$;
`;
}

// === HISTORY FUNCTION (for temporal entities) ===
export function generateHistoryFunction(name: string, entityIR: EntityIR): string {
  const hidden = entityIR.hidden || [];
  const temporal = entityIR.temporal!;

  const refField = temporal.refField;
  const validFrom = temporal.validFrom;

  const viewPerm = entityIR.permissions?.view?.length > 0
    ? entityIR.permissions.view.map((rule: string) => compilePermission(name, rule, null, name)).join(' OR ')
    : 'TRUE';

  const selectExpr = buildVisibleJsonb(name, entityIR.columns, hidden);

  return `
CREATE OR REPLACE FUNCTION dzql_v2.get_${name}_history(p_user_id int, p_pk jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = dzql_v2, public
AS $$
DECLARE
  v_results jsonb;
  v_ref int;
BEGIN
  v_ref := (p_pk->>'${refField}')::int;

  IF v_ref IS NULL THEN
    RAISE EXCEPTION 'validation_error: ${refField} is required';
  END IF;

  SELECT COALESCE(jsonb_agg(${selectExpr} ORDER BY ${validFrom} DESC), '[]'::jsonb)
  INTO v_results
  FROM ${name}
  WHERE ${refField} = v_ref
    AND (${viewPerm});

  RETURN v_results;
END;
$$;
`;
}
