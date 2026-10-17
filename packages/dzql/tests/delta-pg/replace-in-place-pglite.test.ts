/**
 * A replace on a table that keeps no versions is an UPDATE of the row (`_delta_row_put`), on Postgres
 * in this process (PGlite): an app's UPDATE trigger sees it, and a DELETE trigger does not. It had been
 * a delete and an insert, so the Shed's guard on UPDATE never fired (its run 2, stage 5).
 */
import { afterAll, beforeAll, expect, test } from "bun:test";
import type { Pool } from "pg";
import { createWs } from "@blueshed/delta/server";
import { setLogLevel } from "@blueshed/delta/logger";
import { mockClient, sendAndAwait } from "@blueshed/delta/testing";
import { applyFramework, applySql, createDocListener, defineDoc, defineSchema, docTypeFromDef, generateSql, importTables } from "../../src/postgres";
import { openPglite } from "../../src/postgres/pglite";

setLogLevel("silent");

const schema = defineSchema({ tools: { columns: { name: "text" }, temporal: false } });
const docs = [defineDoc("shed:", { root: "tools", include: [] })];

let pool: Pool;
let ws: ReturnType<typeof createWs>;
let listener: Awaited<ReturnType<typeof createDocListener>>;

beforeAll(async () => {
  pool = await openPglite();
  await applyFramework(pool);
  await applySql(pool, generateSql(schema, docs));
  await importTables(pool, schema, { tables: { tools: [{ id: 1, name: "spade" }] } });
  await pool.query(`
    CREATE TABLE heard (op TEXT NOT NULL);
    CREATE FUNCTION hear() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN INSERT INTO heard VALUES (TG_OP); RETURN COALESCE(NEW, OLD); END $$;
    CREATE TRIGGER tools_heard BEFORE INSERT OR UPDATE OR DELETE ON tools FOR EACH ROW EXECUTE FUNCTION hear();`);
  ws = createWs();
  ws.setServer({ publish() {} });
  listener = await createDocListener(ws, pool, { types: docs.map((def) => docTypeFromDef(def, pool)) });
}, 30_000);
afterAll(async () => { await listener.destroy(); await pool.end(); });

test("a replace of a row, and of a field, is an UPDATE: no DELETE, no INSERT", async () => {
  const c = mockClient();
  await sendAndAwait(ws, c, { action: "open", doc: "shed:" });
  const whole = await sendAndAwait(ws, c, { action: "delta", doc: "shed:", ops: [{ op: "replace", path: "/tools/1", value: { name: "fork" } }] });
  expect(whole.error).toBeUndefined();
  const field = await sendAndAwait(ws, c, { action: "delta", doc: "shed:", ops: [{ op: "replace", path: "/tools/1/name", value: "hoe" }] });
  expect(field.error).toBeUndefined();
  expect((await pool.query("SELECT op FROM heard")).rows.map((r) => r.op)).toEqual(["UPDATE", "UPDATE"]);
  expect((await pool.query("SELECT id, name FROM tools")).rows).toEqual([{ id: 1, name: "hoe" }]);
});
