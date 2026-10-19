/**
 * delta's write cases (@blueshed/delta/testing: the error table, a row the
 * server names, write scope) on dzql's Postgres: in this process (PGlite),
 * and on the test database the suite starts (DATABASE_URL), as on CI.
 */
import { describe } from "bun:test";
import { Pool } from "pg";
import { createWs } from "@blueshed/delta/server";
import { setLogLevel } from "@blueshed/delta/logger";
import { createRowCases, errorCodeCases, uniqueCases, writeScopeCases, type CaseApp, type CaseBackend } from "@blueshed/delta/testing";
import { applyFramework, applySql, createDocListener, docTypeFromDef, generateSql, importTables } from "../../src/postgres";
import { openPglite } from "../../src/postgres/pglite";
import { PG_URL } from "../delta-pg/setup";

setLogLevel("silent");

/** The app on a pool made ready for it: the framework, its tables and its rows. */
async function onPool(pool: Pool, { schema, docs, seed }: CaseApp) {
  await applyFramework(pool);
  await applySql(pool, generateSql(schema, docs));
  await importTables(pool, schema, seed);
  const ws = createWs();
  ws.setServer({ publish() {} });
  const listener = await createDocListener(ws, pool, { types: docs.map((def) => docTypeFromDef(def, pool)) });
  return { ws, listener };
}

const onPglite: CaseBackend = async (app) => {
  const pool = await openPglite();
  const { ws, listener } = await onPool(pool, app);
  return { ws, end: async () => { await listener.destroy(); await pool.end(); } };
};

/** The suite's test database: the app's `case_*` tables and their documents dropped before and after. */
const onServer: CaseBackend = async (app) => {
  const pool = new Pool({ connectionString: PG_URL });
  const tables = Object.values(app.schema.tables).map((t) => t.name);
  const drop = async () => {
    await pool.query(`DROP TABLE IF EXISTS ${tables.join(", ")} CASCADE`);
    await pool.query(`DROP SEQUENCE IF EXISTS ${tables.map((t) => `seq_${t}`).join(", ")}`);
    if ((await pool.query("SELECT to_regclass('_delta_docs') IS NOT NULL AS there")).rows[0].there) {
      await pool.query("DELETE FROM _delta_collections WHERE table_name = ANY($1)", [tables]);
      await pool.query("DELETE FROM _delta_docs WHERE prefix = ANY($1)", [app.docs.map((d) => d.prefix)]);
    }
  };
  await drop();
  const { ws, listener } = await onPool(pool, app);
  return { ws, end: async () => { await listener.destroy(); await drop(); await pool.end(); } };
};

for (const [name, backend] of [["PGlite", onPglite], ["a Postgres server", onServer]] as const) {
  describe(name, () => {
    errorCodeCases(backend);
    createRowCases(backend);
    writeScopeCases(backend);
    uniqueCases(backend);
  });
}
