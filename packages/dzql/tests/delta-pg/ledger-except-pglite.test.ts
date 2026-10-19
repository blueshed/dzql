/**
 * The ledger kept for every document but those named (`ledger: { except }`): a session that is no
 * one's history -- where a person is -- stays off it, as a SQLite registration without
 * `ledger: true` does, while the documents beside it are on it and undo walks them. On Postgres in
 * this process (PGlite); dzql's thin client needs it to keep its session on Postgres.
 */
import { afterAll, beforeAll, expect, test } from "bun:test";
import type { Pool } from "pg";
import { createLocal } from "@blueshed/delta/local";
import { setLogLevel } from "@blueshed/delta/logger";
import { applyFramework, applySql, createDocListener, defineDoc, defineSchema, docTypeFromDef, generateSql, importTables } from "../../src/postgres";
import { openPglite } from "../../src/postgres/pglite";

setLogLevel("silent");

const schema = defineSchema({
  tools: { columns: { name: "text" }, temporal: false },
  visits: { columns: { page: "text?" }, temporal: false },
});
const docs = [defineDoc("shed:", { root: "tools", include: [] }), defineDoc("visit:", { root: "visits", include: [], implied: true })];

let pool: Pool;
const local = createLocal();
let listener: Awaited<ReturnType<typeof createDocListener>>;

beforeAll(async () => {
  pool = await openPglite();
  await applyFramework(pool);
  await applySql(pool, generateSql(schema, docs));
  await importTables(pool, schema, { tables: { tools: [{ id: 1, name: "spade" }] } });
  listener = await createDocListener(local.server, pool, { types: docs.map((def) => docTypeFromDef(def, pool)), ledger: { except: ["visit:"] } });
}, 30_000);
afterAll(async () => { await listener.destroy(); await pool.end(); });

test("a write to a document on the ledger has an entry and undoes; one to a document off it has none", async () => {
  // as dzql's kernel writes: in this process, the session the cursor
  const write = (doc: string, ops: unknown[]) => local.call("delta", { doc, ops, cursor: "s1" });
  const kept = await write("shed:", [{ op: "replace", path: "/tools/1/name", value: "fork" }]);
  expect(kept.result.entry).toBeNumber();
  const moved = await write("visit:1", [{ op: "replace", path: "/visits/page", value: "tables" }]);
  expect(moved.error).toBeUndefined();
  expect(moved.result.entry).toBeUndefined();
  // undo walks the shed's write, never the visit's
  expect((await local.call("undo", { cursor: "s1" })).error).toBeUndefined();
  expect((await pool.query("SELECT name FROM tools")).rows).toEqual([{ name: "spade" }]);
  expect((await pool.query("SELECT page FROM visits")).rows).toEqual([{ page: "tables" }]);
});
