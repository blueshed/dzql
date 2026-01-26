import type { ColumnInfo } from "./types.js";

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
