/**
 * Postgres's migrations (PGlite's too; `../migrate.ts` says the rules):
 * `migrate` runs a list at start-up, before `applyFramework` and
 * `applySql(pool, generateSql(…))`; the helpers are the changes people make
 * most, each SQL that keeps delta's scaffolding in step (a temporal table's
 * `current_<table>` view and its grants, the `idx_<table>_…` indexes, the
 * `seq_<table>` serial, `_delta_collections`). Two processes starting at once
 * take turns on an advisory lock, so each migration runs once.
 */
import type { Pool, PoolClient } from "pg";
import { q } from "@blueshed/delta/backend";
import { appOf, fenced, runMigrations, statusOf, type MigrateOptions, type MigrateResult, type Migration, type MigrationStatus, type Store } from "@blueshed/delta/backend";
import { schemaOf } from "@blueshed/delta/migrations";
import { tableSql } from "./codegen";
import { currentViewSql, lit, seqOf, viewOf } from "./sql";

export { fromFolder, type Migration, type MigrateOptions, type MigrateResult, type MigrationStatus, type MigrationTools } from "@blueshed/delta/backend";

/** What a helper runs its SQL on: the client `up` is given. */
type Tx = Pick<PoolClient, "query">;

/** The advisory lock's key: one per database, for delta's migrations. */
const LOCK = "hashtext('delta_migrations')";

const regclass = async (tx: Tx, name: string): Promise<boolean> =>
  (await tx.query("SELECT to_regclass($1) IS NOT NULL AS there", [q(name)])).rows[0]?.there === true;

