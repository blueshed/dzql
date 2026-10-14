import { compileRuleList } from "../../compiler/permissions.js";
import type { EntityIR } from "./types.js";

/**
 * Generate Lookup Function
 * Returns a set of { label: text, value: any } for autocomplete.
 * Uses the entity's 'label' configuration for the display text.
 */
export function generateLookupFunction(name: string, entityIR: EntityIR): string {
  const pk = entityIR.primaryKey[0] || 'id';
  const labelField = entityIR.labelField || pk;
  const searchable = entityIR.searchable || [labelField];
  const softDelete = entityIR.softDelete || false;
  const temporal = entityIR.temporal;

  // The query reads FROM ${name} t, so the rule is compiled against alias t.
  // An empty view list denies everyone.
  const viewPerm = compileRuleList(name, entityIR.permissions?.view, { kind: 'row', name: 't' });

  const softDeleteFilter = softDelete ? ' AND deleted_at IS NULL' : '';
  const temporalFilter = temporal ? ` AND ${temporal.validTo} IS NULL` : '';

  // Build ILIKE conditions for searchable fields
  const searchConditions = searchable
    .map((field: string) => `t.${field}::TEXT ILIKE $2`)
    .join(' OR ');

  return `
CREATE OR REPLACE FUNCTION dzql_v2.lookup_${name}(p_user_id int, p_query jsonb)
RETURNS SETOF jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = dzql_v2, public
AS $$
DECLARE
  v_q text;
  v_limit int;
BEGIN
  v_q := COALESCE(p_query->>'q', '');
  v_limit := COALESCE((p_query->>'limit')::int, 20);

  IF v_q = '' THEN
    RETURN QUERY
    SELECT jsonb_build_object('label', t.${labelField}, 'value', t.${pk})
    FROM ${name} t
    WHERE (${viewPerm})${softDeleteFilter}${temporalFilter}
    ORDER BY t.${labelField} ASC
    LIMIT v_limit;
  ELSE
    RETURN QUERY
    SELECT jsonb_build_object('label', t.${labelField}, 'value', t.${pk})
    FROM ${name} t
    WHERE (${viewPerm})${softDeleteFilter}${temporalFilter}
      AND (${searchConditions.replace(/\$2/g, "LOWER('%' || v_q || '%')")})
    ORDER BY t.${labelField} ASC
    LIMIT v_limit;
  END IF;
END;
$$;
`;
}
