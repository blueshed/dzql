/**
 * Path Expression Parser and Compiler
 *
 * Shared module for parsing permission and notification path expressions.
 * Provides unified path parsing with different output modes:
 * - EXISTS: For permission checks (returns boolean)
 * - SELECT: For notification resolution (returns user_id array)
 */

export interface PathHop {
  type: 'field' | 'table' | 'final';
  table?: string;
  field?: string;
  filter?: { field: string; value: string };  // e.g., org_id=$
  conditions?: ConditionPart[];               // e.g., {active} or {role=admin}
  outputField?: string;                       // The .field at the end
}

export interface ConditionPart {
  type: 'boolean' | 'equality' | 'temporal';
  field: string;
  value?: string;
}

export interface ParsedPath {
  hops: PathHop[];
  startField?: string;      // For @field patterns
  tableFirst?: boolean;     // For table[filter].field patterns
  isValid: boolean;
  error?: string;
}

/**
 * Parse a path expression into structured hops
 */
export function parsePath(path: string): ParsedPath {
  path = path.trim();

  // Literal TRUE/FALSE
  if (path === 'TRUE' || path === 'true') {
    return { hops: [], isValid: true };
  }
  if (path === 'FALSE' || path === 'false') {
    return { hops: [], isValid: true };
  }

  // Simple field reference: @author_id
  if (path.match(/^@[a-zA-Z0-9_]+$/) && !path.includes('->')) {
    return {
      hops: [{ type: 'field', field: path.slice(1) }],
      startField: path.slice(1),
      isValid: true
    };
  }

  // Explicit comparison: @field == @user_id
  const comparisonMatch = path.match(/^@([a-zA-Z0-9_]+)\s*==\s*@user_id$/);
  if (comparisonMatch) {
    return {
      hops: [{ type: 'field', field: comparisonMatch[1] }],
      startField: comparisonMatch[1],
      isValid: true
    };
  }

  // Traversal paths (with ->)
  if (path.includes('->')) {
    return parseTraversalPath(path);
  }

  // Table-first without traversal (edge case)
  const tableFirstMatch = path.match(/^([a-zA-Z0-9_]+)\[([^\]]+)\]/);
  if (tableFirstMatch) {
    return parseTableFirstPath(path);
  }

  return {
    hops: [],
    isValid: false,
    error: `Unrecognized path format: ${path}`
  };
}

/**
 * Parse a traversal path with -> operators
 */
function parseTraversalPath(path: string): ParsedPath {
  const rawHops = path.split('->');
  const hops: PathHop[] = [];

  if (rawHops.length < 2) {
    return { hops: [], isValid: false, error: 'Traversal path must have at least 2 hops' };
  }

  const firstHop = rawHops[0];
  let tableFirst = false;

  // Check if first hop is table-first pattern
  if (!firstHop.startsWith('@')) {
    tableFirst = true;
    const parsed = parseTableFirstHop(firstHop);
    if (!parsed) {
      return { hops: [], isValid: false, error: `Cannot parse table-first hop: ${firstHop}` };
    }
    hops.push(parsed);
  } else {
    // Field reference: @venue_id
    const field = firstHop.slice(1);
    hops.push({ type: 'field', field });
  }

  // Process intermediate hops (all but last)
  for (let i = 1; i < rawHops.length - 1; i++) {
    const hop = rawHops[i];
    const parsed = parseIntermediateHop(hop);
    if (!parsed) {
      return { hops: [], isValid: false, error: `Cannot parse intermediate hop: ${hop}` };
    }
    hops.push(parsed);
  }

  // Process final hop
  const finalHop = rawHops[rawHops.length - 1];
  const parsed = parseFinalHop(finalHop);
  if (!parsed) {
    return { hops: [], isValid: false, error: `Cannot parse final hop: ${finalHop}` };
  }
  hops.push(parsed);

  return {
    hops,
    startField: !tableFirst ? firstHop.slice(1) : undefined,
    tableFirst,
    isValid: true
  };
}

