/**
 * Path Expression Parser and Compiler
 *
 * Shared by permission checks, subscribe checks and notification resolution, so a
 * rule means the same thing wherever it is written. Output modes:
 * - EXISTS: for permission checks (returns boolean)
 * - SELECT: for notification resolution (returns user ids)
 *
 * Grammar:
 *   rule   := TRUE | FALSE | AUTHENTICATED | @field | @field == @user_id | chain
 *   chain  := start ('->' hop)+
 *   start  := @field | table '[' filters ']' conds? '.' field     (table-first)
 *   hop    := table ('[' filters ']')? conds? ('.' field)?
 *   filters:= field '=' value (',' field '=' value)*
 *   conds  := '{' cond (',' cond)* '}'
 *
 * Each hop after the start joins on the previous value: on its `$` filter if it
 * has brackets, otherwise on its id. A hop's `.field` is the value passed on;
 * the last hop's `.field` is compared with the user. Every hop compiles to a
 * nested EXISTS, so a hop that matches several rows (occasion_promoters for an
 * occasion) is followed correctly.
 *
 * A path that can't be compiled throws PathCompileError. There is no fallback.
 */

export class PathCompileError extends Error {
  constructor(message: string, public path?: string) {
    super(path !== undefined ? `${message} in path '${path}'` : message);
    this.name = 'PathCompileError';
  }
}

export interface FilterPart {
  field: string;
  value: string;   // '$', '@field', or a literal as written
}

export interface PathHop {
  type: 'field' | 'table' | 'final';
  table?: string;
  field?: string;
  filter?: FilterPart;                        // the join filter ($), or the first filter
  filters?: FilterPart[];                     // every filter inside [ ]
  conditions?: ConditionPart[];               // e.g., {active} or {role=admin}
  outputField?: string;                       // The .field at the end
}

export interface ConditionPart {
  type: 'boolean' | 'equality' | 'temporal';
  field: string;
  value?: string;
  op?: string;                                // temporal comparison operator
}

export type PathLiteral = 'TRUE' | 'FALSE' | 'AUTHENTICATED';

export interface ParsedPath {
  hops: PathHop[];
  startField?: string;      // For @field patterns
  tableFirst?: boolean;     // For table[filter].field patterns
  literal?: PathLiteral;
  path?: string;
  isValid: boolean;
  error?: string;
}

/**
 * Where the row being checked comes from:
 * - jsonb: a JSONB variable such as p_data or v_old_data
 * - row: a table name or alias in scope, or a RECORD variable such as v_root.
 *   fieldMap renames fields (a subscribable's key param maps to the root's id).
 */
export type RowSource =
  | { kind: 'jsonb'; name: string }
  | { kind: 'row'; name: string; fieldMap?: Record<string, string> };

const IDENT = '[a-zA-Z_][a-zA-Z0-9_]*';
const IDENT_RE = new RegExp(`^${IDENT}$`);
const HOP_RE = new RegExp(`^(${IDENT})(?:\\[([^\\]]*)\\])?(?:\\{([^}]*)\\})?(?:\\.(${IDENT}))?$`);
const LITERAL_VALUE_RE = /^(-?\d+(\.\d+)?|'(?:[^']|'')*'|NULL|null|true|false|[a-zA-Z_][a-zA-Z0-9_]*)$/;
const TEMPORAL_RE = new RegExp(
  `^(${IDENT})\\s*(<=|>=|<>|!=|<|>)\\s*(now\\(\\)|current_date|current_timestamp|NULL|-?\\d+(?:\\.\\d+)?|'(?:[^']|'')*')$`, 'i');
const INT_TYPE_RE = /^\s*(int|integer|int2|int4|int8|smallint|bigint|serial|bigserial|smallserial)\b/i;

/** True if a schema type string is an integer key type. */
export function isIntegerType(type: string | undefined): boolean {
  return !!type && INT_TYPE_RE.test(type);
}

const invalid = (path: string, error: string): ParsedPath => ({ hops: [], isValid: false, error, path });

