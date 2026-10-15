/**
 * Compiled ledger reads answer what the framework's answer.
 *
 * A document read whole -- what an entry's inverse and a walk's guard read:
 * for every name the path cases open, `_delta_open` (the compiled document's
 * whole open) and `_delta_open_framework(name, TRUE)` give the same, an error
 * included, on the seed and after writes; and read shown, the same as
 * `delta_open` has always been.
 *
 * A field the same in two values, a time by the instant it names: for every
 * collection, every field (and one there is not), and pairs of values (times
 * in other zones, text that is no time, numbers, nulls, missing), with
 * nothing declared, the app's own declared, and another version's (a time
 * field declared as text, a text one as a time) -- `_delta_same` and
 * `_delta_same_framework` agree.
 *
 * A row beyond a document as it stands: for every collection, and one there
 * is not, every id (each version), one not there, and none.
 *
 * Then every write and walk through them: delta's own cases (tests/delta),
 * undo and redo among them, run with them in place.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Pool } from "pg";
import { createLocal } from "@blueshed/delta/local";
import { setLogLevel } from "@blueshed/delta/logger";
import { pathDocs, pathPublicDocs, pathSchema, pathSeed } from "@blueshed/delta/testing";
import { applyFramework, applySql, createDocListener, docTypeFromDef, generateSql, importTables } from "../../src/postgres";
import { openPglite } from "../../src/postgres/pglite";
import { compileLedger } from "../../src/compile/ledger";

setLogLevel("silent");

const docs = [...pathDocs, ...pathPublicDocs];
const tables = Object.entries(pathSchema.tables);
const names = [
  "fo-board:1", "fo-board:2", "fo-board:99", "fo-board:abc", "fo-menu:1", "fo-household:1", "fo-household:3", "fo-course:1", "fo-course:2",
  "fo-title:1", "fo-tagged:1", "fo-notes:1", "fo-all-courses:", "fo-catalog:", "fo-courses-noted:", "fo-courses-like:So", "fo-courses-like:X",
  "fo-menu-like:So", "fo-tags-labelled:red", "fo-seating:1", "fo-seats-kept:1", "fo-seats-kept:maybe", "fo-seats-upto:yes", "fo-seats-at:3",
  "fo-seats-at:abc", "fo-seats-wished:5", "fo-seats-wished:abc", "fo-slots-upto:5", "fo-slots-upto:abc", "fo-slots-of:1", "fo-slots-of:abc",
  "fo-slots-of:9007199254740992", "fo-slots-under:1", "fo-slots-by:2026-01-02", "fo-slots-by:notadate", "fo-slots-on:2026-01-01",
  "fo-note:1", "fo-all-notes:", "fo-drinks:1", "fo-course-guests:1", "fo-plan:1", "fo-plan:7", "fo-weddings:", "fo-guest:1:a@x", "fo-guest:1:z@x",
  "fo-seat-of:1:3", "fo-all-households:", "fo-party:1", "fo-slim:1", "fo-notes-on:2019-01-01", "fo-notes-on:2999-01-01", "fo-notes-on:notadate",
  "fo-courses-noted-on:2021-01-01", "fo-board-on:1:2021-01-01", "fo-board-on:1:2999-01-01", "fo-asks:1", "fo-asks-from:ann", "fo-pub-courses:",
  "no-such:1",
];

let pool: Pool;

beforeAll(async () => {
  pool = await openPglite();
  await applyFramework(pool);
  await applySql(pool, generateSql(pathSchema, docs));   // the compiled ledger reads
  await importTables(pool, pathSchema, pathSeed);
});
afterAll(async () => { await pool.end(); });

/** A call's answer, or its error. */
async function answer(sql: string, params: unknown[]): Promise<unknown> {
  try {
    return (await pool.query(sql, params)).rows[0].r;
  } catch (err: any) {
    return { error: err.message };
  }
}