/**
 * Parse table-first pattern: contractor_rights[package_id=@package_id]{active}.contractor_org_id
 */
function parseTableFirstHop(hop: string): PathHop | null {
  const match = hop.match(/^([a-zA-Z0-9_]+)\[([^\]]+)\](\{[^}]+\})?\.([a-zA-Z0-9_]+)$/);
  if (!match) return null;

  const [, table, filterExpr, condExpr, outputField] = match;

  // Parse filter: field=@value or field=$
  const filterMatch = filterExpr.match(/([a-zA-Z0-9_]+)=(@?[a-zA-Z0-9_$]+)/);
  if (!filterMatch) return null;

  const filter = {
    field: filterMatch[1],
    value: filterMatch[2]
  };

  const conditions = condExpr ? parseConditions(condExpr) : [];

  return {
    type: 'table',
    table,
    filter,
    conditions,
    outputField
  };
}

/**
 * Parse table-first path (without traversal)
 */
function parseTableFirstPath(path: string): ParsedPath {
  const parsed = parseTableFirstHop(path);
  if (!parsed) {
    return { hops: [], isValid: false, error: `Cannot parse table-first path: ${path}` };
  }
  return {
    hops: [parsed],
    tableFirst: true,
    isValid: true
  };
}

/**
 * Parse intermediate hop: table.field
 */
function parseIntermediateHop(hop: string): PathHop | null {
  const dotMatch = hop.match(/^([a-zA-Z0-9_]+)\.([a-zA-Z0-9_]+)$/);
  if (dotMatch) {
    return {
      type: 'table',
      table: dotMatch[1],
      outputField: dotMatch[2]
    };
  }

  // Just table name - use id
  if (hop.match(/^[a-zA-Z0-9_]+$/)) {
    return {
      type: 'table',
      table: hop,
      outputField: 'id'
    };
  }

  return null;
}

/**
 * Parse final hop: table[filter=$]{conditions}.user_id
 */
function parseFinalHop(hop: string): PathHop | null {
  // Full pattern: acts_for[org_id=$]{active,role=admin}.user_id
  const fullMatch = hop.match(/^([a-zA-Z0-9_]+)(?:\[([^\]]+)\])?(?:\{([^}]+)\})?\.([a-zA-Z0-9_]+)$/);
  if (!fullMatch) return null;

  const [, table, filterExpr, condExpr, outputField] = fullMatch;

  let filter: { field: string; value: string } | undefined;
  if (filterExpr) {
    const filterMatch = filterExpr.match(/([a-zA-Z0-9_]+)=(\$|@?[a-zA-Z0-9_]+)/);
    if (filterMatch) {
      filter = {
        field: filterMatch[1],
        value: filterMatch[2]
      };
    }
  }

  const conditions = condExpr ? parseConditions(condExpr) : [];

  return {
    type: 'final',
    table,
    filter,
    conditions,
    outputField
  };
}

/**
 * Parse condition expression: {active} or {active,role=admin} or {valid_from<=now(),valid_to=NULL}
 */
function parseConditions(condExpr: string): ConditionPart[] {
  const inner = condExpr.replace(/[{}]/g, '');
  const parts = inner.split(',').map(p => p.trim());
  const conditions: ConditionPart[] = [];

  for (const part of parts) {
    // Boolean field: {active}
    if (part.match(/^[a-zA-Z0-9_]+$/)) {
      conditions.push({ type: 'boolean', field: part });
      continue;
    }

    // Equality: {role=admin} or {role='admin'}
    const eqMatch = part.match(/^([a-zA-Z0-9_]+)=(.+)$/);
    if (eqMatch) {
      const field = eqMatch[1];
      let value = eqMatch[2];

      // Special case: NULL
      if (value.toUpperCase() === 'NULL') {
        conditions.push({ type: 'equality', field, value: 'NULL' });
      } else {
        // Remove quotes if present
        if (value.startsWith("'") && value.endsWith("'")) {
          value = value.slice(1, -1);
        }
        conditions.push({ type: 'equality', field, value });
      }
      continue;
    }

    // Temporal: {valid_from<=now()} - treat as raw expression
    conditions.push({ type: 'temporal', field: part });
  }

  return conditions;
}

