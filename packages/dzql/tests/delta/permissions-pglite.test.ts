/**
 * A document's owns as a path: the shared cases (src/cases/permissions.ts in delta) asked of
 * Postgres in process (PGlite), each path compiled into its document's dzql_owns function.
 */
import { afterAll, afterEach, beforeAll, describe } from "bun:test";
import type { Pool } from "pg";
import { applyFramework, applySql, createDocListener, docTypeFromDef, generateSql, importTables } from "../../src/postgres";
import { openPglite } from "../../src/postgres/pglite";
import { createLocal } from "@blueshed/delta/local";
import { setLogLevel } from "@blueshed/delta/logger";
import { q } from "@blueshed/delta/backend";
import { permissionAuth, permissionCases, permissionSchema, permissionSeed, type Person } from "@blueshed/delta/testing";

setLogLevel("silent");

let pool: Pool;
const listeners: { destroy(): Promise<void> }[] = [];
const tables = Object.values(permissionSchema.tables).map((t) => q(t.name));

beforeAll(async () => {
  pool = await openPglite();
  await applyFramework(pool);
});
afterAll(async () => { await pool.end(); });
afterEach(async () => { for (const l of listeners.splice(0)) await l.destroy(); });

describe("pglite", () => permissionCases("pglite", () => ({
  async start(docs) {
    await applySql(pool, generateSql(permissionSchema, docs));   // a path it cannot follow throws here, naming the document
    await pool.query(`TRUNCATE ${tables.join(", ")}, _delta_versions, _delta_ops_log, _delta_ledger RESTART IDENTITY`);
    await importTables(pool, permissionSchema, permissionSeed);
    const types = docs.map((def) => docTypeFromDef<Person>(def, pool, { auth: permissionAuth }));
    const local = createLocal();
    listeners.push(await createDocListener(local.server, pool, { types, auth: permissionAuth, ledger: true }));
    return { as: (person: Person) => local.as(person) };
  },
})));