/** Parse a path expression into structured hops */
export function parsePath(path: string): ParsedPath {
  path = (path ?? '').trim();

  if (path === 'TRUE' || path === 'true') return { hops: [], isValid: true, literal: 'TRUE', path };
  if (path === 'FALSE' || path === 'false') return { hops: [], isValid: true, literal: 'FALSE', path };
  if (path === 'AUTHENTICATED' || path === 'authenticated') {
    return { hops: [], isValid: true, literal: 'AUTHENTICATED', path };
  }

  // Simple field reference: @author_id
  const fieldMatch = path.match(new RegExp(`^@(${IDENT})$`));
  if (fieldMatch) {
    return { hops: [{ type: 'field', field: fieldMatch[1] }], startField: fieldMatch[1], isValid: true, path };
  }

  // Explicit comparison: @field == @user_id
  const comparisonMatch = path.match(new RegExp(`^@(${IDENT})\\s*==\\s*@user_id$`));
  if (comparisonMatch) {
    return { hops: [{ type: 'field', field: comparisonMatch[1] }], startField: comparisonMatch[1], isValid: true, path };
  }

  if (path.includes('->')) {
    try {
      return parseChain(path, path.split('->'));
    } catch (e) {
      if (e instanceof PathCompileError) return invalid(path, e.message);
      throw e;
    }
  }

  // Table-first without traversal: rights[package_id=@package_id].user_id
  if (new RegExp(`^${IDENT}\\[`).test(path)) {
    try {
      return parseChain(path, [path]);
    } catch (e) {
      if (e instanceof PathCompileError) return invalid(path, e.message);
      throw e;
    }
  }

  return invalid(path, `Unrecognized path format: ${path}`);
}

function parseChain(path: string, segments: string[]): ParsedPath {
  const raw = segments.map(s => s.trim());
  if (raw.some(s => s === '')) {
    throw new PathCompileError(`Empty hop`);
  }

  const hops: PathHop[] = [];
  let tableFirst = false;
  let startField: string | undefined;

  if (raw[0].startsWith('@')) {
    if (raw.length < 2) throw new PathCompileError(`A traversal needs at least one hop after ${raw[0]}`);
    startField = raw[0].slice(1);
    if (!IDENT_RE.test(startField)) throw new PathCompileError(`Cannot parse start '${raw[0]}'`);
    hops.push({ type: 'field', field: startField });
  } else {
    tableFirst = true;
    const first = parseHop(raw[0], raw.length === 1 ? 'final' : 'table');
    if (!first.filters?.length || !first.outputField) {
      throw new PathCompileError(`A table-first hop needs [filters] and a .field: '${raw[0]}'`);
    }
    if (first.filters.some(f => f.value === '$')) {
      throw new PathCompileError(`$ has nothing to join to in the first hop '${raw[0]}'`);
    }
    hops.push(first);
  }

  for (let i = 1; i < raw.length; i++) {
    const isFinal = i === raw.length - 1;
    const hop = parseHop(raw[i], isFinal ? 'final' : 'table');
    if (hop.filters && hop.filters.length > 0) {
      const joins = hop.filters.filter(f => f.value === '$');
      if (joins.length === 0) {
        throw new PathCompileError(`Hop '${raw[i]}' has [filters] so it must join on $`);
      }
      if (joins.length > 1) {
        throw new PathCompileError(`Hop '${raw[i]}' has more than one $`);
      }
    }
    hops.push(hop);
  }

  return { hops, startField, tableFirst, isValid: true, path };
}

function parseHop(text: string, type: 'table' | 'final'): PathHop {
  const m = text.match(HOP_RE);
  if (!m) throw new PathCompileError(`Cannot parse hop '${text}'`);
  const [, table, filterExpr, condExpr, outputField] = m;

  if (type === 'final' && !outputField) {
    throw new PathCompileError(`The final hop '${text}' needs a .field to compare with the user`);
  }
  if (type === 'table' && !outputField && (filterExpr !== undefined || condExpr !== undefined)) {
    throw new PathCompileError(`Hop '${text}' needs a .field to pass on`);
  }

  const filters = filterExpr !== undefined ? parseFilters(filterExpr) : undefined;
  const conditions = condExpr !== undefined ? parseConditions(condExpr) : [];
  const filter = filters?.find(f => f.value === '$') ?? filters?.[0];

  return {
    type,
    table,
    filter,
    filters,
    conditions,
    outputField: outputField ?? 'id',
  };
}

