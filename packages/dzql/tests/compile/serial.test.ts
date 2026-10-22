/**
 * A table's serial never leaves it unable to mint an id.
 *
 * An add may name its id (delta's cases keep 2^53 - 1: no number holds one past it). Named, the id
 * moves the table's serial past it, so a later `add /<coll>/-` does not meet it -- but only up to
 * a bound below 2^53 - 1 (`_delta_serial_past`), leaving room to mint: once, an add of 2^53 - 1
 * moved the serial there, the next mint was 2^53, which no path can name, and that table's new
 * rows could never be replaced or removed. And a mint that would pass 2^53 - 1 is refused
 * (`_delta_next_id`), never a row no number holds.
 */
import { afterAll, beforeAll, expect, test } from "bun:test";
import type { Pool } from "pg";
import { setLogLevel } from "@blueshed/delta/logger";
import { pathDocs, pathPublicDocs, pathSchema, pathSeed } from "@blueshed/delta/testing";
import { applyFramework, applySql, generateSql, importTables } from "../../src/postgres";
import { sharedPglite } from "../helpers/pglite";

setLogLevel("silent");

const MAX = 9007199254740991;   // 2^53 - 1

let pool: Pool;

beforeAll(async () => {
  pool = await sharedPglite();
  await applyFramework(pool);
  await applySql(pool, generateSql(pathSchema, [...pathDocs, ...pathPublicDocs]));
  await importTables(pool, pathSchema, pathSeed);
});
afterAll(async () => { await pool.end(); });

const apply = async (doc: string, ops: unknown[]) => (await pool.query("SELECT delta_apply($1, $2::jsonb) AS r", [doc, JSON.stringify(ops)])).rows[0].r;
const serial = async (seq: string) => BigInt((await pool.query(`SELECT last_value::text AS v FROM "${seq}"`)).rows[0].v);

test("an add of 2^53 - 1 is kept, and the table still mints an id it can name: added, replaced and removed", async () => {
  const named = await apply("fo-board:1", [{ op: "add", path: `/courses/${MAX}`, value: { name: "Fish" } }]);
  expect(named.ops[0].path).toBe(`/courses/${MAX}`);
  expect(await serial("seq_fo_courses")).toBeLessThan(BigInt(MAX));   // the serial left room

  const minted = await apply("fo-board:1", [{ op: "add", path: "/courses/-", value: { name: "Cod" } }]);
  const id = Number(minted.ops[0].path.split("/")[2]);
  expect(Number.isSafeInteger(id)).toBe(true);
  expect((await apply("fo-board:1", [{ op: "replace", path: `/courses/${id}/name`, value: "Hake" }])).ops).toHaveLength(1);
  expect((await apply("fo-board:1", [{ op: "remove", path: `/courses/${id}` }])).ops[0]).toEqual({ op: "remove", path: `/courses/${id}` });
  // and the named one too
  expect((await apply("fo-board:1", [{ op: "remove", path: `/courses/${MAX}` }])).ops[0]).toEqual({ op: "remove", path: `/courses/${MAX}` });
});

test("a named id below the bound moves the serial past it, as ever", async () => {
  await apply("fo-board:1", [{ op: "add", path: "/drinks/5000", value: { name: "Port", courses_id: 1 } }]);
  expect(await serial("seq_fo_drinks")).toBe(5000n);
});

test("a mint that would pass 2^53 - 1 is refused, and makes no row", async () => {
  await pool.query(`SELECT setval('seq_fo_tags', ${MAX})`);
  const err = await apply("fo-tagged:1", [{ op: "add", path: "/tags/-", value: { label: "blue" } }]).catch((e) => e);
  expect(err).toBeInstanceOf(Error);
  expect(err.message).toContain("/tags/-: no id is left to mint");
  expect((await pool.query("SELECT count(*)::int AS n FROM fo_tags WHERE id > $1", [MAX])).rows[0].n).toBe(0);
});
