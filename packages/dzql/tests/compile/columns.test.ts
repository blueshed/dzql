/**
 * Compiled columns and checks answer what the framework answered.
 *
 * The columns a document writes: for every document and collection, with no
 * columns declared by the process, with the app's own declared, and with
 * another version's (a column more, a column fewer), `dzql_columns__<prefix>`
 * gives what the framework's `_delta_write_columns` gave: recorded (the
 * snapshot, taken 16 October 2026 while the framework was applied and the two
 * were held equal). The framework retired (todo #26); its answers stay the
 * measure.
 *
 * The checks: for every collection, every set of columns (all of them, each
 * document's own, and sets the compiler never saw), each parent key (the
 * schema's, none, another), and values made to probe each check -- not an
 * object, fields there are not, the parent key as every kind of value, each
 * column given every kind of value, several wrong at once --
 * `_delta_assert_fields` and the check by the columns given
 * (`_delta_assert_fields_declared`, the framework's, which stays for a set the
 * compiler never saw) accept the same values and refuse the rest with the same
 * code and message.
 *
 * Then every write through them: delta's own cases (tests/delta) run with them
 * in place.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Pool } from "pg";
import { setLogLevel } from "@blueshed/delta/logger";
import { pathDocs, pathPublicDocs, pathSchema } from "@blueshed/delta/testing";
import { applyFramework, applySql, generateSql } from "../../src/postgres";
import { sharedPglite } from "../helpers/pglite";
import { columnsFunction, compileColumns } from "../../src/compile/columns";

setLogLevel("silent");

const docs = [...pathDocs, ...pathPublicDocs];
const tables = Object.entries(pathSchema.tables);

let pool: Pool;

beforeAll(async () => {
  pool = await sharedPglite();
  await applyFramework(pool);
  await applySql(pool, generateSql(pathSchema, docs));   // the compiled columns and checks
  // a check's answer, compiled or by the columns given: ok, or its code and message
  await pool.query(`CREATE FUNCTION _t_check(p_fw BOOLEAN, p_coll TEXT, p_cols JSONB, p_fk TEXT, p_value JSONB) RETURNS TEXT AS $$
    BEGIN
      IF p_fw THEN PERFORM _delta_assert_fields_declared(p_coll, p_cols, p_fk, p_value);
      ELSE PERFORM _delta_assert_fields(p_coll, p_cols, p_fk, p_value); END IF;
      RETURN 'ok';
    EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE || ' ' || SQLERRM;
    END $$ LANGUAGE plpgsql`);
});
afterAll(async () => { await pool.end(); });

const declaredOf = (tweak: (coll: string, cols: Record<string, unknown>) => Record<string, unknown>) =>
  JSON.stringify(Object.fromEntries(tables.map(([coll, t]) => [coll, tweak(coll, { ...t.columns })])));
const declarations: [string, string | null][] = [
  ["none declared", null],
  ["the app's own", declaredOf((_, c) => c)],
  ["another version's", declaredOf((_, c) => {
    const [first] = Object.keys(c);
    if (first) delete c[first];
    return { ...c, added: { type: "text", nullable: true } };
  })],
];

describe("the columns each document writes, as the framework gives them", () => {
  for (const [label, declared] of declarations) {
    test(label, async () => {
      const client = await pool.connect();
      try {
        await client.query("SELECT set_config('delta.declared', $1, false)", [declared ?? ""]);
        for (const doc of docs) {
          for (const [coll] of tables) {
            const stored = `(SELECT columns_def FROM _delta_collections WHERE collection_key = $1)`;
            const { rows: [r] } = await client.query(
              `SELECT ${columnsFunction(doc.prefix)}($1, ${stored}) AS compiled`, [coll]);
            expect({ doc: doc.prefix, coll, cols: r.compiled }).toMatchSnapshot();
          }
        }
      } finally {
        await client.query("SELECT set_config('delta.declared', '', false)");
        client.release();
      }
    });
  }
});

/** Every kind of value a field can be given. */
const KINDS: unknown[] = ["x", "", 5, 0, -3, 1.5, 1e300, true, false, null, {}, [], "2026-01-01", "2026-01-01T10:00:00Z", "2026-01-01 10:00:00.123456+05:30",
  "2026-13-01", "2026-01-01T25:00", "not a time", "5"];

