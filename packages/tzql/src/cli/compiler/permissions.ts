/**
 * Compiles a permission rule into SQL.
 *
 * Supported formats:
 * - Simple field check: @author_id (implies author_id == user_id)
 * - Explicit comparison: @field == @user_id
 * - Single-hop traversal: @org_id->acts_for[org_id=$]{active}.user_id
 * - Multi-hop traversal: @venue_id->venues.org_id->acts_for[org_id=$]{active}.user_id
 * - Deep traversal: @site_id->sites.venue_id->venues.org_id->acts_for[org_id=$]{active}.user_id
 *
 * @param entityName - The entity name
 * @param rule - The permission rule string
 * @param context - Optional context (unused)
 * @param dataVar - Either a JSONB variable name (e.g., 'p_data') or a table name (e.g., 'packages')
 *                  When it's a table name, we use table.column syntax instead of jsonb->>'column'
 */
export function compilePermission(entityName: string, rule: string, context: any, dataVar: string = 'p_data'): string {
  // Determine if dataVar is a JSONB variable or a table name
  // JSONB variables typically start with p_ or v_ (e.g., p_data, v_old_data)
  const isJsonb = dataVar.startsWith('p_') || dataVar.startsWith('v_');

  // Helper to access a field value
  const fieldAccess = (field: string) => {
    if (isJsonb) {
      return `(${dataVar}->>'${field}')::int`;
    } else {
      return `${dataVar}.${field}`;
    }
  };

  // Case 1: Simple Field Check (@author_id)
  // Implies: author_id == user_id
  if (rule.match(/^@[a-zA-Z0-9_]+$/)) {
    const field = rule.substring(1);
    return `${fieldAccess(field)} = p_user_id`;
  }

  // Case 1b: Explicit Comparison (@field == @user_id)
  const comparisonMatch = rule.match(/^@([a-zA-Z0-9_]+)\s*==\s*@user_id$/);
  if (comparisonMatch) {
      const field = comparisonMatch[1];
      return `${fieldAccess(field)} = p_user_id`;
  }

  // Case 2: Graph Traversal (supports unlimited depth)
  // Format: @local_field->table.field->table[filter=$]{condition}.user_id
  if (rule.includes('->')) {
    return compileTraversalPath(rule, dataVar, isJsonb);
  }

  // Case 3: Table-first lookup (e.g., contractor_rights[package_id=@package_id]{active}.field->...)
  // This pattern starts with a table reference and filter, not a field reference
  const tableFirstMatch = rule.match(/^([a-zA-Z0-9_]+)\[([^\]]+)\]/);
  if (tableFirstMatch) {
    // This is a complex pattern that needs special handling
    // For now, return FALSE and log a warning
    console.warn(`[Compiler] Warning: Table-first permission path '${rule}' not fully supported yet.`);
    return 'FALSE';
  }

  return 'FALSE'; // Default deny
}

/**
 * Compiles a multi-hop traversal path into SQL with nested subqueries.
 *
 * Example: @venue_id->venues.org_id->acts_for[org_id=$]{active}.user_id
 *
 * Algorithm:
 * 1. Split on '->' to get hops
 * 2. First hop is the source field from the record
 * 3. Intermediate hops traverse through tables via FK lookups
 * 4. Final hop is an EXISTS check with conditions
 */
