/**
 * Notification Path Code Generator
 * Generates PostgreSQL functions to resolve notification paths to user IDs
 */

import type { EntityIR } from "../../shared/ir.js";
import { compilePermission } from "../compiler/permissions.js";

/**
 * Generate notification resolution function for an entity
 * Returns a function that resolves notification paths to an array of user IDs
 */
export function generateNotificationFunction(name: string, entityIR: EntityIR): string {
  const notifications = entityIR.notifications || {};
  const pathNames = Object.keys(notifications);

  if (pathNames.length === 0) {
    // No notifications - return empty function
    return `
-- Notification resolution for ${name} (no paths configured)
CREATE OR REPLACE FUNCTION dzql_v2.${name}_notify_users(
  p_user_id INT,
  p_data JSONB
) RETURNS INT[]
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = dzql_v2, public
AS $$
BEGIN
  RETURN ARRAY[]::INT[];
END;
$$;`;
  }

  // Generate SQL for each notification path
  const pathQueries: string[] = [];

  for (const [pathName, paths] of Object.entries(notifications)) {
    if (!paths || !Array.isArray(paths)) continue;

    for (const path of paths) {
      // Use the same permission compiler - it generates EXISTS subqueries
      // but we need SELECT user_id instead
      const userQuery = compileNotificationPath(name, path);
      if (userQuery) {
        pathQueries.push(`  -- ${pathName}: ${path}
  v_users := v_users || ARRAY(${userQuery});`);
      }
    }
  }

  const pathSQL = pathQueries.length > 0
    ? pathQueries.join('\n\n')
    : '  -- No valid notification paths';

  return `
-- Notification resolution for ${name}
CREATE OR REPLACE FUNCTION dzql_v2.${name}_notify_users(
  p_user_id INT,
  p_data JSONB
) RETURNS INT[]
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = dzql_v2, public
AS $$
DECLARE
  v_users INT[] := ARRAY[]::INT[];
BEGIN
${pathSQL}

  -- Return unique user IDs (excluding the acting user to avoid self-notification)
  RETURN ARRAY(SELECT DISTINCT unnest(v_users) WHERE unnest != p_user_id);
END;
$$;`;
}

/**
 * Compile a notification path to a SELECT query returning user IDs
 *
 * Path formats:
 * - @field_id                          -> Direct field reference (must be user_id)
 * - @field->table[filter]{temporal}.user_id -> Traverse to get user_id
 */
function compileNotificationPath(entityName: string, path: string): string | null {
  path = path.trim();

  // Direct field reference: @author_id (field must contain user_id)
  if (path.match(/^@\w+$/) && !path.includes('->')) {
    const field = path.slice(1);
    return `SELECT (p_data->>'${field}')::int WHERE (p_data->>'${field}') IS NOT NULL`;
  }

  // Traversal path: @org_id->acts_for[org_id=$]{active}.user_id
  const traversalMatch = path.match(/^@(\w+)->(.+)\.(\w+)$/);
  if (traversalMatch) {
    const [, startField, middle, endField] = traversalMatch;
    return compileTraversalPath(startField, middle, endField);
  }

  // Multi-hop: @venue_id->venues.org_id->acts_for[org_id=$]{active}.user_id
  const multiHopMatch = path.match(/^@(\w+)->(.+)\.(\w+)->(.+)\.(\w+)$/);
  if (multiHopMatch) {
    const [, field1, table1, field2, rest, endField] = multiHopMatch;
    return compileMultiHopPath(field1, table1, field2, rest, endField);
  }

  // Table-first: table[filter]{temporal}.field->...
  if (!path.startsWith('@')) {
    return compileTableFirstPath(path);
  }

  console.warn(`[Notification] Unsupported path format: ${path}`);
  return null;
}

/**
 * Compile single-hop traversal: @org_id->acts_for[org_id=$]{active}.user_id
 */
function compileTraversalPath(startField: string, middle: string, endField: string): string {
  // Parse: acts_for[org_id=$]{active}
  const tableMatch = middle.match(/^(\w+)(?:\[([^\]]+)\])?(?:\{([^}]+)\})?$/);
  if (!tableMatch) {
    console.warn(`[Notification] Cannot parse traversal: ${middle}`);
    return `SELECT NULL::int WHERE FALSE`;
  }

  const [, table, filterStr, temporalField] = tableMatch;
  const conditions: string[] = [];

  // Parse filters: org_id=$
  if (filterStr) {
    const filters = filterStr.split(',').map(f => f.trim());
    for (const filter of filters) {
      const [field, value] = filter.split('=').map(s => s.trim());
      if (value === '$') {
        // $ means "use the start field value"
        conditions.push(`${table}.${field} = (p_data->>'${startField}')::int`);
      } else if (value.startsWith('@')) {
        conditions.push(`${table}.${field} = (p_data->>'${value.slice(1)}')::int`);
      } else {
        conditions.push(`${table}.${field} = ${value}`);
      }
    }
  } else {
    // Default: join on start field
    conditions.push(`${table}.id = (p_data->>'${startField}')::int`);
  }

  // Temporal filter: {active} means active = true AND valid_to IS NULL
  if (temporalField) {
    conditions.push(`${table}.${temporalField} = true`);
    conditions.push(`${table}.valid_to IS NULL`);
  }

  const whereClause = conditions.join(' AND ');

  return `SELECT ${table}.${endField} FROM ${table} WHERE ${whereClause}`;
}

/**
 * Compile multi-hop path: @venue_id->venues.org_id->acts_for[org_id=$]{active}.user_id
 */
function compileMultiHopPath(
  field1: string,
  table1: string,
  field2: string,
  rest: string,
  endField: string
): string {
  // First hop: get field2 from table1
  const subquery1 = `(SELECT ${field2} FROM ${table1} WHERE id = (p_data->>'${field1}')::int)`;

  // Parse second hop: acts_for[org_id=$]{active}
  const tableMatch = rest.match(/^(\w+)(?:\[([^\]]+)\])?(?:\{([^}]+)\})?$/);
  if (!tableMatch) {
    console.warn(`[Notification] Cannot parse second hop: ${rest}`);
    return `SELECT NULL::int WHERE FALSE`;
  }

  const [, table2, filterStr, temporalField] = tableMatch;
  const conditions: string[] = [];

  // Parse filters
  if (filterStr) {
    const filters = filterStr.split(',').map(f => f.trim());
    for (const filter of filters) {
      const [field, value] = filter.split('=').map(s => s.trim());
      if (value === '$') {
        // $ in second hop means "use the result of first hop"
        conditions.push(`${table2}.${field} = ${subquery1}`);
      } else if (value.startsWith('@')) {
        conditions.push(`${table2}.${field} = (p_data->>'${value.slice(1)}')::int`);
      } else {
        conditions.push(`${table2}.${field} = ${value}`);
      }
    }
  }

  // Temporal filter
  if (temporalField) {
    conditions.push(`${table2}.${temporalField} = true`);
    conditions.push(`${table2}.valid_to IS NULL`);
  }

  const whereClause = conditions.join(' AND ');

  return `SELECT ${table2}.${endField} FROM ${table2} WHERE ${whereClause}`;
}

/**
 * Compile table-first path: contractor_rights[package_id=@package_id]{active}.contractor_org_id->...
 */
function compileTableFirstPath(path: string): string {
  // This is complex - for now return null and log warning
  console.warn(`[Notification] Table-first paths not yet supported: ${path}`);
  return `SELECT NULL::int WHERE FALSE`;
}
