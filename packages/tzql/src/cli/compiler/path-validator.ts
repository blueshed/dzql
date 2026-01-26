/**
 * Path Validator
 *
 * Validates all permission and notification paths in a domain configuration.
 * Used by the CLI `validate-paths` command.
 */

import type { DomainConfig, EntityConfig } from "../../shared/ir.js";
import { parsePath } from "./paths.js";

export interface PathValidationResult {
  entity: string;
  pathType: 'permissions.view' | 'permissions.create' | 'permissions.update' | 'permissions.delete' | 'notifications';
  pathIndex: number;
  path: string;
  valid: boolean;
  error?: string;
}

/**
 * Validate all paths in a domain configuration
 */
export function validatePaths(domain: DomainConfig): PathValidationResult[] {
  const results: PathValidationResult[] = [];

  for (const [entityName, entity] of Object.entries(domain.entities)) {
    // Validate permission paths
    const permissions = entity.permissions || {};

    for (const permType of ['view', 'create', 'update', 'delete'] as const) {
      const paths = permissions[permType] || [];
      for (let i = 0; i < paths.length; i++) {
        const path = paths[i];
        const result = validateSinglePath(path, entityName, domain);
        results.push({
          entity: entityName,
          pathType: `permissions.${permType}`,
          pathIndex: i,
          path,
          valid: result.valid,
          error: result.error
        });
      }
    }

    // Validate notification paths
    const notifications = (entity as any).notifications || {};
    for (const [notifyName, paths] of Object.entries(notifications)) {
      if (!Array.isArray(paths)) continue;
      for (let i = 0; i < paths.length; i++) {
        const path = paths[i] as string;
        const result = validateSinglePath(path, entityName, domain);
        results.push({
          entity: entityName,
          pathType: 'notifications',
          pathIndex: i,
          path,
          valid: result.valid,
          error: result.error ? `${notifyName}: ${result.error}` : undefined
        });
      }
    }
  }

  // Validate subscribable canSubscribe paths
  for (const [subName, sub] of Object.entries(domain.subscribables || {})) {
    const paths = sub.canSubscribe || [];
    for (let i = 0; i < paths.length; i++) {
      const path = paths[i];
      const result = validateSinglePath(path, subName, domain);
      results.push({
        entity: subName,
        pathType: 'permissions.view',
        pathIndex: i,
        path,
        valid: result.valid,
        error: result.error
      });
    }
  }

  return results;
}

/**
 * Validate a single path expression
 */
function validateSinglePath(
  path: string,
  entityName: string,
  domain: DomainConfig
): { valid: boolean; error?: string } {
  // Parse the path
  const parsed = parsePath(path);

  if (!parsed.isValid) {
    return { valid: false, error: parsed.error };
  }

  // Optionally validate that referenced tables exist
  const errors: string[] = [];

  for (const hop of parsed.hops) {
    if (hop.table && hop.type !== 'field') {
      if (!domain.entities[hop.table]) {
        errors.push(`Unknown table '${hop.table}'`);
      }
    }
  }

  if (errors.length > 0) {
    return { valid: false, error: errors.join('; ') };
  }

  return { valid: true };
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
