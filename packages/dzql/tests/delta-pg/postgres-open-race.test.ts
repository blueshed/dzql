/**
 * Two servers opening one new database at once (two stores, each its own pool, on the suite's
 * Postgres server): without a turn each would make the schema, the framework's types and the
 * compiled functions together, which Postgres refuses (a type made twice), and each would find the
 * database new and seed it. `openStore` takes its own turn, an advisory lock around everything it
 * does as it opens -- the migrations, the framework, the compiled SQL, `prepare` -- so the second
 * waits, then finds it done: one schema, one history, one seed. In a schema of its own
 * (`namespace`), made by the first, so the suite's other files are untouched. PGlite is one
 * process's, one session, so this is the server's (`test:pg`); the turn itself is shown on PGlite
 * in app-store-pglite.test.ts.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Pool } from "pg";
import { setLogLevel } from "@blueshed/delta/logger";
import { createTable } from "@blueshed/delta/migrations";
import { defineDoc, defineSchema, importTables, openStore } from "../../src/postgres";
import { PG_URL } from "./setup";

setLogLevel("silent");

const namespace = "open_race";
const schema = defineSchema({ race_notes: { columns: { text: "text" }, temporal: false } });
const docs = [defineDoc("race-notes:", { root: "race_notes", include: [] })];
const history = [{ id: "001-notes", changes: [createTable("race_notes", { columns: { text: { type: "text" } }, temporal: false })] }];

/** A server's store: the history, the documents, and a seed for a database that holds no rows yet. */
function server() {
  const store = openStore({
    schema, database: PG_URL, namespace,
    migrations: { app: "notes", list: history, schema },
    prepare: async (pool) => {
      if ((await pool.query("SELECT 1 FROM race_notes")).rowCount) return;
      await importTables(pool, schema, { tables: { race_notes: [{ id: 1, text: "kept before" }] } });
    },
  });
  store.register(docs);
  return store;
}

describe("a Postgres server: two servers opening one new database at once", () => {
  let admin: Pool;
  const stores = [server(), server()];
  const drop = () => admin.query(`DROP SCHEMA IF EXISTS ${namespace} CASCADE`);

  beforeAll(async () => {
    admin = new Pool({ connectionString: PG_URL, max: 2 });
    await drop();
  });
  afterAll(async () => {
    for (const store of stores) await store.close();
    await drop();
    await admin.end();
  });

  test("each opens: the second waits its turn, then finds the history run, the documents compiled and the rows seeded", async () => {
    await Promise.all(stores.map((store) => store.open()));
    expect((await admin.query(`SELECT app, id FROM ${namespace}.delta_migrations`)).rows).toEqual([{ app: "notes", id: "001-notes" }]);
    expect((await admin.query(`SELECT id::int, text FROM ${namespace}.race_notes`)).rows).toEqual([{ id: 1, text: "kept before" }]);
    // both serve the one database: a write through one is read through the other
    expect((await stores[0]!.owner.call("delta", { doc: "race-notes:", ops: [{ op: "add", path: "/race_notes/-", value: { text: "from the first" } }] })).error).toBeUndefined();
    const read = (await stores[1]!.owner.call("open", { doc: "race-notes:" })).result.race_notes;
    expect(Object.values(read).map((n: any) => n.text)).toEqual(["kept before", "from the first"]);
  });
});
