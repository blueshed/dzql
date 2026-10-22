/** SQL helpers for codegen.ts (the schema's DDL) and carry.ts (export and import). */
import { q } from "@blueshed/delta/backend";
import type { Pool, PoolClient } from "pg";
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

/**
 * An app's Postgres schema (todo #29), checked: a plain lower-case name, so it is written on a search
 * path or a connection's options with no quoting, and short enough that its change channel
 * (`delta:<schema>`, 001c's `_delta_channel`) is one Postgres takes (63 bytes).
 */
export function namespaceOf(namespace: string): string {
  if (!/^[a-z_][a-z0-9_]{0,56}$/.test(namespace)) {
    throw new Error(`namespace "${namespace}" is not a schema dzql can keep an app in: lower-case letters, digits and _, from a letter or _, 57 at most`);
  }
  return namespace;
}

/**
 * `fn` on a connection of its own, in one transaction with `dzql.definer` raised: what a table's
 * owner does to every row (carrying them in and out), past the policies generateSql derives from the
 * documents' paths (todo #19), which let the owner past while it is raised. To another role it gives
 * nothing; a superuser, or a role with BYPASSRLS, needs none.
 */
export async function asOwner<T>(pool: Pool, fn: (db: PoolClient) => Promise<T>): Promise<T> {
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    await db.query("SELECT set_config('dzql.definer', 'on', true)");
    const out = await fn(db);
    await db.query("COMMIT");
    return out;
  } catch (err) {
    try { await db.query("ROLLBACK"); } catch { /* the connection may be gone */ }
    throw err;
  } finally {
    db.release();
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
    case "date": return "DATE";
    case "numeric": return "NUMERIC";   // exact; read back as its text (rowJson), never a JSON number
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