function sameOpens() {
  for (const name of names) {
    test(name, async () => {
      const whole = await answer("SELECT _delta_open($1, TRUE) AS r", [name]);
      expect({ name, whole }).toEqual({ name, whole: await answer("SELECT _delta_open_framework($1, TRUE) AS r", [name]) });
      const shown = await answer("SELECT _delta_open($1, FALSE) AS r", [name]);
      expect({ name, shown }).toEqual({ name, shown: await answer("SELECT _delta_open_framework($1, FALSE) AS r", [name]) });
    });
  }
}

describe("on the seed, every document reads whole as the framework reads it", () => sameOpens());

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
    await write("fo-all-courses:", [{ op: "remove", path: "/courses/2" }]);
    await write("fo-all-households:", [{ op: "replace", path: "/households/2/weddings_id", value: 2 }]);
    await listener.destroy();
  });
  sameOpens();

  test("a row beyond a document as it stands, for every collection and one there is not", async () => {
    for (const coll of [...tables.map(([c]) => c), "no_such"]) {
      const t = pathSchema.tables[coll];
      const ids = t ? (await pool.query(`SELECT DISTINCT id FROM "${t.name}" ORDER BY id`)).rows.map((r) => Number(r.id)) : [];
      for (const id of [...ids, 404, null]) {
        const compiled = await answer("SELECT _delta_row_standing($1, $2) AS r", [coll, id]);
        expect({ coll, id, row: compiled }).toEqual({ coll, id, row: await answer("SELECT _delta_row_standing_framework($1, $2) AS r", [coll, id]) });
      }
    }
  });
});

/** Values a field of a row may hold, two at a time. */
const VALUES: unknown[] = ["2026-01-01T10:00:00Z", "2026-01-01T11:00:00+01:00", "2026-01-01 10:00:00+00", "2026-01-01T10:00:01Z", "2026-01-02",
  "not a time", "x", 5, 5.0, 6, true, null];

describe("a field the same in two values, as the framework says", () => {
  const declaredOf = (tweak: (cols: Record<string, any>) => Record<string, any>) =>
    JSON.stringify(Object.fromEntries(tables.map(([c, t]) => [c, tweak({ ...t.columns })])));
  const declarations: [string, string][] = [
    ["none declared", ""],
    ["the app's own", declaredOf((c) => c)],
    ["another version's", declaredOf((c) => Object.fromEntries(Object.entries(c).map(([k, d]) =>
      [k, { ...d, type: d.type === "timestamptz" ? "text" : d.type === "text" ? "timestamptz" : d.type }])))],
    ["another version's, a collection left out", JSON.stringify({})],
  ];
  for (const [label, declared] of declarations) {
    test(label, async () => {
      const c = await pool.connect();
      try {
        await c.query("SELECT set_config('delta.declared', $1, false)", [declared]);
        for (const [coll, t] of [...tables, ["no_such", { columns: {} }] as const]) {
          for (const field of [...Object.keys(t.columns), "no_such_field"]) {
            const pairs = VALUES.flatMap((a) => VALUES.map((b) => [a, b]));
            const run = async (fn: string) => {
              try {
                return (await c.query(`SELECT array_agg(${fn}($1, $2, p->0, p->1) ORDER BY n) AS r FROM jsonb_array_elements($3::jsonb) WITH ORDINALITY AS x(p, n)`,
                  [coll, field, JSON.stringify(pairs)])).rows[0].r;
              } catch (err: any) {
                return { error: err.message };
              }
            };
            expect({ coll, field, same: await run("_delta_same") }).toEqual({ coll, field, same: await run("_delta_same_framework") });
          }
        }
      } finally {
        await c.query("SELECT set_config('delta.declared', '', false)");
        c.release();
      }
    });
  }
});

describe("the compiled text", () => {
  test("is the same for the same definitions, and pinned", () => {
    expect(compileLedger(pathSchema, docs)).toBe(compileLedger(pathSchema, docs));
    expect(compileLedger(pathSchema, docs)).toMatchSnapshot();
  });
});