function store(client: PoolClient, app: string, collections?: string): Store<PoolClient> {
  return {
    async lock() { await client.query(`SELECT pg_advisory_lock(${LOCK})`); },
    async unlock() { await client.query(`SELECT pg_advisory_unlock(${LOCK})`); },
    async exists() { return regclass(client, "delta_migrations"); },
    async tables(names) {
      const out = new Map<string, { columns: string[]; rows: boolean }>();
      const { rows: found } = await client.query(
        `SELECT table_name AS name, array_agg(column_name::text) AS columns FROM information_schema.columns
          WHERE table_schema = current_schema() AND table_name IN (SELECT jsonb_array_elements_text($1::jsonb)) GROUP BY 1`, [JSON.stringify(names)]);
      for (const t of found) {
        const rows = (await client.query(`SELECT EXISTS (SELECT 1 FROM ${q(t.name)}) AS any`)).rows[0]?.any === true;
        out.set(t.name, { columns: Array.isArray(t.columns) ? t.columns : String(t.columns).replace(/^\{|\}$/g, "").split(","), rows });
      }
      return out;
    },
    async hasAppTables() {
      const { rows } = await client.query(
        "SELECT count(*)::int AS n FROM pg_tables WHERE schemaname = current_schema() AND tablename !~ '^_?delta_'",
      );
      return rows[0]!.n > 0;
    },
    async create() { await client.query("CREATE TABLE IF NOT EXISTS delta_migrations (app TEXT NOT NULL, id TEXT NOT NULL, ran_at TEXT NOT NULL, PRIMARY KEY (app, id))"); },
    async recorded() { return (await client.query("SELECT id, ran_at FROM delta_migrations WHERE app = $1 ORDER BY ran_at, id", [app])).rows; },
    async transaction(fn) {
      await client.query("BEGIN");
      try {
        const out = await fn(client);
        await client.query("COMMIT");
        return out;
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      }
    },
    async has(tx, id) { return (await tx.query("SELECT 1 FROM delta_migrations WHERE app = $1 AND id = $2", [app, id])).rows.length > 0; },
    async record(tx, id, at) { await tx.query("INSERT INTO delta_migrations (app, id, ran_at) VALUES ($1, $2, $3)", [app, id, at]); },
    async fence(tx) {
      if (!(await regclass(tx, "_delta_ledger"))) return;
      if (collections === undefined) return void (await tx.query("UPDATE _delta_ledger SET undoable = FALSE WHERE undoable"));
      // an entry is the app's when an op of it, or of its inverse, names one of the app's collections: /<coll>/...
      await tx.query(`UPDATE _delta_ledger SET undoable = FALSE WHERE undoable AND EXISTS (
        SELECT 1 FROM jsonb_array_elements(ops || inverse) AS o
         WHERE split_part(o->>'path', '/', 2) IN (SELECT jsonb_array_elements_text($1::jsonb)))`, [collections]);
    },
    async nextId(tx, _collection, table) {
      // nextval, then on past any id the table holds (a row an earlier up put in by hand): the next add follows on
      const seq = lit(q(seqOf(table)));
      const { rows } = await tx.query(`SELECT setval(${seq}, GREATEST(nextval(${seq}), (SELECT COALESCE(MAX(id), 0) + 1 FROM ${q(table)}))) AS id`);
      return Number(rows[0]!.id);
    },
    async apply(tx, c, before, after) {
      // each change as the history makes it; made already (a database adopting the history), it is left
      switch (c.change) {
        case "createTable":
        case "addColumn":
        case "addUnique":
          // the table's SQL as generateSql writes it: every statement idempotent, so it adds what is missing
          // (and a temporal table's view takes a column added after it)
          await tx.query(tableSql(c.key, schemaOf(after).tables[c.key]!).join("\n"));
          return;
        case "dropColumn":
          return dropColumn(tx, before[c.key]!.table, c.column);
        case "renameColumn":
          return renameColumn(tx, before[c.key]!.table, c.column, c.to);
        case "renameTable":
          if (before[c.key]!.table !== after[c.to]!.table) await renameTable(tx, before[c.key]!.table, after[c.to]!.table);
          if (await regclass(tx, "_delta_collections")) await tx.query("UPDATE _delta_collections SET collection_key = $2 WHERE collection_key = $1", [c.key, c.to]);
          return;
        case "dropUnique": {
          const was = schemaOf(before).tables[c.key]!.unique!.find((u) => u.columns.join() === c.columns.join())!;
          await tx.query(`DROP INDEX IF EXISTS ${q(was.name)}`);
          return;
        }
        case "dropTable": {
          const table = before[c.key]!.table;
          await tx.query(`DROP VIEW IF EXISTS ${q(viewOf(table))}`);
          await tx.query(`DROP TABLE IF EXISTS ${q(table)}`);
          await tx.query(`DROP SEQUENCE IF EXISTS ${q(seqOf(table))}`);
          if (await regclass(tx, "_delta_collections")) await tx.query("DELETE FROM _delta_collections WHERE collection_key = $1", [c.key]);
          return;
        }
      }
    },
  };
}

/**
 * Runs `fn` on a client of its own, holding nothing after: as the tables' owner, past the policies
 * the documents' paths make (`dzql.definer` raised for the client's while, todo #19), so a history
 * counts and changes every row, as it does where no policy is.
 */
async function withClient<T>(pool: Pool, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("SELECT set_config('dzql.definer', 'on', false)");
    return await fn(client);
  } finally {
    await client.query("SELECT set_config('dzql.definer', '', false)").catch(() => {});
    client.release();
  }
}

/**
 * Runs each migration of the app's list not yet run here, in order, each in
 * its own transaction on one client (`up(client)`). Call it at start-up, before
 * `applyFramework` and the schema's `generateSql`; name the app and give its
 * schema when apps share the database.
 */
export function migrate(pool: Pool, migrations: Migration<PoolClient>[], options: MigrateOptions = {}): Promise<MigrateResult> {
  return withClient(pool, (client) => runMigrations(store(client, appOf(options), fenced(options)), migrations, options));
}

