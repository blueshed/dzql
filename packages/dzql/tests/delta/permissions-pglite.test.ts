/**
 * A document's owns as a path: the shared cases (src/cases/permissions.ts in delta) asked of
 * Postgres in process (PGlite), each path compiled into its document's dzql_owns function. Twice:
 * as the superuser that applies the SQL, whom row-level security never holds; and as a role it
 * does (NOSUPERUSER NOBYPASSRLS, todo #19), every read and write meeting the policies generateSql
 * derives from the same paths -- the answers the same.
 */
import { afterAll, afterEach, beforeAll, describe } from "bun:test";
import type { Pool } from "pg";
import { PGlite } from "@electric-sql/pglite";
import { applyFramework, applySql, createDocListener, docTypeFromDef, generateSql, importTables } from "../../src/postgres";
import { pglitePool } from "../../src/postgres/pglite";
import { createLocal } from "@blueshed/delta/local";
import { setLogLevel } from "@blueshed/delta/logger";
import { q } from "@blueshed/delta/backend";
import { permissionAuth, permissionCases, permissionSchema, permissionSeed, type Person } from "@blueshed/delta/testing";
import { pgliteAs } from "../helpers/pglite";

setLogLevel("silent");

let db: PGlite;
let admin: Pool;
let app: Pool;
const listeners: { destroy(): Promise<void> }[] = [];
const tables = Object.values(permissionSchema.tables).map((t) => q(t.name));

beforeAll(async () => {
  db = await PGlite.create();
  admin = pglitePool(db);
  await applyFramework(admin);
  await admin.query("CREATE ROLE dzql_app NOSUPERUSER NOBYPASSRLS");
  app = pgliteAs(db, "dzql_app");
});
afterAll(async () => { await db.close(); });
afterEach(async () => { for (const l of listeners.splice(0)) await l.destroy(); });

/** The cases' process on `pool`: the SQL applied and the rows seeded by the superuser, the documents served on `pool`. */
const on = (pool: () => Pool) => () => ({
  async start(docs: Parameters<typeof generateSql>[1]) {
    await applySql(admin, generateSql(permissionSchema, docs));   // a path it cannot follow throws here, naming the document
    await admin.query("GRANT USAGE ON SCHEMA public TO dzql_app; GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO dzql_app; GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO dzql_app");
    await admin.query(`TRUNCATE ${tables.join(", ")}, _delta_versions, _delta_ops_log, _delta_ledger RESTART IDENTITY`);
    await importTables(admin, permissionSchema, permissionSeed);
    const types = docs.map((def) => docTypeFromDef<Person>(def, pool(), { auth: permissionAuth }));
    const local = createLocal();
    listeners.push(await createDocListener(local.server, pool(), { types, auth: permissionAuth, ledger: true }));
    return { as: (person?: Person) => local.as(person), onPublish: local.onPublish };
  },
});

describe("pglite", () => permissionCases("pglite", on(() => admin)));
describe("pglite, as a role row-level security holds", () => permissionCases("pglite as dzql_app", on(() => app)));