/**
 * Compile a parsed path to SQL for permission checks (EXISTS)
 */
export function compilePathToExists(
  parsed: ParsedPath,
  dataVar: string = 'p_data',
  userVar: string = 'p_user_id'
): string {
  if (!parsed.isValid) {
    console.warn(`[Compiler] Invalid path: ${parsed.error}`);
    return 'FALSE';
  }

  if (parsed.hops.length === 0) {
    // TRUE/FALSE literal was parsed
    return 'FALSE';
  }

  const isJsonb = dataVar.startsWith('p_') || dataVar.startsWith('v_');
  const fieldAccess = (field: string) =>
    isJsonb ? `(${dataVar}->>'${field}')::int` : `${dataVar}.${field}`;

  // Simple field reference
  if (parsed.hops.length === 1 && parsed.hops[0].type === 'field') {
    const field = parsed.hops[0].field!;
    return `${fieldAccess(field)} = ${userVar}`;
  }

  // Build value expression through the hops
  let valueExpr: string;

  // Handle table-first vs field-first
  if (parsed.tableFirst) {
    const firstHop = parsed.hops[0];
    valueExpr = buildTableLookup(firstHop, dataVar, isJsonb);
  } else {
    valueExpr = fieldAccess(parsed.startField!);
  }

  // Process intermediate hops
  const startIdx = parsed.tableFirst ? 1 : 1;
  for (let i = startIdx; i < parsed.hops.length - 1; i++) {
    const hop = parsed.hops[i];
    valueExpr = `(SELECT ${hop.outputField} FROM ${hop.table} WHERE id = ${valueExpr})`;
  }

  // Final hop - build EXISTS check
  const finalHop = parsed.hops[parsed.hops.length - 1];
  return buildExistsCheck(finalHop, valueExpr, userVar);
}

/**
 * Compile a parsed path to SQL for notification resolution (SELECT user_ids)
 */
export function compilePathToSelect(
  parsed: ParsedPath,
  dataVar: string = 'p_data'
): string {
  if (!parsed.isValid) {
    console.warn(`[Notification] Invalid path: ${parsed.error}`);
    return `SELECT NULL::int WHERE FALSE`;
  }

  if (parsed.hops.length === 0) {
    return `SELECT NULL::int WHERE FALSE`;
  }

  const isJsonb = dataVar.startsWith('p_') || dataVar.startsWith('v_');
  const fieldAccess = (field: string) =>
    isJsonb ? `(${dataVar}->>'${field}')::int` : `${dataVar}.${field}`;

  // Simple field reference - direct user_id
  if (parsed.hops.length === 1 && parsed.hops[0].type === 'field') {
    const field = parsed.hops[0].field!;
    return `SELECT ${fieldAccess(field)} WHERE (${dataVar}->>'${field}') IS NOT NULL`;
  }

  // Build value expression through the hops
  let valueExpr: string;

  // Handle table-first vs field-first
  if (parsed.tableFirst) {
    const firstHop = parsed.hops[0];
    valueExpr = buildTableLookup(firstHop, dataVar, isJsonb);
  } else {
    valueExpr = fieldAccess(parsed.startField!);
  }

  // Process intermediate hops
  const startIdx = parsed.tableFirst ? 1 : 1;
  for (let i = startIdx; i < parsed.hops.length - 1; i++) {
    const hop = parsed.hops[i];
    valueExpr = `(SELECT ${hop.outputField} FROM ${hop.table} WHERE id = ${valueExpr})`;
  }

  // Final hop - build SELECT for user_ids
  const finalHop = parsed.hops[parsed.hops.length - 1];
  return buildSelectUsers(finalHop, valueExpr);
}

