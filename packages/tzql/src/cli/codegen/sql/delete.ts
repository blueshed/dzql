import { compilePermission } from "../../compiler/permissions.js";
import { compileGraphRules } from "../../compiler/graph_rules.js";
import type { EntityIR, ColumnInfo } from "./types.js";

// === DELETE FUNCTION (Cascade or Soft Delete) ===
export function generateDeleteFunction(name: string, entityIR: EntityIR): string {
  const pkFields = entityIR.primaryKey.length > 0 ? entityIR.primaryKey : ['id'];
  const pk = pkFields[0];
  const softDelete = entityIR.softDelete || false;
  const hidden = entityIR.hidden || [];
  const temporal = entityIR.temporal;

  // For temporal entities WITH refField, generate versioned delete function
  if (temporal?.refField) {
    return generateTemporalDeleteFunction(name, entityIR);
  }

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

  // Build PK JSONB object for events
  const pkJsonbExpr = pkFields.length === 1
    ? `jsonb_build_object('${pk}', v_old_data->'${pk}')`
    : `jsonb_build_object(${pkFields.map(f => `'${f}', v_old_data->'${f}'`).join(', ')})`;

  // Permissions
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

  -- Emit Event with pre-computed affected keys and notify users
  INSERT INTO dzql_v2.events (commit_id, table_name, op, pk, data, old_data, user_id, affected_keys, notify_users)
  VALUES (
    v_commit_id,
    '${name}',
    'delete',
    ${pkJsonbExpr},
    v_old_data,
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

// === TEMPORAL DELETE FUNCTION ===
function generateTemporalDeleteFunction(name: string, entityIR: EntityIR): string {
  const pkFields = entityIR.primaryKey.length > 0 ? entityIR.primaryKey : ['id'];
  const pk = pkFields[0];
  const hidden = entityIR.hidden || [];
  const temporal = entityIR.temporal!;

  const refField = temporal.refField;
  const validTo = temporal.validTo;

  const pkJsonbExpr = `jsonb_build_object('${pk}', v_old_data->'${pk}')`;

  const deletePerm = entityIR.permissions?.delete?.[0]
    ? compilePermission(name, entityIR.permissions.delete[0], null, 'v_old_data')
    : 'TRUE';

  const onDeleteRules = entityIR.graphRules?.onDelete
    ? compileGraphRules(name, 'delete', entityIR.graphRules.onDelete)
    : '';

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
  v_ref int;
  v_notify_users int[];
BEGIN
  v_commit_id := nextval('dzql_v2.commit_seq');

  -- For temporal entities, p_pk should contain ref (not id)
  v_ref := (p_pk->>'${refField}')::int;

  IF v_ref IS NULL THEN
    -- Fall back to id lookup if ref not provided
    SELECT to_jsonb(${name}.*) INTO v_old_data
    FROM ${name}
    WHERE ${pk} = (p_pk->>'${pk}')::int;
  ELSE
    -- Get current version by ref
    SELECT to_jsonb(${name}.*) INTO v_old_data
    FROM ${name}
    WHERE ${refField} = v_ref AND ${validTo} IS NULL;
  END IF;

  IF v_old_data IS NULL THEN
    RAISE EXCEPTION 'not_found';
  END IF;

  -- Permission Check
  IF NOT (${deletePerm}) THEN
    RAISE EXCEPTION 'permission_denied';
  END IF;

  -- Graph Rules
  ${onDeleteRules}

  -- Temporal Delete: Close the current version
  UPDATE ${name} SET ${validTo} = now()
  WHERE ${refField} = (v_old_data->>'${refField}')::int AND ${validTo} IS NULL;

  -- Resolve notification recipients
  v_notify_users := dzql_v2.${name}_notify_users(p_user_id, v_old_data);

  -- Emit Event
  INSERT INTO dzql_v2.events (commit_id, table_name, op, pk, data, old_data, user_id, affected_keys, notify_users)
  VALUES (
    v_commit_id,
    '${name}',
    'delete',
    ${pkJsonbExpr},
    v_old_data,
    v_old_data,
    p_user_id,
    dzql_v2.compute_affected_keys('${name}', 'delete', v_old_data),
    v_notify_users
  );

  PERFORM pg_notify('dzql_v2', json_build_object('commit_id', v_commit_id)::text);

  RETURN ${hidden.length > 0 ? `v_old_data - ARRAY[${hidden.map(f => `'${f}'`).join(', ')}]` : 'v_old_data'};
END;
$$;
`;
}
