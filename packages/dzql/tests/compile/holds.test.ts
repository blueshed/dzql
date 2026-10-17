/**
 * Compiled holds answer what the framework answers. For every name the path
 * cases open, every collection, and every row the tables hold (each version of
 * a temporal one), with rows made up beside them (a parent not there, a key
 * that is null, another wedding's): `dzql_holds__<prefix>` gives the answer the
 * framework's `_delta_doc_holds` gave, an error included, on the seed and after
 * writes of every kind. Then the fan-out through them: delta's own cases
 * (tests/delta) run with the compiled holds in place.
 *
 * The framework's answers are recorded (the snapshot, taken 16 October 2026
 * while the framework was applied and the two were held equal). The framework
 * retired (todo #26); its answers stay the measure.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Pool } from "pg";
import { createLocal } from "@blueshed/delta/local";
import { setLogLevel } from "@blueshed/delta/logger";
import { pathDocs, pathPublicDocs, pathSchema, pathSeed } from "@blueshed/delta/testing";
import { applyFramework, applySql, createDocListener, docTypeFromDef, generateSql, importTables } from "../../src/postgres";
import { sharedPglite } from "../helpers/pglite";
import { compileHolds, holdsFunction } from "../../src/compile/holds";

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
const colls = Object.keys(pathSchema.tables);

let pool: Pool;

beforeAll(async () => {
  pool = await sharedPglite();
  await applyFramework(pool);
  await applySql(pool, generateSql(pathSchema, docs));   // the compiled holds, and _delta_doc_holds sending each to its own
  await importTables(pool, pathSchema, pathSeed);
});
afterAll(async () => { await pool.end(); });

/** Every row the tables hold, each version, and rows made up beside them: by collection. */
async function rowsOf(): Promise<Record<string, unknown[]>> {
  const out: Record<string, unknown[]> = {};
  for (const [coll, t] of Object.entries(pathSchema.tables)) {
    const held = (await pool.query(`SELECT to_jsonb(t.*) AS row FROM "${t.name}" t ORDER BY t.id${t.temporal ? ", t.valid_from" : ""}`)).rows.map((r) => r.row);
    const made: unknown[] = [{ id: 900 }];
    if (t.parent) made.push({ id: 901, [t.parent.fkColumn]: 404 }, { id: 902, [t.parent.fkColumn]: null }, { id: 903, [t.parent.fkColumn]: 2 });
    out[coll] = [...held, ...made];
  }
  return out;
}

const prefixOf = (name: string) => docs.filter((d) => name.startsWith(d.prefix)).sort((a, b) => b.prefix.length - a.prefix.length)[0]!.prefix;

/** Each answer for a name, over every collection and row, or the error. */
async function answers(name: string, rows: Record<string, unknown[]>): Promise<unknown> {
  const call = `${holdsFunction(prefixOf(name))}($1, c.coll, r.row)`;
  const cases = colls.flatMap((coll) => rows[coll]!.map((row) => ({ coll, row })));
  try {
    const { rows: [{ a }] } = await pool.query(
      `SELECT array_agg(${call} ORDER BY c.i) AS a FROM jsonb_array_elements($2::jsonb) WITH ORDINALITY AS c0(x, i), LATERAL (SELECT c0.i, c0.x->>'coll' AS coll) c, LATERAL (SELECT c0.x->'row' AS row) r`,
      [name, JSON.stringify(cases)],
    );
    return a;
  } catch (err: any) {
    return { error: err.message };
  }
}

function sameHolds() {
  for (const name of names) {
    test(name, async () => {
      const rows = await rowsOf();
      expect({ name, holds: await answers(name, rows) }).toMatchSnapshot();
    });
  }
}

describe("on the seed, every name holds what the framework says it holds", () => sameHolds());

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
  });
  sameHolds();
});

describe("the compiled text", () => {
  test("is the same for the same definitions, and pinned", () => {
    expect(compileHolds(pathSchema, docs)).toBe(compileHolds(pathSchema, docs));
    expect(compileHolds(pathSchema, docs)).toMatchSnapshot();
  });

  test("_delta_doc_holds sends each document to its own, and refuses a name of none", () => {
    const sql = compileHolds(pathSchema, docs);
    expect(sql).toContain(`WHEN 'fo-board:' THEN RETURN ${holdsFunction("fo-board:")}(p_doc_name, p_coll, p_row);`);
    expect(sql).toContain("ELSE RAISE EXCEPTION 'no doc def for: %', p_doc_name USING ERRCODE = 'P0001';");
  });
});