/** Values made to probe each check of a collection's columns. */
function valuesOf(columns: Record<string, unknown>, fk: string | undefined): unknown[] {
  const cols = Object.keys(columns);
  return [
    null, 5, "x", [], true,                                                   // not an object
    {}, { id: 1 }, { id: 1, valid_from: "2026-01-01", valid_to: null },      // the row's own fields
    { zz: 1 }, { zz: 1, aa: 2, "a b": 3 },                                    // fields there are not, several
    ...(fk ? KINDS.map((v) => ({ [fk]: v })) : []),                          // the parent key as every kind
    ...cols.flatMap((c) => KINDS.map((v) => ({ [c]: v }))),                   // each column as every kind
    Object.fromEntries(cols.map((c) => [c, true])),                           // all wrong at once (or right, for a boolean)
    Object.fromEntries(cols.map((c) => [c, 1.5])),
    Object.fromEntries(cols.map((c) => [c, "x"])),
    { ...Object.fromEntries(cols.map((c) => [c, 7])), zz: 1 },               // an unknown field beside them
  ];
}

describe("the checks of every collection's columns, as by the columns given", () => {
  for (const [coll, table] of tables) {
    test(coll, async () => {
      const fk = table.parent?.fkColumn;
      // the sets of columns: all, each document's own, and sets the compiler never saw
      const sets: Record<string, unknown>[] = [table.columns];
      for (const doc of docs) {
        const named = doc.columns?.[coll];
        if (named) sets.push(Object.fromEntries(Object.entries(table.columns).filter(([c]) => named.includes(c))));
      }
      const [first, ...rest] = Object.keys(table.columns);
      sets.push({}, Object.fromEntries(rest.map((c) => [c, table.columns[c]])), { ...table.columns, ...(first ? { [first]: { type: "text", nullable: true } } : {}) });
      for (const cols of sets) {
        for (const parentFk of [fk ?? null, null, "other_id"]) {
          const values = valuesOf(table.columns, fk);
          const answer = async (fw: boolean) => (await pool.query(
            `SELECT array_agg(_t_check($1, $2, $3::jsonb, $4, v) ORDER BY n) AS a FROM jsonb_array_elements($5::jsonb) WITH ORDINALITY AS e(v, n)`,
            [fw, coll, JSON.stringify(cols), parentFk, JSON.stringify(values)])).rows[0].a;
          expect({ coll, cols, parentFk, checks: await answer(false) }).toEqual({ coll, cols, parentFk, checks: await answer(true) });
        }
      }
      // and a value that is no JSON at all
      const sqlNull = async (fw: boolean) => (await pool.query("SELECT _t_check($1, $2, $3::jsonb, $4, NULL) AS a", [fw, coll, JSON.stringify(table.columns), fk ?? null])).rows[0].a;
      expect(await sqlNull(false)).toBe(await sqlNull(true));
    });
  }
});

describe("the sets of columns compiled are checked by their own statements", () => {
  test("every collection's own and each document's, with the check by the columns given gone", async () => {
    await pool.query(`CREATE OR REPLACE FUNCTION _delta_assert_fields_declared(p_collection TEXT, p_columns JSONB, p_parent_fk TEXT, p_value JSONB)
      RETURNS void LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'checked by the columns given'; END $$`);
    try {
      for (const [coll, table] of tables) {
        const sets = [table.columns, ...docs.flatMap((d) => d.columns?.[coll] ? [Object.fromEntries(Object.entries(table.columns).filter(([c]) => d.columns![coll]!.includes(c)))] : [])];
        for (const cols of sets) {
          const { rows: [{ a }] } = await pool.query("SELECT _t_check(FALSE, $1, $2::jsonb, $3, '{}'::jsonb) AS a", [coll, JSON.stringify(cols), table.parent?.fkColumn ?? null]);
          expect({ coll, cols, a }).toEqual({ coll, cols, a: "ok" });
        }
      }
    } finally {
      await applyFramework(pool);
      await applySql(pool, generateSql(pathSchema, docs));
    }
  });
});

describe("the compiled text", () => {
  test("is the same for the same definitions, and pinned", () => {
    expect(compileColumns(pathSchema, docs)).toBe(compileColumns(pathSchema, docs));
    expect(compileColumns(pathSchema, docs)).toMatchSnapshot();
  });

  test("a set of columns it never saw is checked by the columns given", () => {
    expect(compileColumns(pathSchema, docs)).toContain("PERFORM _delta_assert_fields_declared(p_collection, p_columns, p_parent_fk, p_value);");
  });
});