/** What of the app's has run here, what would run, and whether the app is new here; changes nothing. */
export function migrationStatus(pool: Pool, migrations: Migration<PoolClient>[], options: MigrateOptions = {}): Promise<MigrationStatus> {
  return withClient(pool, (client) => statusOf(store(client, appOf(options)), migrations, options));
}

// ---------------------------------------------------------------------------
// Helpers: each one change, with delta's scaffolding kept in step. Each takes
// the client `up` is given.
// ---------------------------------------------------------------------------

/** Renames a column, every version of every row with it, and in the table's `current_` view; its `idx_<table>_<from>` index goes by the new name. */
export async function renameColumn(tx: Tx, table: string, from: string, to: string): Promise<void> {
  await tx.query(`ALTER TABLE ${q(table)} RENAME COLUMN ${q(from)} TO ${q(to)}`);
  if (await regclass(tx, viewOf(table))) await tx.query(`ALTER VIEW ${q(viewOf(table))} RENAME COLUMN ${q(from)} TO ${q(to)}`);
  await tx.query(`ALTER INDEX IF EXISTS ${q(`idx_${table}_${from}`)} RENAME TO ${q(`idx_${table}_${to}`)}`);
}

/**
 * Drops a column and what it held. A temporal table's `current_` view reads
 * every column, so it is made again without it, with the grants it had. Move
 * what must be kept first.
 */
export async function dropColumn(tx: Tx, table: string, column: string): Promise<void> {
  const view = viewOf(table);
  if (!(await regclass(tx, view))) {
    await tx.query(`ALTER TABLE ${q(table)} DROP COLUMN ${q(column)}`);
    return;
  }
  const { rows: grants } = await tx.query(
    `SELECT grantee, privilege_type FROM information_schema.role_table_grants
      WHERE table_schema = current_schema() AND table_name = $1 AND grantee <> current_user`, [view]);
  await tx.query(`DROP VIEW ${q(view)}`);
  await tx.query(`ALTER TABLE ${q(table)} DROP COLUMN ${q(column)}`);
  await tx.query(currentViewSql(table));
  for (const g of grants) await tx.query(`GRANT ${g.privilege_type} ON ${q(view)} TO ${g.grantee === "PUBLIC" ? "PUBLIC" : q(g.grantee)}`);
}

/**
 * Renames a table, with its `current_<table>` view, its `idx_<table>_…`
 * indexes and primary key, its `seq_<table>` serial (the next id follows on),
 * and the name `_delta_collections` keeps for it.
 */
export async function renameTable(tx: Tx, from: string, to: string): Promise<void> {
  await tx.query(`ALTER TABLE ${q(from)} RENAME TO ${q(to)}`);
  await tx.query(`ALTER VIEW IF EXISTS ${q(viewOf(from))} RENAME TO ${q(viewOf(to))}`);
  await tx.query(`ALTER SEQUENCE IF EXISTS ${q(seqOf(from))} RENAME TO ${q(seqOf(to))}`);
  const { rows: indexes } = await tx.query(
    "SELECT indexname FROM pg_indexes WHERE schemaname = current_schema() AND tablename = $1 AND starts_with(indexname, $2)", [to, `idx_${from}_`]);
  for (const { indexname } of indexes) await tx.query(`ALTER INDEX ${q(indexname)} RENAME TO ${q(`idx_${to}_${indexname.slice(`idx_${from}_`.length)}`)}`);
  const { rows: pkey } = await tx.query(
    "SELECT 1 FROM pg_constraint WHERE conrelid = to_regclass($1) AND conname = $2", [q(to), `${from}_pkey`]);
  if (pkey.length) await tx.query(`ALTER TABLE ${q(to)} RENAME CONSTRAINT ${q(`${from}_pkey`)} TO ${q(`${to}_pkey`)}`);
  if (await regclass(tx, "_delta_collections")) await tx.query("UPDATE _delta_collections SET table_name = $2 WHERE table_name = $1", [from, to]);
}
