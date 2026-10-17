/**
 * Compiled cascades, hanging rows, and an add's row.
 *
 * Until the framework retired (todo #26, 16 October 2026) every collection's
 * cascades, the rows a remove takes, the rows hanging from a row, and an add's
 * row stored were run by the framework and by the compiled functions in turn,
 * for every id its table held, on the seed and after writes, and gave the same
 * answers and left every table the same. Those answers carried the write's own
 * time, so they were not recorded: the cascades are held by delta's own cases
 * (tests/delta), every remove and walk through them, against what delta answers.
 *
 * Here: a row that gives every declared column is stored by its collection's
 * own INSERT; one that gives fewer, by the columns it gives (a column it leaves
 * out takes its database default); a collection there is not has nothing to
 * take and nothing hanging from it; and the text is pinned.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Pool } from "pg";
import { setLogLevel } from "@blueshed/delta/logger";
import { pathDocs, pathPublicDocs, pathSchema, pathSeed } from "@blueshed/delta/testing";
import { applyFramework, applySql, generateSql, importTables } from "../../src/postgres";
import { sharedPglite } from "../helpers/pglite";
import { compileCascades } from "../../src/compile/cascades";

setLogLevel("silent");

const docs = [...pathDocs, ...pathPublicDocs];
const tables = Object.entries(pathSchema.tables);

let pool: Pool;

beforeAll(async () => {
  pool = await sharedPglite();
  await applyFramework(pool);
  await applySql(pool, generateSql(pathSchema, docs));   // the compiled cascades and rows
  await importTables(pool, pathSchema, pathSeed);
});
afterAll(async () => { await pool.end(); });

describe("an add's row, for every collection", () => {
  for (const [coll, t] of tables) {
    test(coll, async () => {
      const c = await pool.connect();
      try {
        await c.query("BEGIN");
        const ts = (await c.query("SELECT now()::text AS ts")).rows[0].ts;
        const some = (await c.query(`SELECT to_jsonb(t.*) - 'valid_from' - 'valid_to' AS r FROM "${t.name}" t ORDER BY id LIMIT 1`)).rows[0]?.r;
        if (!some) return;
        const full = (id: number) => ({ ...some, id, ...(t.temporal ? { valid_from: ts, valid_to: null } : {}) });
        const add = async (row: unknown) => (await c.query("SELECT _delta_row_add($1, $2, $3::jsonb) AS r", [coll, t.name, JSON.stringify(row)])).rows[0].r;
        // every declared column given: its own INSERT, never the one by the columns given
        await c.query("SAVEPOINT w");
        await c.query(`CREATE OR REPLACE FUNCTION _delta_row_add_given(p_table TEXT, p_row JSONB) RETURNS JSONB LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'stored by the columns given'; END $$`);
        expect({ coll, id: (await add(full(953))).id }).toEqual({ coll, id: 953 });
        await c.query("ROLLBACK TO SAVEPOINT w");
        // fewer: by the columns it gives, the rest their defaults
        const [first] = Object.keys(t.columns);
        if (first && t.columns[first]!.nullable) {
          const fewer: Record<string, unknown> = full(954);
          delete fewer[first];
          const stored = await add(fewer);
          expect({ coll, id: stored.id, [first]: stored[first] }).toEqual({ coll, id: 954, [first]: null });
        }
      } finally {
        await c.query("ROLLBACK");
        c.release();
      }
    });
  }
});

test("a collection there is not: nothing to take, nothing hanging from it", async () => {
  for (const fn of ["_delta_cascade_remove", "_delta_cascade_rows", "_delta_hanging_rows"]) {
    expect((await pool.query(`SELECT ${fn}('no_such', 1) AS r`)).rows[0].r).toEqual([]);
  }
});

describe("the compiled text", () => {
  test("is the same for the same schema, and pinned", () => {
    expect(compileCascades(pathSchema)).toBe(compileCascades(pathSchema));
    expect(compileCascades(pathSchema)).toMatchSnapshot();
  });

  test("two collections that would share a function name are refused", async () => {
    const { defineSchema } = await import("../../src/postgres");
    expect(() => compileCascades(defineSchema({ A_b: { table: "upper_ab", columns: { x: "text" } }, a_b: { columns: { x: "text" } } }))).toThrow("would share the function name");
  });
});
