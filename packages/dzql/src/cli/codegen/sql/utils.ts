import type { ColumnInfo, EntityIR } from "./types.js";

/**
 * Generate a jsonb_build_object expression that excludes hidden fields.
 * If no hidden fields, returns to_jsonb(alias.*) for efficiency.
 * @param alias - Table alias (e.g., 'venues', 't', 'root')
 * @param columns - All columns from entityIR
 * @param hidden - Array of hidden field names
 */
export function buildVisibleJsonb(alias: string, columns: ColumnInfo[], hidden: string[] = []): string {
  if (!hidden || hidden.length === 0) {
    return `to_jsonb(${alias}.*)`;
  }

  const visibleCols = columns.filter(c => !hidden.includes(c.name));
  const pairs = visibleCols.map(c => `'${c.name}', ${alias}.${c.name}`).join(', ');
  return `jsonb_build_object(${pairs})`;
}

/**
 * Project a RELATED entity (FK/M2M expansion target) through its own visible
 * columns, so a related object never leaks the target's hidden fields (e.g. a
 * post's `author` must not expose users.password_hash). Falls back to
 * to_jsonb(alias.*) only when the target entity is unknown to the generator.
 * @param alias - Table alias the related row is selected under (e.g. 't', 'target')
 * @param targetEntity - IR of the related entity, if available
 */
export function buildVisibleJsonbForEntity(alias: string, targetEntity?: EntityIR): string {
  if (!targetEntity) {
    return `to_jsonb(${alias}.*)`;
  }
  return buildVisibleJsonb(alias, targetEntity.columns, targetEntity.hidden || []);
}

/**
 * Get the SQL cast for a column type
 */
export function getCastForType(type: string): string {
  if (type.includes('int') || type.includes('serial')) return '::int';
  if (type.includes('timestamp')) return '::timestamptz';
  if (type.includes('date')) return '::date';
  if (type.includes('bool')) return '::boolean';
  if (type.includes('decimal') || type.includes('numeric')) return '::numeric';
  return '';
}

/**
 * Remove REFERENCES clause from a column type for deferred FK creation.
 * Preserves NOT NULL, DEFAULT, and other modifiers.
 * e.g., "int NOT NULL REFERENCES users(id) ON DELETE CASCADE" -> "int NOT NULL"
 */
export function stripFKReferences(columnType: string): string {
  return columnType
    .replace(/\s*REFERENCES\s+\w+(\([^)]+\))?(\s+ON\s+(DELETE|UPDATE)\s+(CASCADE|SET NULL|SET DEFAULT|RESTRICT|NO ACTION))*/gi, '')
    .trim();
}
