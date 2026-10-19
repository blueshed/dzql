/**
 * The stories on Postgres (PGlite included): `Example.store` for dzql's harness. Its own SQLite runs
 * each story in a transaction and rolls it back; here every write is a transaction of its own, so
 * the store is saved as the stories begin (`exportTables`) and put back after each: the app's
 * tables emptied and imported again, their sequences with them, and the ledger emptied, so a
 * session's number coming round again in the next story has no undo of the last one's. The
 * documents' versions and the ops log only grow, and the listener reads them by position: kept.
 */
import type { Pool } from "pg";
import { q, type Schema, type Snapshot } from "@blueshed/delta/backend";
import { exportTables, importTables } from "./carry";

export function storyStore(pool: Pool, schema: Schema) {
  let saved: Snapshot | undefined;
  const tables = Object.values(schema.tables).map((t) => q(t.name));
  return {
    async begin() {
      saved ??= await exportTables(pool, schema);
    },
    async end() {
      await pool.query(`TRUNCATE ${[...tables, "_delta_ledger"].join(", ")}`);
      await importTables(pool, schema, saved!);
    },
    async last() {
      return Number((await pool.query("SELECT COALESCE(MAX(id), 0) AS id FROM _delta_ledger")).rows[0].id);
    },
    async since(id: number) {
      const { rows } = await pool.query("SELECT id, doc_name, undoable, ops, inverse FROM _delta_ledger WHERE id > $1 AND undoes IS NULL ORDER BY id", [id]);
      return rows.map((e) => ({ id: Number(e.id), doc: e.doc_name as string, undoable: e.undoable === true, ops: e.ops, inverse: e.inverse }));
    },
  };
}
