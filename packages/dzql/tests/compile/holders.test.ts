/**
 * The compiled fan-out answers what the framework answers. With every name the
 * path cases open held open, for every collection and every row the tables
 * hold (each version of a temporal one), with rows made up beside them, and
 * for each writer: `_delta_holders` (compiled) and `_delta_holders_framework`
 * name the same documents, an error included, on the seed, after writes of
 * every kind, and with documents registered by hand beside the compiled ones
 * (one a longer prefix that takes some of a compiled document's names), and
 * with no name open but the writer's. Then
 * the fan-out through it: delta's own cases (tests/delta) run with it in place.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Pool } from "pg";
import { createLocal } from "@blueshed/delta/local";
import { setLogLevel } from "@blueshed/delta/logger";
import { pathDocs, pathPublicDocs, pathSchema, pathSeed } from "@blueshed/delta/testing";
import { applyFramework, applySql, createDocListener, docTypeFromDef, generateSql, importTables } from "../../src/postgres";
import { openPglite } from "../../src/postgres/pglite";
import { compileHolders } from "../../src/compile/holders";

setLogLevel("silent");

const docs = [...pathDocs, ...pathPublicDocs];
const names = [
  "fo-board:1", "fo-board:2", "fo-board:99", "fo-board:abc", "fo-menu:1", "fo-household:1", "fo-household:3", "fo-course:1", "fo-course:2",
  "fo-title:1", "fo-tagged:1", "fo-notes:1", "fo-all-courses:", "fo-catalog:", "fo-courses-noted:", "fo-courses-like:So", "fo-courses-like:X",
  "fo-menu-like:So", "fo-tags-labelled:red", "fo-seating:1", "fo-seats-kept:1", "fo-seats-kept:maybe", "fo-seats-upto:yes", "fo-seats-at:3",
  "fo-seats-at:abc", "fo-seats-wished:5", "fo-seats-wished:abc", "fo-slots-upto:5", "fo-slots-upto:abc", "fo-slots-of:1", "fo-slots-of:abc",
  "fo-slots-of:9007199254740992", "fo-slots-under:1", "fo-slots-by:2026-01-02", "fo-slots-by:notadate", "fo-slots-on:2026-01-01",
  "fo-note:1", "fo-all-notes:", "fo-drinks:1", "fo-course-guests:1", "fo-plan:1", "fo-plan:7", "fo-weddings:", "fo-guest:1:a@x", "fo-guest:1:z@x",
  "fo-seat-of:1:3", "fo-all-households:", "fo-party:1", "fo-slim:1", "fo-notes-on:2019-01-01", "fo-notes-on:2999-01-01", "fo-notes-on:notadate",
  "fo-courses-noted-on:2021-01-01", "fo-board-on:1:2021-01-01", "fo-board-on:1:2999-01-01", "fo-asks:1", "fo-asks-from:ann", "fo-pub-courses:",
];
const writers = [null, "fo-board:1", "fo-all-courses:", "fo-guest:1:a@x", "fo-board:99", "fo-course:2"];

let pool: Pool;

beforeAll(async () => {
  pool = await openPglite();
  await applyFramework(pool);
  await applySql(pool, generateSql(pathSchema, docs));   // the compiled fan-out
  await importTables(pool, pathSchema, pathSeed);
  for (const name of names) await pool.query("INSERT INTO _delta_held (doc_name, holder) VALUES ($1, 1) ON CONFLICT DO NOTHING", [name]);
});
afterAll(async () => { await pool.end(); });

/** Every row the tables hold, each version, and rows made up beside them: by collection. */
async function rowsOf(): Promise<Record<string, unknown[]>> {
  const out: Record<string, unknown[]> = {};
  for (const [coll, t] of Object.entries(pathSchema.tables)) {
    const held = (await pool.query(`SELECT to_jsonb(t.*) AS row FROM "${t.name}" t`)).rows.map((r) => r.row);
    const made: unknown[] = [{ id: 900 }];
    if (t.parent) made.push({ id: 901, [t.parent.fkColumn]: 404 }, { id: 902, [t.parent.fkColumn]: null }, { id: 903, [t.parent.fkColumn]: 2 });
    out[coll] = [...held, ...made, null];
  }
  return out;
}