function compileTraversalPath(rule: string, dataVar: string, isJsonb: boolean): string {
  const hops = rule.split('->');

  if (hops.length < 2) {
    return 'FALSE';
  }

  const firstHop = hops[0];

  // Check if this is a table-first pattern (doesn't start with @)
  // e.g., contractor_rights[package_id=@package_id]{active}.contractor_org_id
  if (!firstHop.startsWith('@')) {
    // This is a complex pattern: table[filter].field -> ...
    // Parse the first hop to get the table, filter, and field
    const tableFirstMatch = firstHop.match(/^([a-zA-Z0-9_]+)\[([^\]]+)\](\{[^}]+\})?\.([a-zA-Z0-9_]+)$/);
    if (tableFirstMatch) {
      const [_, lookupTable, filterExpr, condExpr, outputField] = tableFirstMatch;

      // Parse the filter: package_id=@package_id
      const filterMatch = filterExpr.match(/([a-zA-Z0-9_]+)=@([a-zA-Z0-9_]+)/);
      if (!filterMatch) {
        console.warn(`[Compiler] Warning: Cannot parse filter '${filterExpr}' in permission path.`);
        return 'FALSE';
      }
      const [__, filterField, sourceRefField] = filterMatch;

      // Get the source field value
      const sourceValue = isJsonb
        ? `(${dataVar}->>'${sourceRefField}')::int`
        : `${dataVar}.${sourceRefField}`;

      // Parse condition like {active}
      let conditionClause = '';
      if (condExpr) {
        const cond = condExpr.replace(/[{}]/g, '');
        if (cond.match(/^[a-zA-Z0-9_]+$/)) {
          conditionClause = ` AND ${lookupTable}.${cond} = true`;
        } else {
          conditionClause = ` AND ${lookupTable}.${cond}`;
        }
      }

      // Build subquery to get the output field from the lookup table
      let valueExpr = `(SELECT ${outputField} FROM ${lookupTable} WHERE ${lookupTable}.${filterField} = ${sourceValue}${conditionClause})`;

      // Now process remaining hops (all but the last, which is the EXISTS check)
      for (let i = 1; i < hops.length - 1; i++) {
        const hop = hops[i];
        const dotMatch = hop.match(/^([a-zA-Z0-9_]+)\.([a-zA-Z0-9_]+)$/);
        if (dotMatch) {
          const table = dotMatch[1];
          const field = dotMatch[2];
          valueExpr = `(SELECT ${field} FROM ${table} WHERE id = ${valueExpr})`;
        }
      }

      // Final hop: EXISTS check
      return buildFinalExistsCheck(hops[hops.length - 1], valueExpr);
    }

    // Unrecognized pattern
    console.warn(`[Compiler] Warning: Unrecognized table-first pattern '${firstHop}'. Returning FALSE.`);
    return 'FALSE';
  }

  // First hop: source field from record (e.g., @venue_id -> venue_id)
  const sourceField = firstHop.replace(/^@/, '');

  // Start building the value expression
  let valueExpr = isJsonb
    ? `(${dataVar}->>'${sourceField}')::int`
    : `${dataVar}.${sourceField}`;

  // Process intermediate hops (all but the last)
  for (let i = 1; i < hops.length - 1; i++) {
    const hop = hops[i];

    // Parse table.field format (e.g., venues.org_id)
    const dotMatch = hop.match(/^([a-zA-Z0-9_]+)\.([a-zA-Z0-9_]+)$/);
    if (dotMatch) {
      const table = dotMatch[1];
      const field = dotMatch[2];
      // Wrap in subquery: (SELECT field FROM table WHERE id = previousValue)
      valueExpr = `(SELECT ${field} FROM ${table} WHERE id = ${valueExpr})`;
    } else {
      // Just a table name - assume we're looking up by id and continuing with id
      const table = hop.replace(/\[.*\]/, '').replace(/\{.*\}/, '').replace(/\..*$/, '');
      valueExpr = `(SELECT id FROM ${table} WHERE id = ${valueExpr})`;
    }
  }

  // Final hop: EXISTS check with the target table
  return buildFinalExistsCheck(hops[hops.length - 1], valueExpr);
}

/**
 * Builds the final EXISTS check for a permission path.
 *
 * @param finalHop - The final hop string (e.g., "acts_for[org_id=$]{active}.user_id")
 * @param valueExpr - The SQL expression for the value to join on
 */
function buildFinalExistsCheck(finalHop: string, valueExpr: string): string {
  // Parse final hop components
  // Format: table[filter=$]{condition}.user_id
  const tableMatch = finalHop.match(/^([a-zA-Z0-9_]+)/);
  if (!tableMatch) return 'FALSE';
  const targetTable = tableMatch[1];

  // Extract filter: [org_id=$]
  const filterMatch = finalHop.match(/\[([a-zA-Z0-9_]+)=\$\]/);
  const joinField = filterMatch ? filterMatch[1] : null;

  // Extract condition: {active} or {role='admin'}
  const condMatch = finalHop.match(/\{([^}]+)\}/);
  const condition = condMatch ? condMatch[1] : null;

  // Extract target field: .user_id
  const targetFieldMatch = finalHop.match(/\.([a-zA-Z0-9_]+)$/);
  const targetField = targetFieldMatch ? targetFieldMatch[1] : null;

  // Build EXISTS query
  const conditions: string[] = [];

  // Join condition
  if (joinField) {
    conditions.push(`${targetTable}.${joinField} = ${valueExpr}`);
  } else {
    // Implicit join by id
    conditions.push(`${targetTable}.id = ${valueExpr}`);
  }

  // Temporal/active condition
  if (condition) {
    // Handle simple boolean condition like {active}
    if (condition.match(/^[a-zA-Z0-9_]+$/)) {
      conditions.push(`${targetTable}.${condition} = true`);
    } else {
      // Handle complex condition like {role='admin'}
      conditions.push(`${targetTable}.${condition}`);
    }
  }

  // User check (final target field)
  if (targetField === 'user_id') {
    conditions.push(`${targetTable}.user_id = p_user_id`);
  } else if (targetField) {
    conditions.push(`${targetTable}.${targetField} = p_user_id`);
  }

  const whereClause = conditions.join(' AND ');

  return `EXISTS (SELECT 1 FROM ${targetTable} WHERE ${whereClause})`;
}