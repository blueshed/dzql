/**
 * Compiled row SQL does what the framework's does. For every collection, and
 * every id its table holds (each version of a temporal one), an id it does
 * not, and none: the row locked, whether it is there, a replace's row stored
 * (the row again, a row changed, a row not there, a row missing what it must
 * have, and a second replace in the same write), an add's id minted, and a
 * version this write made taken back -- each run by the framework's and by the
 * compiled function in turn, inside one transaction (so both see the same
 * now()), rolled back to the same savepoint between: the same answer, the same
 * error, and the table left the same. Then every write through them: delta's
 * own cases (tests/delta) run with them in place.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Pool, PoolClient } from "pg";
import { createLocal } from "@blueshed/delta/local";
import { setLogLevel } from "@blueshed/delta/logger";
import { pathDocs, pathPublicDocs, pathSchema, pathSeed } from "@blueshed/delta/testing";
import { applyFramework, applySql, createDocListener, docTypeFromDef, generateSql, importTables } from "../../src/postgres";
import { openPglite } from "../../src/postgres/pglite";
import { compileRows } from "../../src/compile/rows";

setLogLevel("silent");

const docs = [...pathDocs, ...pathPublicDocs];
const tables = Object.entries(pathSchema.tables);

let pool: Pool;

beforeAll(async () => {
  pool = await openPglite();
  await applyFramework(pool);
  await applySql(pool, generateSql(pathSchema, docs));   // the compiled row SQL
  await importTables(pool, pathSchema, pathSeed);
});
afterAll(async () => { await pool.end(); });

type Step = (c: PoolClient, fn: (name: string) => string, ts: string) => Promise<unknown>;

/** Run `steps` with the framework's functions, then the compiled, each from the same savepoint: what each answered, and the table after. */
async function both(c: PoolClient, table: string, steps: Step[]): Promise<{ compiled: unknown; framework: unknown }> {
  const ts = (await c.query("SELECT now()::text AS ts")).rows[0].ts;
  const run = async (framework: boolean) => {
    const fn = (name: string) => (framework ? `${name}_framework` : name);
    await c.query("SAVEPOINT s");
    const answers: unknown[] = [];
    try {
      for (const step of steps) answers.push(await step(c, fn, ts));
      answers.push({ table: (await c.query(`SELECT COALESCE(jsonb_agg(to_jsonb(t.*) ORDER BY to_jsonb(t.*)::text), '[]') AS rows FROM "${table}" t`)).rows[0].rows });
    } catch (err: any) {
      answers.push({ error: err.message });
    }
    await c.query("ROLLBACK TO SAVEPOINT s");
    return answers;
  };
  return { framework: await run(true), compiled: await run(false) };
}

/** Every id the table holds, one it does not, and none. */
async function idsOf(c: PoolClient, table: string): Promise<(number | null)[]> {
  return [...(await c.query(`SELECT DISTINCT id FROM "${table}" ORDER BY id`)).rows.map((r) => Number(r.id)), 404, null];
}

function sameRows() {
  for (const [coll, t] of tables) {
    test(coll, async () => {
      const c = await pool.connect();
      try {
        await c.query("BEGIN");
        const args = `$1, $2, $3`;
        for (const id of await idsOf(c, t.name)) {
          const params = [coll, t.name, t.temporal];
          const lock: Step = async (c, fn) => (await c.query(`SELECT ${fn("_delta_row_lock")}(${args}, $4) AS r`, [...params, id])).rows[0].r;
          const there: Step = async (c, fn) => (await c.query(`SELECT ${fn("_delta_row_there")}($1, $2) AS r`, [coll, id])).rows[0].r;
          const r1 = await both(c, t.name, [lock, there]);
          expect({ coll, id, answers: r1.compiled }).toEqual({ coll, id, answers: r1.framework });

          // a replace's row stored: the row again, changed, twice in one write, or a row missing what it must have
          const current = (await c.query(`SELECT to_jsonb(t.*) - 'valid_from' - 'valid_to' AS r FROM "${t.name}" t WHERE id = $1${t.temporal ? " AND valid_to IS NULL" : ""}`, [id])).rows[0]?.r
            ?? { id: id ?? 405, ...(t.parent ? { [t.parent.fkColumn]: 1 } : {}) };
          const text = Object.entries(t.columns).find(([, d]) => d.type === "text")?.[0];
          const changed = text ? { ...current, [text]: "changed" } : current;
          const put = (row: unknown): Step => async (c, fn, ts) =>
            (await c.query(`SELECT ${fn("_delta_row_put")}(${args}, $4, $5::jsonb, $6::timestamptz) AS r`, [...params, id, JSON.stringify(row), ts])).rows[0].r;
          for (const steps of [[put(current)], [put(changed)], [put(current), put(changed)], [put({ id })]]) {
            const r = await both(c, t.name, steps);
            expect({ coll, id, answers: r.compiled }).toEqual({ coll, id, answers: r.framework });
          }

          // a version this write made and took back, cleared so an add of its id takes its place
          if (t.temporal && id !== null) {
            const made: Step = async (c, _fn, ts) => {
              await c.query(`INSERT INTO "${t.name}" SELECT * FROM jsonb_populate_record(null::"${t.name}", $1::jsonb)`,
                [JSON.stringify({ ...current, id, valid_from: ts, valid_to: ts })]);
              return "made";
            };
            const clear: Step = async (c, fn, ts) => (await c.query(`SELECT ${fn("_delta_row_clear_moment")}($1, $2, $3, $4::timestamptz)::text AS r`, [coll, t.name, id, ts])).rows[0].r;
            const r = await both(c, t.name, [made, clear]);
            expect({ coll, id, answers: r.compiled }).toEqual({ coll, id, answers: r.framework });
          }
        }

        // an add's id: the next of the collection's sequence, by either
        const seq = `seq_${t.name}`;
        const framework = Number((await c.query("SELECT _delta_next_id_framework($1, $2) AS id", [coll, t.name])).rows[0].id);
        await c.query("SELECT setval($1, $2, false)", [seq, framework]);
        const compiled = Number((await c.query("SELECT _delta_next_id($1, $2) AS id", [coll, t.name])).rows[0].id);
        expect({ coll, id: compiled }).toEqual({ coll, id: framework });
      } finally {
        await c.query("ROLLBACK");
        c.release();
      }
    });
  }
}

describe("on the seed, every collection's row SQL does what the framework's does", () => sameRows());

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
  sameRows();
});

describe("the compiled text", () => {
  test("is the same for the same schema, and pinned", () => {
    expect(compileRows(pathSchema)).toBe(compileRows(pathSchema));
    expect(compileRows(pathSchema)).toMatchSnapshot();
  });

  test("a collection it was not compiled for goes to the framework's", () => {
    const sql = compileRows(pathSchema);
    for (const fn of ["_delta_row_lock", "_delta_row_put", "_delta_next_id", "_delta_row_clear_moment", "_delta_row_there"]) {
      expect(sql).toContain(`${fn}_framework(`);
    }
  });
});
