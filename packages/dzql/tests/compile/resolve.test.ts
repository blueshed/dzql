/**
 * Compiled scope resolution answers what the framework answers. For every name
 * the path cases open, and names made to probe each check (signs, spaces,
 * zeros, numbers past 2^53, numbers that are not whole, text where an id goes,
 * dates the calendar has not, values left empty): `dzql_scope__<prefix>` gives
 * the JSON the framework's resolver gave -- where, values, mode, at, and what
 * was refused -- or the same error, raised or answered. It reads no table, so
 * the seed is the only state. Then every caller through it: delta's own cases
 * (tests/delta) run with it in place.
 *
 * The framework's answers are recorded (the snapshot, taken 16 October 2026
 * while the framework was applied and the two were held equal). The framework
 * retired (todo #26); its answers stay the measure.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Pool } from "pg";
import { setLogLevel } from "@blueshed/delta/logger";
import { pathDocs, pathPublicDocs, pathSchema } from "@blueshed/delta/testing";
import { applyFramework, applySql, generateSql } from "../../src/postgres";
import { sharedPglite } from "../helpers/pglite";
import { compileResolve, resolveFunction } from "../../src/compile/resolve";

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
/** Each value a check reads, put in every place of every document's name. */
// one hand-picked row per kind; the full matrix the framework was compared over retired with it (17 October)
const probes = ["1", " 2 ", "+3", "-4", "0", "9007199254740992", "1.5", "abc", "a'b", "", "2026-02-29", "2024-02-29", "true"];
const names = [...new Set([
  ...paths,
  ...docs.flatMap((d) => {
    const places = Math.max(1, new Set(Object.values(d.scope ?? {}).map((b) => b.replace(/^[a-z<>=!]*:+/, ""))).size);
    return probes.flatMap((p) => Array.from({ length: places }, (_, i) => d.prefix + Array.from({ length: places }, (_, j) => (i === j ? p : "1")).join(":")));
  }),
])];

let pool: Pool;

beforeAll(async () => {
  pool = await sharedPglite();
  await applyFramework(pool);
  await applySql(pool, generateSql(pathSchema, docs));   // the compiled resolver, and _delta_resolve_scope sending each to its own
});
afterAll(async () => { await pool.end(); });

const prefixOf = (name: string) => docs.filter((d) => name.startsWith(d.prefix)).sort((a, b) => b.prefix.length - a.prefix.length)[0]!.prefix;

/** A name resolved, refusing or answering: the JSON, or the error. */
async function resolved(name: string, refuse: boolean): Promise<unknown> {
  try {
    const { rows: [{ r }] } = await pool.query(`SELECT ${resolveFunction(prefixOf(name))}($1, $2) AS r`, [name, refuse]);
    return r;
  } catch (err: any) {
    return { error: err.message, code: err.code };
  }
}

describe("every name resolves as the framework resolved it", () => {
  for (const name of names) {
    test(name, async () => {
      for (const refuse of [true, false]) expect({ name, refuse, scope: await resolved(name, refuse) }).toMatchSnapshot();
    });
  }
});

describe("the compiled text", () => {
  test("is the same for the same definitions, and pinned", () => {
    expect(compileResolve(pathSchema, docs)).toBe(compileResolve(pathSchema, docs));
    expect(compileResolve(pathSchema, docs)).toMatchSnapshot();
  });

  test("_delta_resolve_scope sends each document to its own, and refuses a name of none", () => {
    const sql = compileResolve(pathSchema, docs);
    expect(sql).toContain(`WHEN 'fo-board:' THEN RETURN ${resolveFunction("fo-board:")}(p_doc_name, p_refuse);`);
    expect(sql).toContain("ELSE RAISE EXCEPTION 'no doc def for: %', p_doc_name USING ERRCODE = 'P0001';");
  });
});