/** Split on commas that are not inside single quotes */
function splitTopLevel(text: string): string[] {
  const parts: string[] = [];
  let cur = '';
  let inQuote = false;
  for (const ch of text) {
    if (ch === "'") inQuote = !inQuote;
    if (ch === ',' && !inQuote) {
      parts.push(cur.trim());
      cur = '';
    } else {
      cur += ch;
    }
  }
  parts.push(cur.trim());
  return parts;
}

function parseFilters(expr: string): FilterPart[] {
  return splitTopLevel(expr).map(part => {
    const m = part.match(new RegExp(`^(${IDENT})\\s*=\\s*(.+)$`));
    if (!m) throw new PathCompileError(`Cannot parse filter '${part}'`);
    const value = m[2].trim();
    if (value !== '$' && !new RegExp(`^@${IDENT}$`).test(value) && !LITERAL_VALUE_RE.test(value)) {
      throw new PathCompileError(`Cannot parse filter value '${value}'`);
    }
    return { field: m[1], value };
  });
}

/**
 * Parse condition expression: {active} or {active,role=admin} or {valid_from<=now(),valid_to=NULL}
 */
function parseConditions(expr: string): ConditionPart[] {
  return splitTopLevel(expr).map(part => {
    // Boolean field: {active}
    if (IDENT_RE.test(part)) return { type: 'boolean', field: part } as ConditionPart;

    // Equality: {role=admin} or {role='admin'} or {valid_to=NULL}
    const eq = part.match(new RegExp(`^(${IDENT})\\s*=\\s*(.+)$`));
    if (eq && LITERAL_VALUE_RE.test(eq[2].trim())) {
      let value = eq[2].trim();
      if (value.toUpperCase() === 'NULL') {
        value = 'NULL';
      } else if (value.startsWith("'") && value.endsWith("'")) {
        value = value.slice(1, -1).replace(/''/g, "'");
      }
      return { type: 'equality', field: eq[1], value } as ConditionPart;
    }

    // Comparison: {valid_from<=now()}
    const cmp = part.match(TEMPORAL_RE);
    if (cmp) return { type: 'temporal', field: cmp[1], op: cmp[2], value: cmp[3] } as ConditionPart;

    throw new PathCompileError(`Cannot parse condition '${part}'`);
  });
}

// === SQL generation ===

function toSource(source: string | RowSource): RowSource {
  if (typeof source !== 'string') return source;
  return source.startsWith('p_') || source.startsWith('v_')
    ? { kind: 'jsonb', name: source }
    : { kind: 'row', name: source };
}

function fieldAccessor(source: RowSource): (field: string) => string {
  if (source.kind === 'jsonb') return (field) => `(${source.name}->>'${field}')::int`;
  return (field) => `${source.name}.${source.fieldMap?.[field] ?? field}`;
}

const quote = (s: string) => `'${s.replace(/'/g, "''")}'`;

/** SQL for a literal as written in a filter or condition */
function literalSQL(value: string): string {
  if (/^-?\d+(\.\d+)?$/.test(value)) return value;
  if (value === 'true' || value === 'false') return value;
  if (value.startsWith("'") && value.endsWith("'")) return quote(value.slice(1, -1).replace(/''/g, "'"));
  return quote(value);
}

/** Picks an alias for each table so no hop shadows the row being checked or another hop */
function aliaser(source: RowSource) {
  const used = new Set<string>(source.kind === 'row' ? [source.name] : []);
  return (table: string): string => {
    if (!used.has(table)) {
      used.add(table);
      return table;
    }
    let n = 1;
    while (used.has(`${table}_${n}`)) n++;
    used.add(`${table}_${n}`);
    return `${table}_${n}`;
  };
}

/** WHERE clauses for one hop: its join on prev, its other filters, its conditions */
function hopClauses(hop: PathHop, alias: string, prev: string | null, field: (f: string) => string): string[] {
  const clauses: string[] = [];
  if (hop.filters && hop.filters.length > 0) {
    for (const f of hop.filters) {
      const col = `${alias}.${f.field}`;
      if (f.value === '$') clauses.push(`${col} = ${prev}`);
      else if (f.value.startsWith('@')) clauses.push(`${col} = ${field(f.value.slice(1))}`);
      else if (f.value.toUpperCase() === 'NULL') clauses.push(`${col} IS NULL`);
      else clauses.push(`${col} = ${literalSQL(f.value)}`);
    }
  } else if (prev !== null) {
    clauses.push(`${alias}.id = ${prev}`);
  }
  for (const cond of hop.conditions || []) {
    clauses.push(conditionSQL(alias, cond));
  }
  return clauses;
}

