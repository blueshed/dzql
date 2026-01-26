import { compilePermission } from "../../compiler/permissions.js";
import { compileGraphRules } from "../../compiler/graph_rules.js";
import type { EntityIR, ManyToManyIR, IncludeIR, ColumnInfo } from "./types.js";
import { getCastForType } from "./utils.js";

/**
 * Generate M2M variable declarations
 */
function generateM2MDeclarations(m2m: Record<string, ManyToManyIR>): string {
  return Object.values(m2m).map(config => {
    return `  v_${config.idField} INT[];`;
  }).join('\n');
}

/**
 * Generate M2M extraction code (remove from p_data before INSERT/UPDATE)
 */
function generateM2MExtraction(m2m: Record<string, ManyToManyIR>): string {
  return Object.entries(m2m).map(([key, config]) => {
    return `
  -- M2M: Extract ${key} IDs
  IF p_data ? '${config.idField}' THEN
    v_${config.idField} := ARRAY(SELECT jsonb_array_elements_text(p_data->'${config.idField}')::int);
    p_data := p_data - '${config.idField}';
  END IF;`;
  }).join('\n');
}

/**
 * Generate M2M sync code (after INSERT/UPDATE)
 */
function generateM2MSync(m2m: Record<string, ManyToManyIR>, pk: string): string {
  return Object.entries(m2m).map(([key, config]) => {
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
}

/**
 * Generate M2M expansion code (add to output)
 */
function generateM2MExpansion(m2m: Record<string, ManyToManyIR>, pk: string): string {
  return Object.entries(m2m).map(([key, config]) => {
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
}

/**
 * Generate FK expansion code (add related objects to output)
 */
function generateFKExpansion(includes: Record<string, IncludeIR>, columns: ColumnInfo[]): string {
  return Object.entries(includes).map(([key, config]) => {
    const targetEntity = config.entity;
    const fkField = `${key}_id`;
    const hasFkColumn = columns.some(c => c.name === fkField);

    if (hasFkColumn) {
      return `
  -- FK: Add ${key} to output (from ${fkField})
  IF (v_result->>'${fkField}') IS NOT NULL THEN
    v_result := v_result || jsonb_build_object('${key}',
      (SELECT to_jsonb(t.*) FROM ${targetEntity} t WHERE t.id = (v_result->>'${fkField}')::int));
  END IF;`;
    }
    return '';
  }).filter(s => s).join('\n');
}

// === SAVE FUNCTION (Upsert) ===
export function generateSaveFunction(name: string, entityIR: EntityIR): string {
  const pkFields = entityIR.primaryKey.length > 0 ? entityIR.primaryKey : ['id'];
  const pk = pkFields[0];
  const fieldDefaults = entityIR.fieldDefaults || {};
  const hidden = entityIR.hidden || [];
  const temporal = entityIR.temporal;

  // For temporal entities WITH refField, generate versioned save function
  // Temporal entities without refField just use standard save with validity filtering
  if (temporal?.refField) {
    return generateTemporalSaveFunction(name, entityIR);
  }

  // Build INSERT columns/values - exclude serial columns
  const insertCols = entityIR.columns.filter((c: ColumnInfo) => {
    const isSerial = c.type.toLowerCase().includes('serial');
    return !isSerial;
  });

  const colList = insertCols.map(c => c.name).join(', ');

  // Build value list with field defaults support
  const valList = insertCols.map((c: ColumnInfo) => {
    const cast = getCastForType(c.type);
    const defaultValue = fieldDefaults[c.name];

    if (defaultValue) {
      let defaultExpr: string;
      if (defaultValue === '@user_id') {
        defaultExpr = 'p_user_id';
      } else if (defaultValue === '@now') {
        defaultExpr = 'now()';
      } else if (defaultValue === '@today') {
        defaultExpr = 'current_date';
      } else {
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
      const cast = getCastForType(c.type);
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

  // Build PK JSONB object for events
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
  const m2mVarDeclarations = generateM2MDeclarations(m2m);
  const m2mExtraction = generateM2MExtraction(m2m);
  const m2mSync = generateM2MSync(m2m, pk);
  const m2mExpansion = generateM2MExpansion(m2m, pk);

  // FK expansion
  const includes: Record<string, IncludeIR> = entityIR.includes || {};
  const fkExpansion = generateFKExpansion(includes, entityIR.columns);

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
${fkExpansion}

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

// === TEMPORAL SAVE FUNCTION (Versioned Insert) ===
function generateTemporalSaveFunction(name: string, entityIR: EntityIR): string {
  const pkFields = entityIR.primaryKey.length > 0 ? entityIR.primaryKey : ['id'];
  const pk = pkFields[0];
  const fieldDefaults = entityIR.fieldDefaults || {};
  const hidden = entityIR.hidden || [];
  const temporal = entityIR.temporal!;

  const refField = temporal.refField;
  const validFrom = temporal.validFrom;
  const validTo = temporal.validTo;
  const sequenceName = temporal.sequence || `${name}_ref_seq`;

  // Build INSERT columns/values - exclude serial columns and valid_to
  const insertCols = entityIR.columns.filter((c: ColumnInfo) => {
    const isSerial = c.type.toLowerCase().includes('serial');
    const isValidTo = c.name === validTo;
    return !isSerial && !isValidTo;
  });

  const colList = insertCols.map(c => c.name).join(', ');

  // Build value list with field defaults support
  const valList = insertCols.map((c: ColumnInfo) => {
    const cast = getCastForType(c.type);

    // Special handling for temporal fields
    if (c.name === refField) {
      return `COALESCE((p_data->>'${refField}')::int, nextval('${sequenceName}')::int)`;
    }
    if (c.name === validFrom) {
      return 'now()';
    }

    const defaultValue = fieldDefaults[c.name];
    if (defaultValue) {
      let defaultExpr: string;
      if (defaultValue === '@user_id') {
        defaultExpr = 'p_user_id';
      } else if (defaultValue === '@now') {
        defaultExpr = 'now()';
      } else if (defaultValue === '@today') {
        defaultExpr = 'current_date';
      } else {
        defaultExpr = `'${defaultValue}'${cast}`;
      }
      return `COALESCE((p_data->>'${c.name}')${cast}, ${defaultExpr})`;
    }
    return `(p_data->>'${c.name}')${cast}`;
  }).join(', ');

  // Build copy-forward logic for fields not in p_data
  // These are SELECT expressions that copy from v_current if not in p_data
  const copyForwardFields = entityIR.columns
    .filter((c: ColumnInfo) => {
      const isSerial = c.type.toLowerCase().includes('serial');
      const isTemporal = c.name === validFrom || c.name === validTo;
      return !isSerial && !isTemporal && c.name !== refField;
    })
    .map((c: ColumnInfo) => {
      const cast = getCastForType(c.type);
      return `CASE WHEN (p_data ? '${c.name}') THEN (p_data->>'${c.name}')${cast} ELSE (v_current->>'${c.name}')${cast} END`;
    }).join(',\n      ');

  const pkJsonbExpr = `jsonb_build_object('${pk}', v_result->'${pk}')`;

  // Permissions
  const createPerm = entityIR.permissions?.create?.[0]
    ? compilePermission(name, entityIR.permissions.create[0], null, 'p_data')
    : 'TRUE';

  const updatePerm = entityIR.permissions?.update?.[0]
    ? compilePermission(name, entityIR.permissions.update[0], null, 'v_current')
    : 'TRUE';

  const onCreateRules = entityIR.graphRules?.onCreate
    ? compileGraphRules(name, 'create', entityIR.graphRules.onCreate)
    : '';

  const onUpdateRules = entityIR.graphRules?.onUpdate
    ? compileGraphRules(name, 'update', entityIR.graphRules.onUpdate)
    : '';

  // M2M Support
  const m2m: Record<string, ManyToManyIR> = entityIR.manyToMany || {};
  const m2mVarDeclarations = generateM2MDeclarations(m2m);
  const m2mExtraction = generateM2MExtraction(m2m);
  const m2mSync = generateM2MSync(m2m, pk);
  const m2mExpansion = generateM2MExpansion(m2m, pk);

  // FK expansion
  const includes: Record<string, IncludeIR> = entityIR.includes || {};
  const fkExpansion = generateFKExpansion(includes, entityIR.columns);

  // Non-temporal columns for INSERT
  const nonTemporalCols = entityIR.columns
    .filter((c: ColumnInfo) => {
      const isSerial = c.type.toLowerCase().includes('serial');
      const isTemporal = c.name === validFrom || c.name === validTo;
      return !isSerial && !isTemporal && c.name !== refField;
    })
    .map(c => c.name).join(', ');

  return `
CREATE OR REPLACE FUNCTION dzql_v2.save_${name}(p_user_id int, p_data jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = dzql_v2, public
AS $$
DECLARE
  v_result jsonb;
  v_current jsonb;
  v_old_data jsonb;
  v_commit_id bigint;
  v_op text;
  v_ref int;
  v_notify_users int[];
${m2mVarDeclarations}
BEGIN
  v_commit_id := nextval('dzql_v2.commit_seq');
${m2mExtraction}

  -- Check if this is an update (ref exists and has a current version)
  v_ref := (p_data->>'${refField}')::int;

  IF v_ref IS NOT NULL THEN
    -- Get current version for permission check and field copy-forward
    SELECT to_jsonb(${name}.*) INTO v_current
    FROM ${name}
    WHERE ${refField} = v_ref AND ${validTo} IS NULL;
  END IF;

  IF v_current IS NOT NULL THEN
    -- UPDATE: Close current version and insert new one
    v_op := 'update';
    v_old_data := v_current;

    IF NOT (${updatePerm}) THEN
      RAISE EXCEPTION 'permission_denied';
    END IF;

    -- Close the current version
    UPDATE ${name} SET ${validTo} = now()
    WHERE ${refField} = v_ref AND ${validTo} IS NULL;

    -- Insert new version with copy-forward of unchanged fields
    INSERT INTO ${name} (${refField}, ${validFrom}, ${nonTemporalCols})
    SELECT
      v_ref,
      now(),
      ${copyForwardFields}
    RETURNING to_jsonb(${name}.*) INTO v_result;

    ${onUpdateRules}

  ELSE
    -- INSERT: Create new entity (sequence assigns ref)
    v_op := 'insert';

    IF NOT (${createPerm}) THEN
      RAISE EXCEPTION 'permission_denied';
    END IF;

    INSERT INTO ${name} (${colList})
    VALUES (${valList})
    RETURNING to_jsonb(${name}.*) INTO v_result;

    ${onCreateRules}
  END IF;
${m2mSync}
${m2mExpansion}
${fkExpansion}

  -- Resolve notification recipients
  v_notify_users := dzql_v2.${name}_notify_users(p_user_id, v_result);

  -- Emit Event
  INSERT INTO dzql_v2.events (commit_id, table_name, op, pk, data, old_data, user_id, affected_keys, notify_users)
  VALUES (
    v_commit_id,
    '${name}',
    v_op,
    ${pkJsonbExpr},
    v_result,
    v_old_data,
    p_user_id,
    dzql_v2.compute_affected_keys('${name}', v_op, v_result),
    v_notify_users
  );

  PERFORM pg_notify('dzql_v2', json_build_object('commit_id', v_commit_id)::text);

  RETURN ${hidden.length > 0 ? `v_result - ARRAY[${hidden.map(f => `'${f}'`).join(', ')}]` : 'v_result'};
END;
$$;
`;
}
