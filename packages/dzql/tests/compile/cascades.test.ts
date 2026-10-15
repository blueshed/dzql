/**
 * Compiled cascades, hanging rows, and an add's row do what the framework's do.
 * For every collection and every id its table holds (each version of a
 * temporal one), one it does not, and none: the rows a remove would take, the
 * remove itself, the rows that hang from the row, the row read; and an add's
 * row stored, giving every column the schema declares or fewer, under an id
 * free or taken. Each is run by the framework (its dispatchers pointed back at
 * it, so its recursion stays its own) and by the compiled functions in turn,
 * in one transaction from the same savepoint: the same answer, the same error,
 * and every table left the same. And a row giving every declared column is
 * stored without the framework. Then every write through them: delta's own
 * cases (tests/delta) run with them in place.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Pool, PoolClient } from "pg";
import { createLocal } from "@blueshed/delta/local";
import { setLogLevel } from "@blueshed/delta/logger";
import { pathDocs, pathPublicDocs, pathSchema, pathSeed } from "@blueshed/delta/testing";
import { applyFramework, applySql, createDocListener, docTypeFromDef, generateSql, importTables } from "../../src/postgres";
import { openPglite } from "../../src/postgres/pglite";
import { compileCascades } from "../../src/compile/cascades";

setLogLevel("silent");

const docs = [...pathDocs, ...pathPublicDocs];
const tables = Object.entries(pathSchema.tables);

/** The framework's dispatchers, as the framework SQL makes them: its recursion stays its own. */
const FRAMEWORK = ["_delta_cascade_remove", "_delta_cascade_rows", "_delta_hanging_rows"].map((name) =>
  `CREATE OR REPLACE FUNCTION ${name}(p_collection_key TEXT, p_id BIGINT) RETURNS JSONB LANGUAGE sql AS $$ SELECT ${name}_framework(p_collection_key, p_id); $$;`).join("\n");

let pool: Pool;

beforeAll(async () => {
  pool = await openPglite();
  await applyFramework(pool);
  await applySql(pool, generateSql(pathSchema, docs));   // the compiled cascades and rows
  await importTables(pool, pathSchema, pathSeed);
});
afterAll(async () => { await pool.end(); });

/** Every table's rows, in a fixed order. */
const everything = async (c: PoolClient) => {
  const out: Record<string, unknown> = {};
  for (const [, t] of tables) out[t.name] = (await c.query(`SELECT COALESCE(jsonb_agg(to_jsonb(t.*) ORDER BY to_jsonb(t.*)::text), '[]') AS r FROM "${t.name}" t`)).rows[0].r;
  return out;
};

type Step = (c: PoolClient, fw: (name: string) => string, ts: string) => Promise<unknown>;

/** `steps` by the framework, then by the compiled, each from the same savepoint: the answers, and every table after. */
async function both(c: PoolClient, steps: Step[]) {
  const ts = (await c.query("SELECT now()::text AS ts")).rows[0].ts;
  const run = async (framework: boolean) => {
    await c.query("SAVEPOINT s");
    const answers: unknown[] = [];
    try {
      if (framework) await c.query(FRAMEWORK);
      for (const step of steps) answers.push(await step(c, (name) => (framework ? `${name}_framework` : name), ts));
      answers.push(await everything(c));
    } catch (err: any) {
      answers.push({ error: err.message });
    }
    await c.query("ROLLBACK TO SAVEPOINT s");
    return answers;
  };
  return { framework: await run(true), compiled: await run(false) };
}

function same() {
  for (const [coll, t] of tables) {
    test(coll, async () => {
      const c = await pool.connect();
      try {
        await c.query("BEGIN");
        const ids = [...(await c.query(`SELECT DISTINCT id FROM "${t.name}" ORDER BY id`)).rows.map((r) => Number(r.id)), 404, null];
        const view = t.temporal ? `current_${t.name}` : t.name;
        for (const id of ids) {
          const call = (name: string, extra = ""): Step => async (c, fw) => (await c.query(`SELECT ${fw(name)}($1${extra}, $2) AS r`, extra ? [coll, view, id] : [coll, id])).rows[0].r;
          const read: Step = async (c, fw) => (await c.query(`SELECT ${fw("_delta_row_read")}($1, $2, $3) AS r`, [coll, view, id])).rows[0].r;
          for (const steps of [
            [call("_delta_cascade_rows"), call("_delta_hanging_rows"), read],
            [call("_delta_cascade_rows"), call("_delta_cascade_remove"), call("_delta_cascade_rows")],   // what it takes, taking it, nothing left
            [call("_delta_cascade_remove"), call("_delta_cascade_remove")],                              // a second remove takes nothing
          ]) {
            const r = await both(c, steps);
            expect({ coll, id, answers: r.compiled }).toEqual({ coll, id, answers: r.framework });
          }
        }

        // an add's row: every declared column, fewer, under an id free or taken
        const ts = (await c.query("SELECT now()::text AS ts")).rows[0].ts;
        const some = (await c.query(`SELECT to_jsonb(t.*) - 'valid_from' - 'valid_to' AS r FROM "${t.name}" t ORDER BY id LIMIT 1`)).rows[0]?.r;
        if (some) {
          const full = (id: number) => ({ ...some, id, ...(t.temporal ? { valid_from: ts, valid_to: null } : {}) });
          const [first] = Object.keys(t.columns);
          const fewer = (id: number) => { const r: Record<string, unknown> = full(id); if (first) delete r[first]; return r; };
          const add = (row: unknown): Step => async (c, fw) => (await c.query(`SELECT ${fw("_delta_row_add")}($1, $2, $3::jsonb) AS r`, [coll, t.name, JSON.stringify(row)])).rows[0].r;
          for (const steps of [[add(full(950))], [add(fewer(951))], [add(full(Number(some.id)))], [add(full(952)), add(full(952))]]) {
            const r = await both(c, steps);
            expect({ coll, answers: r.compiled }).toEqual({ coll, answers: r.framework });
          }
          // every declared column given: stored without the framework
          await c.query("SAVEPOINT w");
          await c.query(`CREATE OR REPLACE FUNCTION _delta_row_add_framework(p_coll TEXT, p_table TEXT, p_row JSONB) RETURNS JSONB LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'the framework was asked'; END $$`);
          const stored = (await c.query("SELECT _delta_row_add($1, $2, $3::jsonb) AS r", [coll, t.name, JSON.stringify(full(953))])).rows[0].r;
          expect({ coll, id: stored.id }).toEqual({ coll, id: 953 });
          await c.query("ROLLBACK TO SAVEPOINT w");
        }
      } finally {
        await c.query("ROLLBACK");
        c.release();
      }
    });
  }
}

describe("on the seed, every collection's cascades and rows do what the framework's do", () => same());

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
  same();
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
