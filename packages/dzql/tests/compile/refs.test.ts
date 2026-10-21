/**
 * Compiled references (delta's `refs`): `_delta_refs_hold`, which delta_apply asks once a write's ops
 * are applied. What it answers is delta's `refsCases` (tests/delta/writes.test.ts), every write and
 * walk through it; here, a schema with no refs asks nothing, one with them is applied and holds,
 * and the text is pinned.
 */
import { afterAll, beforeAll, expect, test } from "bun:test";
import type { Pool } from "pg";
import { setLogLevel } from "@blueshed/delta/logger";
import { cinemaApp, pathSchema } from "@blueshed/delta/testing";
import { applyFramework, applySql, generateSql, importTables } from "../../src/postgres";
import { sharedPglite } from "../helpers/pglite";
import { compileRefs } from "../../src/compile/refs";

setLogLevel("silent");

let pool: Pool;
beforeAll(async () => {
  pool = await sharedPglite();
  await applyFramework(pool);
  await applySql(pool, generateSql(cinemaApp.schema, cinemaApp.docs));
  await importTables(pool, cinemaApp.schema, cinemaApp.seed);
});
afterAll(async () => { await pool.end(); });

test("a schema whose collections name none asks nothing", () => {
  expect(compileRefs(pathSchema)).toContain("NULL;   -- no collection names another");
});

test("applied, it holds a showing's film there and a film named while it is", async () => {
  const hold = (touched: unknown[]) => pool.query("SELECT _delta_refs_hold($1::jsonb)", [JSON.stringify(touched)]);
  await hold([{ coll: "case_showings", id: 1, after: {} }]);   // film 1 and usher 1 are there
  await hold([{ coll: "case_films", id: 2, after: null }]);   // film 2 is named by none, and there: asked nothing
  await expect(hold([{ coll: "case_films", id: 1, after: null, carried: true }])).resolves.toBeDefined();   // a carried row is not asked
  await pool.query("UPDATE case_films SET id = 9 WHERE id = 2");
  await expect(hold([{ coll: "case_showings", id: 1, was: { film: 1, usher: 1 }, after: {} }])).resolves.toBeDefined();   // its values as they were: asked nothing
  await pool.query("UPDATE case_showings SET film = 2 WHERE id = 1 AND valid_to IS NULL");
  await expect(hold([{ coll: "case_showings", id: 1, was: { film: 1, usher: 1 }, after: {} }])).rejects.toThrow("Row not found: case_films/2 -- case_showings/1's film names it");
});

test("the text is pinned", () => {
  expect(compileRefs(cinemaApp.schema)).toMatchSnapshot();
});