/**
 * Build a table lookup subquery for table-first patterns
 */
function buildTableLookup(hop: PathHop, dataVar: string, isJsonb: boolean): string {
  const { table, filter, conditions, outputField } = hop;

  if (!filter || !table || !outputField) {
    return 'NULL';
  }

  // Build filter value
  let filterValue: string;
  if (filter.value === '$') {
    // $ is not valid for first hop - use the field name
    filterValue = 'NULL';
  } else if (filter.value.startsWith('@')) {
    const refField = filter.value.slice(1);
    filterValue = isJsonb ? `(${dataVar}->>'${refField}')::int` : `${dataVar}.${refField}`;
  } else {
    filterValue = filter.value;
  }

  // Build conditions
  const condClauses: string[] = [`${table}.${filter.field} = ${filterValue}`];

  for (const cond of conditions || []) {
    condClauses.push(buildConditionClause(table, cond));
  }

  return `(SELECT ${outputField} FROM ${table} WHERE ${condClauses.join(' AND ')})`;
}

/**
 * Build condition clause for a table
 */
function buildConditionClause(table: string, cond: ConditionPart): string {
  switch (cond.type) {
    case 'boolean':
      return `${table}.${cond.field} = true`;
    case 'equality':
      if (cond.value === 'NULL') {
        return `${table}.${cond.field} IS NULL`;
      }
      // Quote string values, leave numbers as-is
      const value = cond.value!.match(/^\d+$/) ? cond.value : `'${cond.value}'`;
      return `${table}.${cond.field} = ${value}`;
    case 'temporal':
      // Raw expression
      return `${table}.${cond.field}`;
    default:
      return 'TRUE';
  }
}

/**
 * Build EXISTS check for permission verification
 */
function buildExistsCheck(hop: PathHop, valueExpr: string, userVar: string): string {
  const { table, filter, conditions, outputField } = hop;

  if (!table) return 'FALSE';

  const condClauses: string[] = [];

  // Join condition
  if (filter) {
    if (filter.value === '$') {
      condClauses.push(`${table}.${filter.field} = ${valueExpr}`);
    } else {
      condClauses.push(`${table}.${filter.field} = ${filter.value}`);
    }
  } else {
    condClauses.push(`${table}.id = ${valueExpr}`);
  }

  // Additional conditions
  for (const cond of conditions || []) {
    condClauses.push(buildConditionClause(table, cond));
  }

  // User check
  if (outputField === 'user_id') {
    condClauses.push(`${table}.user_id = ${userVar}`);
  } else if (outputField) {
    condClauses.push(`${table}.${outputField} = ${userVar}`);
  }

  return `EXISTS (SELECT 1 FROM ${table} WHERE ${condClauses.join(' AND ')})`;
}

/**
 * Build SELECT query for notification user resolution
 */
function buildSelectUsers(hop: PathHop, valueExpr: string): string {
  const { table, filter, conditions, outputField } = hop;

  if (!table || !outputField) {
    return `SELECT NULL::int WHERE FALSE`;
  }

  const condClauses: string[] = [];

  // Join condition
  if (filter) {
    if (filter.value === '$') {
      condClauses.push(`${table}.${filter.field} = ${valueExpr}`);
    } else {
      condClauses.push(`${table}.${filter.field} = ${filter.value}`);
    }
  } else {
    condClauses.push(`${table}.id = ${valueExpr}`);
  }

  // Additional conditions
  for (const cond of conditions || []) {
    condClauses.push(buildConditionClause(table, cond));
  }

  return `SELECT ${table}.${outputField} FROM ${table} WHERE ${condClauses.join(' AND ')}`;
}

/**
 * Validate a path expression and return detailed errors
 */
export function validatePath(path: string, entityName?: string): { valid: boolean; error?: string } {
  const parsed = parsePath(path);

  if (!parsed.isValid) {
    return { valid: false, error: parsed.error };
  }

  // Additional validation could check table/column existence
  // For now just validate syntax
  return { valid: true };
}
