/**
 * Compiled row SQL: each collection's row locked, whether it is there, a
 * replace's row stored, an add's id minted, a version this write made taken
 * back, a row read.
 *
 * Until the framework retired (todo #26, 16 October 2026) every one was run by
 * the framework's and by the compiled function in turn, for every collection
 * and every id its table held, on the seed and after writes, and gave the same
 * answer, the same error and the table left the same. Those answers carried the
 * write's own time and the sequences' state, so they were not recorded: the
 * row SQL is held by delta's own cases (tests/delta), every write and walk
 * through it, against what delta answers.
 *
 * Here: a collection none was compiled for is refused (a row of it is not
 * there), and the text is pinned.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Pool } from "pg";
import { setLogLevel } from "@blueshed/delta/logger";
import { pathDocs, pathPublicDocs, pathSchema, pathSeed } from "@blueshed/delta/testing";
import { applyFramework, applySql, generateSql, importTables } from "../../src/postgres";
import { sharedPglite } from "../helpers/pglite";
import { compileRows } from "../../src/compile/rows";

setLogLevel("silent");

const docs = [...pathDocs, ...pathPublicDocs];

let pool: Pool;

beforeAll(async () => {
  pool = await sharedPglite();
  await applyFramework(pool);
  await applySql(pool, generateSql(pathSchema, docs));   // the compiled row SQL
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

test("a collection none was compiled for is refused, and a row of it is not there", async () => {
  const refused = { error: "unknown collection: no_such" };
  expect(await answer("SELECT _delta_row_lock('no_such', 'no_such', FALSE, 1) AS r", [])).toEqual(refused);
  expect(await answer("SELECT _delta_row_put('no_such', 'no_such', FALSE, 1, '{}', now()) AS r", [])).toEqual(refused);
  expect(await answer("SELECT _delta_next_id('no_such', 'no_such') AS r", [])).toEqual(refused);
  expect(await answer("SELECT _delta_row_clear_moment('no_such', 'no_such', 1, now())::text AS r", [])).toEqual(refused);
  expect(await answer("SELECT _delta_row_read('no_such', 'no_such', 1) AS r", [])).toEqual(refused);
  expect(await answer("SELECT _delta_row_add('no_such', 'no_such', '{}') AS r", [])).toEqual(refused);
  expect(await answer("SELECT _delta_row_there('no_such', 1) AS r", [])).toBe(false);
});

describe("the compiled text", () => {
  test("is the same for the same schema, and pinned", () => {
    expect(compileRows(pathSchema)).toBe(compileRows(pathSchema));
    expect(compileRows(pathSchema)).toMatchSnapshot();
  });
});
