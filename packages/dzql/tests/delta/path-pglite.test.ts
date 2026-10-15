/**
 * The path's third place: Postgres in this process (PGlite). The same stored
 * functions as a Postgres server, the same listener, delta's published cases
 * (`pathCases`, @blueshed/delta/testing) -- no database to run.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe } from "bun:test";
import type { Pool } from "pg";
import {
  applyFramework, applySql, createDocListener, docTypeFromDef, exportTables, generateSql, importTables,
} from "../../src/postgres";
import { openPglite } from "../../src/postgres/pglite";
import { createLocal } from "@blueshed/delta/local";
import { setLogLevel } from "@blueshed/delta/logger";
import {
  pathCases, pathDocs, pathPublicDocs, pathSchema, pathSeed, type PathBackend,
} from "@blueshed/delta/testing";
import { postgresEmails, postgresGuests, postgresInbox, postgresMenuCard, postgresOpenSeats } from "./postgres-reads";
import { q } from "@blueshed/delta/backend";

setLogLevel("silent");

let pool: Pool;
const listeners: { destroy(): Promise<void> }[] = [];
let backend: PathBackend;
const tables = Object.values(pathSchema.tables).map((t) => q(t.name));

beforeAll(async () => {
  pool = await openPglite();
  await applyFramework(pool);
  await applySql(pool, generateSql(pathSchema, [...pathDocs, ...pathPublicDocs]));
});

afterAll(async () => {
  await pool.end();
});

beforeEach(async () => {
  await pool.query(`TRUNCATE ${tables.join(", ")}, _delta_versions, _delta_ops_log, _delta_ledger RESTART IDENTITY`);
  await importTables(pool, pathSchema, pathSeed);
  const local = createLocal();
  const heard: { channel: string; data: any }[] = [];
  local.onPublish((channel, data) => heard.push({ channel, data }));
  listeners.push(await createDocListener(local.server, pool, { types: [...pathDocs, ...pathPublicDocs].map((def) => docTypeFromDef(def, pool)), ledger: true, custom: [postgresInbox, postgresOpenSeats, postgresMenuCard, postgresEmails, postgresGuests] }));
  backend = {
    process: { call: (action, msg) => local.call(action, msg), heard },
    // NOTIFY is heard after the write's commit, and fetched then: a beat.
    quiet: () => new Promise((r) => setTimeout(r, 100)),
    exportTables: () => exportTables(pool, pathSchema),
    storeSetsT: async () => {
      await pool.query("CREATE FUNCTION fo_t() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.t := upper(NEW.email); RETURN NEW; END $$");
      await pool.query("CREATE TRIGGER fo_t BEFORE INSERT OR UPDATE ON fo_households FOR EACH ROW EXECUTE FUNCTION fo_t()");
      return async () => void await pool.query("DROP FUNCTION fo_t() CASCADE");
    },
  };
});

afterEach(async () => {
  for (const l of listeners.splice(0)) await l.destroy();
});

describe("pglite", () => pathCases(() => backend));
