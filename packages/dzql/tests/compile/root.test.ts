/**
 * The compiled root check answers what the framework answers. For every name
 * the path cases open, and names made to probe each check, and for every id
 * the root's table holds (each version of a temporal one), ids it does not,
 * and none: `dzql_root_there__<prefix>` says what the framework's root check
 * said, an error included, on the seed and after writes that close and remove
 * roots. Then every write through it: delta's own cases (tests/delta) run with
 * it in place.
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
import { compileRootThere, rootThereFunction } from "../../src/compile/root";

setLogLevel("silent");

const docs = [...pathDocs, ...pathPublicDocs];
const paths = [
  "fo-board:1", "fo-board:2", "fo-board:99", "fo-board:abc", "fo-menu:1", "fo-household:1", "fo-household:3", "fo-course:1", "fo-course:2",
  "fo-title:1", "fo-tagged:1", "fo-notes:1", "fo-all-courses:", "fo-catalog:", "fo-courses-noted:", "fo-courses-like:So", "fo-courses-like:X",
  "fo-menu-like:So", "fo-tags-labelled:red", "fo-seating:1", "fo-seats-kept:1", "fo-seats-kept:maybe", "fo-seats-upto:yes", "fo-seats-at:3",
  "fo-seats-at:abc", "fo-seats-wished:5", "fo-seats-wished:abc", "fo-slots-upto:5", "fo-slots-upto:abc", "fo-slots-of:1", "fo-slots-of:abc",
  "fo-slots-of:9007199254740992", "fo-slots-under:1", "fo-slots-by:2026-01-02", "fo-slots-by:notadate", "fo-slots-on:2026-01-01",
  "fo-note:1", "fo-all-notes:", "fo-drinks:1", "fo-course-guests:1", "fo-plan:1", "fo-plan:7", "fo-weddings:", "fo-guest:1:a@x", "fo-guest:1:z@x",
  "fo-seat-of:1:3", "fo-all-households:", "fo-party:1", "fo-slim:1", "fo-notes-on:2019-01-01", "fo-notes-on:2999-01-01", "fo-notes-on:notadate",
  "fo-courses-noted-on:2021-01-01", "fo-board-on:1:2021-01-01", "fo-board-on:1:2999-01-01", "fo-asks:1", "fo-asks-from:ann", "fo-pub-courses:",
];
/**
 * Each value a check reads, put in every place of every document's name: one hand-picked row per
 * kind (an id, a sign, zero, past 2^53, not whole, text, empty, a date the calendar has not). The
 * full matrix the framework was compared over retired with it (17 October).
 */
const probes = ["1", "+3", "0", "9007199254740992", "1.5", "abc", "", "2026-02-30"];
const names = [...new Set([
  ...paths,
  ...docs.flatMap((d) => {
    const places = Math.max(1, new Set(Object.values(d.scope ?? {}).flat().map((b) => b.replace(/^[a-z<>=!]*:+/, ""))).size);
    return probes.flatMap((p) => Array.from({ length: places }, (_, i) => d.prefix + Array.from({ length: places }, (_, j) => (i === j ? p : "1")).join(":")));
  }),
])];

let pool: Pool;

beforeAll(async () => {
  pool = await sharedPglite();
  await applyFramework(pool);
  await applySql(pool, generateSql(pathSchema, docs));   // the compiled root check, and _delta_root_there sending each to its own
  await importTables(pool, pathSchema, pathSeed);
});
afterAll(async () => { await pool.end(); });

const prefixOf = (name: string) => docs.filter((d) => name.startsWith(d.prefix)).sort((a, b) => b.prefix.length - a.prefix.length)[0]!.prefix;

/** Every id the root's table holds (each version), ids it does not, and none. */
async function idsOf(prefix: string): Promise<(number | null)[]> {
  const table = pathSchema.tables[docs.find((d) => d.prefix === prefix)!.root]!.name;
  const held = (await pool.query(`SELECT DISTINCT id FROM "${table}" ORDER BY id`)).rows.map((r) => Number(r.id));
  return [...held, 0, 404, null];
}

/** Whether each id's root is there for a name: the answers, or the error. */
async function there(name: string, ids: (number | null)[]): Promise<unknown> {
  const call = `${rootThereFunction(prefixOf(name))}($1, i.id)`;
  try {
    const { rows: [{ a }] } = await pool.query(
      `SELECT array_agg(${call} ORDER BY i.n) AS a FROM jsonb_array_elements($2::jsonb) WITH ORDINALITY AS e(x, n), LATERAL (SELECT e.n, (e.x #>> '{}')::BIGINT AS id) i`,
      [name, JSON.stringify(ids)],
    );
    return a;
  } catch (err: any) {
    return { error: err.message };
  }
}

function sameThere() {
  for (const name of names) {
    test(name, async () => {
      const ids = await idsOf(prefixOf(name));
      expect({ name, there: await there(name, ids) }).toMatchSnapshot();
    });
  }
}

describe("on the seed, every root is there where the framework finds it", () => sameThere());

describe("after writes that close and remove roots, still", () => {
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
  sameThere();
});

describe("the compiled text", () => {
  test("is the same for the same definitions, and pinned", () => {
    expect(compileRootThere(pathSchema, docs)).toBe(compileRootThere(pathSchema, docs));
    expect(compileRootThere(pathSchema, docs)).toMatchSnapshot();
  });

  test("_delta_root_there sends each document to its own, and refuses a name of none", () => {
    const sql = compileRootThere(pathSchema, docs);
    expect(sql).toContain(`WHEN 'fo-board:' THEN RETURN ${rootThereFunction("fo-board:")}(p_doc_name, p_id);`);
    expect(sql).toContain("ELSE RAISE EXCEPTION 'no doc def for: %', p_doc_name USING ERRCODE = 'P0001';");
  });
});
