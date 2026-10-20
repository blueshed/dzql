/**
 * `registerDocs` on Postgres takes what delta's SQLite `registerDocs(ws, db, schema, docs,
 * customDocs, options)` takes (root todo #37): the documents compiled into the database and served
 * in one call, so an app moving from SQLite changes its import. delta's permission cases through
 * it, in this process (PGlite); and its refusals, by its own name, as SQLite's.
 */
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import type { Pool } from "pg";
import { createLocal } from "@blueshed/delta/local";
import { setLogLevel } from "@blueshed/delta/logger";
import { defineDoc, q } from "@blueshed/delta/backend";
import { permissionAuth, permissionCases, permissionSchema, permissionSeed, type Person } from "@blueshed/delta/testing";
import { applyFramework, importTables, registerDocs } from "../../src/postgres";
import { openPglite } from "../../src/postgres/pglite";
import { postgresInbox } from "./helpers/postgres-reads";

setLogLevel("silent");

let pool: Pool;
const listeners: { destroy(): Promise<void> }[] = [];
const tables = Object.values(permissionSchema.tables).map((t) => q(t.name));

beforeAll(async () => { pool = await openPglite(); await applyFramework(pool); });
afterAll(async () => { await pool.end(); });
afterEach(async () => { for (const l of listeners.splice(0)) await l.destroy(); });

describe("pglite, through registerDocs", () => permissionCases("registerDocs", () => ({
  async start(docs) {
    const local = createLocal();
    const listener = await registerDocs(local.server, pool, permissionSchema, docs, [], { auth: permissionAuth, ledger: true });
    listeners.push(listener);
    await pool.query(`TRUNCATE ${tables.join(", ")}, _delta_versions, _delta_ops_log, _delta_ledger RESTART IDENTITY`);
    await importTables(pool, permissionSchema, permissionSeed);
    return { as: (person: Person) => local.as(person) };
  },
})));

describe("registerDocs refuses as SQLite's does, by its name", () => {
  const nameless = defineDoc("people:", { root: "people", include: [] });

  test("with auth, a document with no path needs owns or shared; a function or shared says it", async () => {
    await expect(registerDocs(createLocal().server, pool, permissionSchema, [nameless], [], { auth: permissionAuth })).rejects.toThrow(/registerDocs\("people:"\)/);
    const local = createLocal();
    listeners.push(await registerDocs(local.server, pool, permissionSchema, [nameless], [], { auth: permissionAuth, owns: (me: Person, name) => name === `people:${me.id}` }));
    expect((await local.as({ id: 1, name: "Ann" }).call("open", { doc: "people:2" })).error?.code).toBe(404);
  });

  test("without auth, owns, shared or a path would guard nothing", async () => {
    await expect(registerDocs(createLocal().server, pool, permissionSchema, [nameless], [], { shared: true })).rejects.toThrow(/registerDocs/);
    await expect(registerDocs(createLocal().server, pool, permissionSchema, [defineDoc("post:", { root: "posts", include: [], owns: "@author_id" })])).rejects.toThrow(/registerDocs/);
  });

  test("custom documents beside them, as the fifth argument", async () => {
    const local = createLocal();
    const listener = await registerDocs(local.server, pool, permissionSchema, [nameless], [{ ...postgresInbox, prefix: "inbox:" }]);
    listeners.push(listener);
    expect((await local.call("delta", { doc: "inbox:x", ops: [] })).error?.code).toBe(403);   // read-only, answered by the listener
  });
});
