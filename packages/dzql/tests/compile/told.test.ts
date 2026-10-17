/**
 * Compiled telling answers what the framework answers. For every name the path
 * cases open, and a write that touches every row the tables hold (each version
 * of a temporal one), with rows made up beside them, in every way a touch
 * concerns a document -- the row arrives, stays with every field changed, one
 * or none, is carried along, leaves, or arrives as no row --
 * `dzql_told__<prefix>` tells the ops the framework's `_delta_told` told, an
 * error included, on the seed and after writes of every kind. Then the telling
 * through them: delta's own cases (tests/delta) run with the compiled telling
 * in place.
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
import { compileTold, toldFunction } from "../../src/compile/told";

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

let pool: Pool;

beforeAll(async () => {
  pool = await sharedPglite();
  await applyFramework(pool);
  await applySql(pool, generateSql(pathSchema, docs));   // the compiled telling, and _delta_told sending each to its own
  await importTables(pool, pathSchema, pathSeed);
});
afterAll(async () => { await pool.end(); });

/** A write touching every row the tables hold, and rows made up beside them, in every way a touch concerns a document. */
async function touches(): Promise<unknown[]> {
  const all = names;
  const out: unknown[] = [];
  for (const [coll, t] of Object.entries(pathSchema.tables)) {
    const held = (await pool.query(`SELECT to_jsonb(t.*) - 'valid_from' - 'valid_to' - 'override' AS row FROM "${t.name}" t ORDER BY t.id${t.temporal ? ", t.valid_from" : ""}`)).rows.map((r) => r.row);
    const made: Record<string, unknown>[] = [{ id: 900 }];
    if (t.parent) made.push({ id: 901, [t.parent.fkColumn]: 404 });
    for (const row of [...held, ...made]) {
      const one = Object.keys(row).find((k) => k !== "id");
      out.push(
        { coll, id: row.id, before: [], holders: all, after: row },                                       // arrives
        { coll, id: row.id, before: all, holders: all, after: row, was: {} },                             // stays, every field changed
        { coll, id: row.id, before: all, holders: all, after: row, was: one ? { ...row, [one]: "was" } : row },   // one field changed
        { coll, id: row.id, before: all, holders: all, after: row, was: row },                            // none
        { coll, id: row.id, before: all, holders: all, after: row, was: {}, carried: true },              // carried, held either way
        { coll, id: row.id, before: [], holders: all, after: row, carried: true },                        // carried in
        { coll, id: row.id, before: all, holders: [], after: null },                                      // leaves
        { coll, id: row.id, before: [], holders: [], after: row },                                        // no concern of anyone's
      );
    }
    out.push({ coll, id: 905, before: [], holders: all, after: null });                                    // arrives as no row
  }
  return out;
}

const prefixOf = (name: string) => docs.filter((d) => name.startsWith(d.prefix)).sort((a, b) => b.prefix.length - a.prefix.length)[0]!.prefix;

/** What a name is told of the write, or the error. */
async function told(name: string, rows: unknown[]): Promise<unknown> {
  try {
    const { rows: [{ ops }] } = await pool.query(`SELECT ${toldFunction(prefixOf(name))}($1, $2::jsonb) AS ops`, [name, JSON.stringify(rows)]);
    return ops;
  } catch (err: any) {
    return { error: err.message };
  }
}

function sameTold() {
  for (const name of names) {
    test(name, async () => {
      expect({ name, told: await told(name, await touches()) }).toMatchSnapshot();
    });
  }
}

describe("on the seed, every name is told what the framework tells it", () => sameTold());

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
  sameTold();
});

describe("the compiled text", () => {
  test("is the same for the same definitions, and pinned", () => {
    expect(compileTold(pathSchema, docs)).toBe(compileTold(pathSchema, docs));
    expect(compileTold(pathSchema, docs)).toMatchSnapshot();
  });

  test("_delta_told sends each document to its own, and refuses a name of none", () => {
    const sql = compileTold(pathSchema, docs);
    expect(sql).toContain(`WHEN 'fo-board:' THEN RETURN ${toldFunction("fo-board:")}(p_target, p_rows);`);
    expect(sql).toContain("ELSE RAISE EXCEPTION 'no doc def for: %', p_target USING ERRCODE = 'P0001';");
  });
});
