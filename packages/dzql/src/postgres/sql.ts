/** SQL helpers for codegen.ts (the schema's DDL) and carry.ts (export and import). */
import { q } from "@blueshed/delta/backend";
import type { ColumnDef, Schema } from "./schema";

/**
 * Emit a single-quoted SQL string literal with embedded quotes escaped.
 * Use for ANY value interpolated into a `'…'` literal position so an
 * apostrophe in a name can't terminate the literal or inject SQL.
 */
/** A table's serial, `seq_<table>`: named here, once. */
export const seqOf = (table: string): string => `seq_${table}`;
/** A temporal table's rows standing now, `current_<table>`: named here, once. */
export const viewOf = (table: string): string => `current_${table}`;
/** That view, made: by generateSql with the table, and again when a column it reads is dropped. */
export const currentViewSql = (table: string): string => `CREATE OR REPLACE VIEW ${q(viewOf(table))} WITH (security_invoker = true) AS SELECT * FROM ${q(table)} WHERE valid_to IS NULL`;

/** Each item its own function name, or `clash` says the two that would share one. */
export function distinctNames<T>(items: T[], nameOf: (item: T) => string, clash: (first: T, second: T, name: string) => string): void {
  const seen = new Map<string, T>();
  for (const item of items) {
    const name = nameOf(item);
    const other = seen.get(name);
    if (other !== undefined) throw new Error(clash(other, item, name));
    seen.set(name, item);
  }
}

export function lit(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

export function columnSqlType(def: ColumnDef): string {
  switch (def.type) {
    case "text": return "TEXT";
    case "json": return "JSONB";
    case "integer": return "BIGINT";
    case "boolean": return "BOOLEAN";
    case "real": return "DOUBLE PRECISION";
    case "timestamptz": return "TIMESTAMPTZ";
  }
}

export function sqlDefault(value: unknown): string {
  if (typeof value === "string") return lit(value);
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  return "NULL";
}

export function findCascadeOn(collKey: string, schema: Schema): { fk: string; collection: string }[] {
  const result: { fk: string; collection: string }[] = [];
  for (const [otherKey, otherTable] of Object.entries(schema.tables)) {
    if (otherKey === collKey) continue;
    for (const ref of otherTable.referencedBy) {
      if (ref.collection === collKey) {
        result.push({ fk: ref.fkColumn, collection: otherKey });
      }
    }
  }
  return result;
}
