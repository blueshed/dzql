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
 * `ON CONFLICT DO UPDATE`) so it is safe to call again; `openStore` calls
 * `applyCompiled` instead, which applies the framework and the compiled SQL
 * together, in one transaction, and only when they changed.
 *
 * For docker-entrypoint-initdb.d workflows, use `dzql init` to
 * copy the same files into a directory the image can mount.
 */
import type { Pool, PoolClient } from "pg";
import { createHash } from "node:crypto";
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

/** The framework SQL, every `001*` file in order, as one text. */
export function frameworkSql(): string {
  return frameworkSqlFiles().map((path) => readFileSync(path, "utf8")).join("\n");
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

// ---------------------------------------------------------------------------
// applyCompiled: the framework and an app's compiled SQL, once (todo #86, #87)
// ---------------------------------------------------------------------------

/** A compiled set the database has had: its hash, its generation (one more each time a new set is applied), its documents, when. */
export type CompiledSet = { hash: string; generation: number; docTypes: string[]; appliedAt: string };

export type ApplyCompiledOptions = ApplyOptions & {
  /** The document types the set compiles (their prefixes): recorded with it, said when an older set meets it. */
  docTypes?: string[];
  /** Apply it even when it is the database's newest already (a migration ran: what it changed may need the set again). */
  force?: boolean;
  /** Put the set back though a newer one has replaced it since (a rollback). Without it, an older set is left unapplied. */
  rollback?: boolean;
  /** How long the DDL waits for each lock, in ms, before it gives way and tries again (`lock_timeout`). Default 5000. */
  lockTimeout?: number;
  /** How many times it tries before it gives up, saying why. Default 3. */
  tries?: number;
};

/**
 * What `applyCompiled` did: `applied`, or not, and why -- `current`, the set is the database's
 * newest already (no DDL ran); `older`, a newer set has replaced this one (`newer`) and it is not put back.
 */
export type ApplyCompiledResult =
  | { applied: true; set: CompiledSet }
  | { applied: false; why: "current"; set: CompiledSet }
  | { applied: false; why: "older"; set: CompiledSet; newer: CompiledSet };

/** The hash of what is applied: the framework and the compiled SQL together. */
export const compiledHash = (sql: string): string => createHash("sha256").update(sql).digest("hex");

/**
 * The set's functions as the catalogue has them now (each one's oid, and the transaction that last
 * made it): a change to one since the set was recorded -- `applyFramework` by hand, `dzql init
 * --upgrade`'s files applied, a function dropped -- and the set is applied again.
 */
const FUNCTIONS = `SELECT md5(COALESCE(string_agg(p.oid::text || ':' || p.xmin::text, ',' ORDER BY p.oid), '')) AS f
  FROM pg_proc p WHERE p.pronamespace = to_regnamespace(current_schema()) AND p.proname ~ '^(_?delta_|dzql_)'`;

const COMPILED_TABLE = `CREATE TABLE IF NOT EXISTS _delta_compiled (
  hash       TEXT PRIMARY KEY,
  generation BIGINT NOT NULL,
  doc_types  JSONB NOT NULL DEFAULT '[]',
  functions  TEXT,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
)`;

const setOf = (r: any): CompiledSet => ({ hash: r.hash, generation: Number(r.generation), docTypes: r.doc_types ?? [], appliedAt: new Date(r.applied_at).toISOString() });

/** A lock not taken within `lock_timeout` (SQLSTATE 55P03). */
export const lockLost = (err: unknown): boolean => (err as { code?: unknown } | null)?.code === "55P03";

/**
 * The framework SQL and an app's compiled SQL (`generateSql`), applied together in one transaction,
 * and only when they are not the database's already: a server starting beside running ones changes
 * nothing they use, and takes no lock, unless its set is new. Never half-applied: the framework's
 * uncompiled forms (`no doc def for`) are never seen between the two.
 *
 * The database keeps each set it has had (`_delta_compiled`: its hash, a generation one more than
 * the last, its documents), and runs the newest. A set is applied when it is new to the database,
 * or when it is the newest and its functions have changed since (or `force`). A set a newer one has
 * replaced is an older server's (a deploy rolling, an old instance restarting): it is left
 * unapplied, and that server runs on the newer set, as an older server still running does;
 * `rollback` puts it back, as the newest.
 *
 * The DDL waits `lockTimeout` for each lock (a long transaction on a table it puts a policy on),
 * then gives way, so the reads queued behind it are never held for long; it tries again (`tries`),
 * then says why it could not, having changed nothing.
 */
export async function applyCompiled(pool: Pool, compiled: string, opts: ApplyCompiledOptions = {}): Promise<ApplyCompiledResult> {
  const { namespace, docTypes = [], force = false, rollback = false, lockTimeout = 5000, tries = 3 } = opts;
  const sql = `${frameworkSql()}\n${compiled}`;
  const hash = compiledHash(sql);
  for (let attempt = 1; ; attempt++) {
    const db = await pool.connect();
    try {
      await db.query("BEGIN");
      if (namespace !== undefined) {
        const ns = namespaceOf(namespace);
        await ensureNamespace(db, ns);
        await db.query("SELECT set_config('search_path', $1, true)", [ns]);
      }
      await db.query("SELECT set_config('lock_timeout', $1, true)", [`${Math.max(1, Math.round(lockTimeout))}ms`]);
      const result = await applyOnce(db, sql, hash, { docTypes, force, rollback });
      await db.query("COMMIT");
      return result;
    } catch (err) {
      try { await db.query("ROLLBACK"); } catch { /* the connection may be gone */ }
      if (!lockLost(err)) throw err;
      if (attempt >= tries) {
        throw new Error(`applyCompiled: the documents' SQL could not take its locks within ${lockTimeout} ms, ${tries} times: a long-running transaction holds a table it changes (pg_stat_activity says which). Nothing was changed: start again once it ends, or give a longer lockTimeout`, { cause: err });
      }
      await new Promise((r) => setTimeout(r, Math.min(attempt * 500, 2000)));
    } finally {
      db.release();
    }
  }
}

async function applyOnce(db: PoolClient, sql: string, hash: string, { docTypes, force, rollback }: { docTypes: string[]; force: boolean; rollback: boolean }): Promise<ApplyCompiledResult> {
  const kept = (await db.query("SELECT to_regclass('_delta_compiled') IS NOT NULL AS there")).rows[0]?.there === true;
  const rows: any[] = kept ? (await db.query("SELECT hash, generation, doc_types, functions, applied_at FROM _delta_compiled ORDER BY generation DESC")).rows : [];
  const newest = rows[0];
  const mine = rows.find((r) => r.hash === hash);
  if (newest?.hash === hash && !force && (await db.query(FUNCTIONS)).rows[0]?.f === newest.functions) {
    return { applied: false, why: "current", set: setOf(newest) };
  }
  if (mine && newest.hash !== hash && !rollback) return { applied: false, why: "older", set: setOf(mine), newer: setOf(newest) };
  await db.query(sql);
  await db.query(COMPILED_TABLE);
  const generation = newest?.hash === hash ? Number(newest.generation) : Number(newest?.generation ?? 0) + 1;
  const functions = (await db.query(FUNCTIONS)).rows[0]?.f;
  const { rows: [row] } = await db.query(
    `INSERT INTO _delta_compiled (hash, generation, doc_types, functions, applied_at) VALUES ($1, $2, $3::jsonb, $4, NOW())
     ON CONFLICT (hash) DO UPDATE SET generation = EXCLUDED.generation, doc_types = EXCLUDED.doc_types, functions = EXCLUDED.functions, applied_at = EXCLUDED.applied_at
     RETURNING hash, generation, doc_types, applied_at`,
    [hash, generation, JSON.stringify(docTypes), functions]);
  return { applied: true, set: setOf(row) };
}
