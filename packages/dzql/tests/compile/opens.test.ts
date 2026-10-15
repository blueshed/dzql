/**
 * Compiled opens answer what the framework answers. Over delta's path schema
 * and documents (@blueshed/delta/testing), every name the path cases open is
 * opened by `delta_open` (the framework SQL reading its tables of definitions)
 * and by `dzql_open` (compiled from the definitions), on PGlite, and the two
 * must be equal -- an error included -- on the seed and again after writes of
 * every kind: adds, a field and a whole row replaced, a temporal row removed,
 * a row moved to another parent.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Pool } from "pg";
import { createLocal } from "@blueshed/delta/local";
import { setLogLevel } from "@blueshed/delta/logger";
import { pathDocs, pathPublicDocs, pathSchema, pathSeed } from "@blueshed/delta/testing";
import { applyFramework, applySql, createDocListener, docTypeFromDef, generateSql, importTables } from "../../src/postgres";
import { openPglite } from "../../src/postgres/pglite";
import { compileOpens, openFunction } from "../../src/compile/opens";

setLogLevel("silent");

const docs = [...pathDocs, ...pathPublicDocs];

/** The names the path cases open, of the documents compiled (the custom documents are not: their reads are the app's own). */
const names = [
  "fo-board:1", "fo-board:2", "fo-board:99", "fo-menu:1", "fo-menu:2", "fo-household:1", "fo-household:3", "fo-household:99",
  "fo-course:1", "fo-course:2", "fo-course:10", "fo-title:1", "fo-title:7", "fo-tagged:1", "fo-notes:1", "fo-notes:2",
  "fo-all-courses:", "fo-catalog:", "fo-courses-noted:", "fo-courses-like:So", "fo-courses-like:X", "fo-menu-like:So",
  "fo-tags-labelled:red", "fo-tags-labelled:blue", "fo-tags-labelled:007", "fo-seating:1",
  "fo-seats-kept:1", "fo-seats-kept:0", "fo-seats-kept:yes", "fo-seats-kept:maybe", "fo-seats-upto:yes", "fo-seats-upto:off",
  "fo-seats-at:3", "fo-seats-at:05", "fo-seats-at:3.5", "fo-seats-at:abc", "fo-seats-wished:5", "fo-seats-wished:[1, 2]", "fo-seats-wished:abc",
  "fo-slots-upto:5", "fo-slots-upto:1.5", "fo-slots-upto:1e0", "fo-slots-of:1", "fo-slots-of:01", "fo-slots-of:1.5", "fo-slots-of:abc",
  "fo-slots-of:9007199254740992", "fo-slots-under:1", "fo-slots-under:-1", "fo-slots-by:2026-01-02", "fo-slots-by:2025-12-31",
  "fo-slots-on:2026-01-01", "fo-slots-on:garbage",
  "fo-note:1", "fo-all-notes:", "fo-drinks:1", "fo-drinks:2", "fo-course-guests:1",
  "fo-plan:1", "fo-plan:7", "fo-plan:50", "fo-weddings:", "fo-guest:1:a@x", "fo-guest:1:z@x", "fo-seat-of:1:3",
  "fo-all-households:", "fo-party:1", "fo-slim:1",
  "fo-notes-on:2019-01-01", "fo-notes-on:2021-01-01", "fo-notes-on:2021-02-30", "fo-notes-on:notadate", "fo-notes-on:today",
  "fo-courses-noted-on:2021-01-01", "fo-board-on:1:2021-01-01", "fo-board-on:1:2021-13-01", "fo-board-on:1:2999-01-01",
  "fo-asks:1", "fo-asks-from:ann", "fo-pub-courses:", "nobody:1",
];

let pool: Pool;

beforeAll(async () => {
  pool = await openPglite();
  await applyFramework(pool);
  await applySql(pool, generateSql(pathSchema, docs));
  await importTables(pool, pathSchema, pathSeed);
  await applySql(pool, compileOpens(pathSchema, docs));
});
afterAll(async () => { await pool.end(); });

/** What an open answers: its document, or its error's message. */
async function opened(fn: string, name: string): Promise<unknown> {
  try {
    return (await pool.query(`SELECT ${fn}($1) AS doc`, [name])).rows[0].doc;
  } catch (err: any) {
    return { error: err.message };
  }
}

function sameOpens() {
  for (const name of names) {
    test(name, async () => {
      expect({ name, doc: await opened("dzql_open", name) }).toEqual({ name, doc: await opened("delta_open", name) });
    });
  }
}

describe("on the seed, every name opens as the framework opens it", () => sameOpens());

describe("after writes of every kind, still", () => {
  beforeAll(async () => {
    const local = createLocal();
    const listener = await createDocListener(local.server, pool, { types: docs.map((def) => docTypeFromDef(def, pool)), ledger: true });
    const write = async (doc: string, ops: unknown[]) => {
      await local.call("open", { doc });
      const r = await local.call("delta", { doc, ops });
      expect(r.error).toBeUndefined();
    };
    await write("fo-board:1", [
      { op: "add", path: "/courses/-", value: { name: "Fish" } },
      { op: "add", path: "/notes/-", value: { text: "and tables" } },
      { op: "replace", path: "/households/1/email", value: "aa@x" },
      { op: "remove", path: "/notes/1" },
    ]);
    await write("fo-course:1", [{ op: "add", path: "/drinks/-", value: { name: "Port" } }, { op: "replace", path: "/drinks/1", value: { name: "Fino" } }]);
    await write("fo-all-households:", [{ op: "replace", path: "/households/2/weddings_id", value: 2 }]);
    await write("fo-plan:7", [{ op: "replace", path: "/weddings/name", value: "planned" }]);
    await listener.destroy();
  });
  sameOpens();
});

describe("the compiled text", () => {
  test("is the same for the same definitions, byte for byte", () => {
    expect(compileOpens(pathSchema, docs)).toBe(compileOpens(pathSchema, docs));
  });

  test("is pinned: a change to what it writes shows in review", () => {
    expect(compileOpens(pathSchema, docs)).toMatchSnapshot();
  });

  test("names a function for each document, and dzql_open finds the longest prefix first", () => {
    const sql = compileOpens(pathSchema, docs);
    for (const d of docs) expect(sql).toContain(`CREATE OR REPLACE FUNCTION ${openFunction(d.prefix)}(p_name TEXT)`);
    expect(sql.indexOf(`'fo-courses-noted-on:'`)).toBeLessThan(sql.indexOf(`starts_with(p_name, 'fo-courses-noted:')`));
  });

  test("a document over a collection the schema does not have is refused, naming both", () => {
    expect(() => compileOpens(pathSchema, [{ ...pathDocs[0]!, include: ["nowhere"] }])).toThrow("fo-board: names a collection the schema does not have: nowhere");
  });

  test("two documents whose functions would share a name are refused", () => {
    expect(() => compileOpens(pathSchema, [pathDocs[0]!, { ...pathDocs[0]!, prefix: "fo_board:" }])).toThrow("would share the function dzql_open__fo_board");
  });
});
