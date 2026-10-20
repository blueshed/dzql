/**
 * Bootstrap helpers — apply the framework SQL (`src/sql/001*`) to a Postgres
 * database, programmatically. Alternative to copying the files into a
 * consumer's `init_db/` directory.
 *
 *   import { Pool } from "pg";
 *   import { applyFramework } from "dzql/postgres";
 *
 *   const pool = new Pool({ connectionString: process.env.DATABASE_URL });
 *   await applyFramework(pool);
 *
 * The framework SQL is idempotent (`CREATE … IF NOT EXISTS`,
 * `ON CONFLICT DO UPDATE`) so it is safe to call on every server boot.
 *
 * For docker-entrypoint-initdb.d workflows, use `dzql init` to
 * copy the same files into a directory the image can mount.
 */
import type { Pool } from "pg";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { namespaceOf } from "./sql";

/** Where SQL is applied: an app's Postgres schema (todo #29); without one, the pool's own search path, as always. */
export type ApplyOptions = { namespace?: string };

/** An app's Postgres schema made, when it is not there: asked first, so a role that may not create a schema may still apply into one made for it. */
export async function ensureNamespace(db: Pick<Pool, "query">, namespace: string): Promise<void> {
  const ns = namespaceOf(namespace);
  if ((await db.query("SELECT to_regnamespace($1) IS NULL AS missing", [ns])).rows[0].missing) await db.query(`CREATE SCHEMA ${ns}`);
}

/**
 * `sql` run on the pool: as it is, or in `namespace`, made first when it is not there, with it as
 * the transaction's search path -- so the tables and functions are made there, and the definer
 * functions pin it (001b, 001d, compileLookups), whatever path the pool's connections have.
 */
async function applyIn(pool: Pool, sql: string, namespace: string | undefined): Promise<void> {
  if (namespace === undefined) { await pool.query(sql); return; }
  const ns = namespaceOf(namespace);
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    await ensureNamespace(db, ns);
    await db.query("SELECT set_config('search_path', $1, true)", [ns]);
    await db.query(sql);
    await db.query("COMMIT");
  } catch (err) {
    try { await db.query("ROLLBACK"); } catch { /* the connection may be gone */ }
    throw err;
  } finally {
    db.release();
  }
}

const FRAMEWORK_SQL_DIR = join(import.meta.dir, "..", "sql");

/** Absolute paths to the framework SQL files, in apply-order.
 *  Filters to `001*-*.sql` — siblings like `auth-jwt.sql` are applied
 *  separately (see `dzql/auth-jwt` → `applyAuthJwtSchema`). */
export function frameworkSqlFiles(): string[] {
  return readdirSync(FRAMEWORK_SQL_DIR)
    .filter((f) => /^001[a-z]?-.+\.sql$/.test(f))
    .sort()
    .map((f) => join(FRAMEWORK_SQL_DIR, f));
}

/**
 * Apply the framework SQL to the given pool. Runs every `001*` file in
 * `src/sql/` alphabetically — 001a through 001g today. Safe to call
 * repeatedly (idempotent statements). With `namespace`, into that Postgres
 * schema: an app of its own there, told on its own channel (`applyIn`).
 */
export async function applyFramework(pool: Pool, { namespace }: ApplyOptions = {}): Promise<void> {
  for (const path of frameworkSqlFiles()) {
    const sql = readFileSync(path, "utf8");
    await applyIn(pool, sql, namespace);
  }
}

/**
 * Apply an arbitrary SQL string to the pool (convenience wrapper). Useful
 * for layering `generateSql(schema, docs)` output on top of the framework:
 *
 *   await applyFramework(pool);
 *   await applySql(pool, generateSql(schema, docs));
 */
export async function applySql(pool: Pool, sql: string, { namespace }: ApplyOptions = {}): Promise<void> {
  if (sql.trim()) await applyIn(pool, sql, namespace);
}