/** The names holding each row of a collection, for a writer: compiled or framework, each sorted, or the error. */
async function holders(compiled: boolean, coll: string, rows: unknown[], writer: string | null): Promise<unknown> {
  const call = compiled ? "_delta_holders($1, r.row, $3)" : "_delta_holders_framework($1, r.row, $3, ARRAY[]::text[])";
  try {
    const { rows: [{ a }] } = await pool.query(
      `SELECT array_agg((SELECT COALESCE(string_agg(n, ' ' ORDER BY n), '') FROM unnest(${call}) AS n) ORDER BY r.i) AS a
         FROM jsonb_array_elements($2::jsonb) WITH ORDINALITY AS r(row, i)`,
      [coll, JSON.stringify(rows), writer],
    );
    return a;
  } catch (err: any) {
    return { error: err.message };
  }
}

function sameHolders() {
  for (const coll of Object.keys(pathSchema.tables)) {
    test(coll, async () => {
      const rows = (await rowsOf())[coll]!;
      for (const writer of writers) {
        const framework = await holders(false, coll, rows, writer);
        expect({ coll, writer, holders: await holders(true, coll, rows, writer) }).toEqual({ coll, writer, holders: framework });
      }
    });
  }
}

describe("on the seed, every row is held by the documents the framework names", () => sameHolders());

describe("with no name open, the writer's own alone", () => {
  beforeAll(async () => { await pool.query("DELETE FROM _delta_held"); });
  afterAll(async () => {
    for (const name of names) await pool.query("INSERT INTO _delta_held (doc_name, holder) VALUES ($1, 1) ON CONFLICT DO NOTHING", [name]);
  });
  sameHolders();
});

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
      { op: "remove", path: "/notes/1" },
    ]);
    await write("fo-course:1", [{ op: "add", path: "/drinks/-", value: { name: "Port" } }]);
    await write("fo-all-households:", [{ op: "replace", path: "/households/2/weddings_id", value: 2 }]);
    await listener.destroy();
    for (const name of names) await pool.query("INSERT INTO _delta_held (doc_name, holder) VALUES ($1, 1) ON CONFLICT DO NOTHING", [name]);
  });
  sameHolders();
});

describe("with documents registered by hand beside the compiled ones, still", () => {
  beforeAll(async () => {
    const board = docs.find((d) => d.prefix === "fo-board:")!;
    // a longer prefix that takes fo-board:1 (a list, now, of every board) from the compiled fo-board:, and one of its own
    await pool.query("INSERT INTO _delta_docs (prefix, root_collection, include, scope) SELECT 'fo-board:1', root_collection, include, scope FROM _delta_docs WHERE prefix = 'fo-board:'");
    await pool.query("INSERT INTO _delta_docs (prefix, root_collection, include, scope) VALUES ('fo-hand:', $1, $2::text[], '{}')", [board.root, `{${board.include.join(",")}}`]);
    for (const name of ["fo-hand:1", "fo-hand:2", "fo-hand:"]) await pool.query("INSERT INTO _delta_held (doc_name, holder) VALUES ($1, 1) ON CONFLICT DO NOTHING", [name]);
  });
  sameHolders();
});

describe("the compiled text", () => {
  test("is the same for the same definitions, and pinned", () => {
    expect(compileHolders(pathSchema, docs)).toBe(compileHolders(pathSchema, docs));
    expect(compileHolders(pathSchema, docs)).toMatchSnapshot();
  });

  test("asks the framework for any document not compiled here", () => {
    expect(compileHolders(pathSchema, docs)).toContain("_delta_holders_framework(p_coll, p_row, p_writer, ARRAY['fo-board:'");
  });
});
