/**
 * Path Validator
 *
 * Checks every permission, notification and canSubscribe path in a domain
 * against the domain itself: the syntax parses, every table is an entity,
 * every column exists, and values compared with ids are integer keys.
 * compileDomain refuses to build a domain with any error here, and the CLI
 * `validate-paths` command reports them path by path.
 */

import type { DomainConfig } from "../../shared/ir.js";
import { generateIR } from "./ir.js";
import { parsePath, isIntegerType } from "./paths.js";

export interface PathValidationResult {
  entity: string;
  pathType: 'permissions.view' | 'permissions.create' | 'permissions.update' | 'permissions.delete' | 'notifications' | 'canSubscribe';
  pathIndex: number;
  path: string;
  valid: boolean;
  error?: string;
}

interface EntityLike {
  columns: Array<{ name: string; type: string }>;
}

type PathKind = 'permission' | 'notification' | 'subscribe-list';

/**
 * Check one path against the domain. Returns the problems found (empty if none).
 *
 * @param entity - the entity whose row the path starts from
 * @param fieldMap - renames start fields (a subscribable's key param is the root's id)
 */
export function checkPath(
  rule: string,
  entityName: string,
  entities: Record<string, EntityLike>,
  kind: PathKind = 'permission',
  fieldMap: Record<string, string> = {}
): string[] {
  const parsed = parsePath(rule);
  if (!parsed.isValid) return [parsed.error ?? 'invalid path'];

  if (parsed.literal) {
    return kind === 'notification' ? [`a notification path must lead to users, not ${parsed.literal}`] : [];
  }
  if (kind === 'subscribe-list') {
    return ['a list subscribable has no root row to follow a path from; use TRUE, FALSE or AUTHENTICATED'];
  }

  const problems: string[] = [];
  const columnOf = (table: string, column: string) =>
    entities[table]?.columns.find(c => c.name === column);

  const requireColumn = (table: string, column: string, integer: boolean) => {
    const col = columnOf(table, column);
    if (!col) {
      problems.push(`no column '${column}' on ${table}`);
    } else if (integer && !isIntegerType(col.type)) {
      problems.push(`'${column}' is ${col.type.split(/\s/)[0]}, not an integer key`);
    }
  };
  // A field of the row being checked (its start field, or an @field in a filter)
  const requireOwnField = (field: string) => requireColumn(entityName, fieldMap[field] ?? field, true);

  if (!parsed.tableFirst) requireOwnField(parsed.startField!);

  const steps = parsed.tableFirst ? parsed.hops : parsed.hops.slice(1);
  for (const hop of steps) {
    const table = hop.table!;
    if (!entities[table]) {
      problems.push(`unknown table '${table}'`);
      continue;
    }
    // A hop without [filters] joins the previous value on its id.
    if (!hop.filters?.length) requireColumn(table, 'id', true);
    for (const f of hop.filters ?? []) {
      requireColumn(table, f.field, f.value === '$');
      if (f.value.startsWith('@')) requireOwnField(f.value.slice(1));
    }
    for (const c of hop.conditions ?? []) requireColumn(table, c.field, false);
    // The value passed on joins the next hop's key; the last one is compared with the user.
    requireColumn(table, hop.outputField!, true);
  }

  return problems;
}

/**
 * Validate every path in a compiled domain. Each error names where the path is
 * written, what is wrong, and the path itself.
 */
export function validateDomainPaths(ir: { entities: Record<string, any>; subscribables: Record<string, any> }): string[] {
  return collectResults(ir).filter(r => !r.valid).map(r => r.error!);
}

function collectResults(ir: { entities: Record<string, any>; subscribables: Record<string, any> }): PathValidationResult[] {
  const results: PathValidationResult[] = [];
  const record = (entity: string, pathType: PathValidationResult['pathType'], where: string, pathIndex: number, path: string, problems: string[]) => {
    results.push({
      entity,
      pathType,
      pathIndex,
      path,
      valid: problems.length === 0,
      error: problems.length ? `${where}: ${problems.join('; ')} — in '${path}'` : undefined,
    });
  };

  for (const [entityName, entity] of Object.entries<any>(ir.entities)) {
    for (const action of ['view', 'create', 'update', 'delete'] as const) {
      (entity.permissions?.[action] ?? []).forEach((path: string, i: number) => {
        record(entityName, `permissions.${action}`, `${entityName}.permissions.${action}`, i, path,
          checkPath(path, entityName, ir.entities));
      });
    }
    for (const [notifyName, paths] of Object.entries<any>(entity.notifications ?? {})) {
      if (!Array.isArray(paths)) continue;
      paths.forEach((path: string, i: number) => {
        record(entityName, 'notifications', `${entityName}.notifications.${notifyName}`, i, path,
          checkPath(path, entityName, ir.entities, 'notification'));
      });
    }
  }

  for (const [subName, sub] of Object.entries<any>(ir.subscribables)) {
    const rootKey: string = sub.root?.key ?? '';
    const isList = !rootKey;
    const fieldMap = rootKey && !rootKey.startsWith('@') ? { [rootKey]: 'id' } : {};
    (sub.canSubscribe ?? []).forEach((path: string, i: number) => {
      const problems = !isList && !ir.entities[sub.root?.entity]
        ? [`unknown root entity '${sub.root?.entity}'`]
        : checkPath(path, sub.root.entity, ir.entities, isList ? 'subscribe-list' : 'permission', fieldMap);
      record(subName, 'canSubscribe', `${subName}.canSubscribe`, i, path, problems);
    });
  }

  return results;
}

/**
 * Validate all paths in a domain configuration (for the CLI `validate-paths` command)
 */
export function validatePaths(domain: DomainConfig): PathValidationResult[] {
  return collectResults(generateIR(domain));
}

/**
 * Format validation results for display
 */
export function formatValidationResults(results: PathValidationResult[]): string {
  const lines: string[] = [];

  for (const result of results) {
    const status = result.valid ? '✓' : '✗';
    const location = `${result.entity}.${result.pathType}[${result.pathIndex}]`;

    if (result.valid) {
      lines.push(`${status} ${location}: valid`);
    } else {
      lines.push(`${status} ${location}: ${result.error}`);
    }
  }

  const errorCount = results.filter(r => !r.valid).length;
  lines.push(`\n${results.length} paths validated, ${errorCount} errors`);

  return lines.join('\n');
}