function conditionSQL(alias: string, cond: ConditionPart): string {
  switch (cond.type) {
    case 'boolean':
      return `${alias}.${cond.field} = true`;
    case 'equality':
      if (cond.value === 'NULL') return `${alias}.${cond.field} IS NULL`;
      return `${alias}.${cond.field} = ${/^-?\d+(\.\d+)?$/.test(cond.value!) ? cond.value : quote(cond.value!)}`;
    case 'temporal':
      return `${alias}.${cond.field} ${cond.op} ${cond.value}`;
  }
}

function requireValid(parsed: ParsedPath): void {
  if (!parsed.isValid) throw new PathCompileError(parsed.error ?? 'Invalid path', parsed.path);
}

/** The hops a chain walks, and the value the first of them joins on */
function chainSteps(parsed: ParsedPath, field: (f: string) => string): { steps: PathHop[]; start: string | null } {
  return parsed.tableFirst
    ? { steps: parsed.hops, start: null }
    : { steps: parsed.hops.slice(1), start: field(parsed.startField!) };
}

/**
 * Compile a parsed path to SQL for permission checks (EXISTS)
 */
export function compilePathToExists(
  parsed: ParsedPath,
  dataVar: string | RowSource = 'p_data',
  userVar: string = 'p_user_id'
): string {
  requireValid(parsed);

  if (parsed.literal === 'TRUE') return 'TRUE';
  if (parsed.literal === 'FALSE') return 'FALSE';
  if (parsed.literal === 'AUTHENTICATED') return `${userVar} IS NOT NULL`;

  const source = toSource(dataVar);
  const field = fieldAccessor(source);

  // Simple field reference
  if (parsed.hops.length === 1 && parsed.hops[0].type === 'field') {
    return `${field(parsed.hops[0].field!)} = ${userVar}`;
  }

  const alias = aliaser(source);
  const { steps, start } = chainSteps(parsed, field);

  const build = (i: number, prev: string | null): string => {
    const hop = steps[i];
    const a = alias(hop.table!);
    const clauses = hopClauses(hop, a, prev, field);
    if (i === steps.length - 1) {
      clauses.push(`${a}.${hop.outputField} = ${userVar}`);
    } else {
      clauses.push(build(i + 1, `${a}.${hop.outputField}`));
    }
    const from = a === hop.table ? hop.table : `${hop.table} ${a}`;
    return `EXISTS (SELECT 1 FROM ${from} WHERE ${clauses.join(' AND ')})`;
  };

  return build(0, start);
}

/**
 * Compile a parsed path to SQL for notification resolution (SELECT user_ids)
 */
export function compilePathToSelect(
  parsed: ParsedPath,
  dataVar: string | RowSource = 'p_data'
): string {
  requireValid(parsed);

  if (parsed.literal) {
    throw new PathCompileError(`A notification path must lead to users, not ${parsed.literal}`, parsed.path);
  }

  const source = toSource(dataVar);
  const field = fieldAccessor(source);

  // Simple field reference - direct user_id
  if (parsed.hops.length === 1 && parsed.hops[0].type === 'field') {
    const value = field(parsed.hops[0].field!);
    return `SELECT ${value} WHERE ${value} IS NOT NULL`;
  }

  const alias = aliaser(source);
  const { steps, start } = chainSteps(parsed, field);
  const froms: string[] = [];
  const clauses: string[] = [];
  let prev = start;
  let last = '';

  for (const hop of steps) {
    const a = alias(hop.table!);
    froms.push(a === hop.table ? hop.table! : `${hop.table} ${a}`);
    clauses.push(...hopClauses(hop, a, prev, field));
    prev = `${a}.${hop.outputField}`;
    last = prev;
  }

  return `SELECT ${last} FROM ${froms.join(', ')} WHERE ${clauses.join(' AND ')}`;
}

/**
 * Validate a path expression's syntax and return detailed errors
 */
export function validatePath(path: string, entityName?: string): { valid: boolean; error?: string } {
  const parsed = parsePath(path);
  return parsed.isValid ? { valid: true } : { valid: false, error: parsed.error };
}
