/**
 * A ledger entry's inverse, built from the rows the write touches.
 *
 * `delta_apply_logged` once read the whole document (`_delta_open(name, TRUE)`), and the rows each
 * removal's cascade takes beyond it (`_delta_beside`), before every write, to take the inverse
 * from: a write cost what its document held. Now the write itself keeps each row as it was before
 * the write first touched it (`_delta_apply`'s `before`), and the inverse is taken from those.
 *
 * Here, for writes of every kind through delta's path documents -- a field, a row, a root, an add,
 * a row made and taken out again, a remove and its cascade (inside the document and beyond it), a
 * move, a list's rows, a temporal row, an implied document's first write, columns a document does
 * not show -- each in a transaction rolled back after (a serial is not: each names an id of its own): the inverse is the one the whole document
 * gave (taken the old way, in the same transaction, before the write), and the whole document is
 * never read (`_delta_open(name, TRUE)` raises while the write runs). Then delta's own cases
 * (tests/delta) walk every inverse back, undo and redo.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Pool } from "pg";
import { setLogLevel } from "@blueshed/delta/logger";
import { pathDocs, pathPublicDocs, pathSchema, pathSeed } from "@blueshed/delta/testing";
import { applyFramework, applySql, generateSql, importTables } from "../../src/postgres";
import { sharedPglite } from "../helpers/pglite";

setLogLevel("silent");

const docs = [...pathDocs, ...pathPublicDocs];

let pool: Pool;

beforeAll(async () => {
  pool = await sharedPglite();
  await applyFramework(pool);
  await applySql(pool, generateSql(pathSchema, docs));
  await importTables(pool, pathSchema, pathSeed);
});
afterAll(async () => { await pool.end(); });

/** The document as the inverse was once taken from: whole, and what each removal's cascade takes beyond it. */
const WHOLE = `SELECT _delta_beside(COALESCE(_delta_open($1, TRUE), '{}'::jsonb), _delta_find_doc($1), (
    SELECT jsonb_agg(r) FROM jsonb_array_elements($2::jsonb) AS o,
           LATERAL _delta_split_path(o->>'path') AS p,
           LATERAL jsonb_array_elements(_delta_cascade_rows(p[1], p[2]::bigint)) AS r
     WHERE o->>'op' = 'remove' AND array_length(p, 1) = 2
       AND p[2] ~ '^[0-9]+$' AND p[2]::numeric <= 9007199254740991)) AS before`;

/** While the write runs, reading a document whole is an error: the write must not. */
const NO_WHOLE = `CREATE OR REPLACE FUNCTION _delta_open(p_doc_name TEXT, p_whole BOOLEAN) RETURNS JSONB AS $$
BEGIN
  IF p_whole THEN RAISE EXCEPTION 'read whole: %', p_doc_name; END IF;
  RETURN delta_open(p_doc_name);
END $$ LANGUAGE plpgsql`;

/** A write through `doc`, logged, rolled back after: its inverse, and the one the whole document gave. */
async function inverses(doc: string, ops: unknown[]): Promise<{ inverse?: unknown; whole?: unknown; error?: string }> {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    const before = (await c.query(WHOLE, [doc, JSON.stringify(ops)])).rows[0].before;
    await c.query(NO_WHOLE);
    await c.query("SAVEPOINT w");
    let result: any;
    try {
      result = (await c.query("SELECT delta_apply_logged($1, $2::jsonb, NULL, 'c') AS r", [doc, JSON.stringify(ops)])).rows[0].r;
    } catch (err: any) {
      await c.query("ROLLBACK TO SAVEPOINT w");
      return { error: err.message };
    }
    const whole = (await c.query("SELECT _delta_inverse($1::jsonb, $2::jsonb, $3::jsonb) AS r", [before, JSON.stringify(result.ops), JSON.stringify(ops)])).rows[0].r;
    expect(result).not.toHaveProperty("before");
    return { inverse: result.inverse, whole };
  } finally {
    await c.query("ROLLBACK");
    c.release();
  }
}

const WRITES: [string, string, unknown[]][] = [
  ["a field", "fo-board:1", [{ op: "replace", path: "/courses/1/name", value: "Fish" }]],
  ["a row whole", "fo-board:1", [{ op: "replace", path: "/households/1", value: { email: "z@x" } }]],
  ["a field, another row, the first again", "fo-board:1", [
    { op: "replace", path: "/courses/1/name", value: "A" }, { op: "replace", path: "/drinks/1/name", value: "B" }, { op: "replace", path: "/courses/1/name", value: "C" }]],
  ["the root's field", "fo-board:1", [{ op: "replace", path: "/weddings/name", value: "mine" }]],
  ["the root whole", "fo-board:1", [{ op: "replace", path: "/weddings", value: { name: "mine" } }]],
  ["the root by its id", "fo-board:1", [{ op: "replace", path: "/weddings/1/name", value: "mine" }]],
  ["an add, minted", "fo-board:1", [{ op: "add", path: "/courses/-", value: { name: "Fish" } }]],
  ["an add, named, then its field", "fo-board:1", [{ op: "add", path: "/courses/50", value: { name: "Fish" } }, { op: "replace", path: "/courses/50/name", value: "Cod" }]],
  ["a row made and taken out again", "fo-board:1", [{ op: "add", path: "/courses/51", value: { name: "Fish" } }, { op: "remove", path: "/courses/51" }]],
  ["made, taken out, made again", "fo-board:1", [
    { op: "add", path: "/courses/52", value: { name: "Fish" } }, { op: "remove", path: "/courses/52" }, { op: "add", path: "/courses/52", value: { name: "Cod" } }]],
  ["a remove and its cascade", "fo-board:1", [{ op: "remove", path: "/courses/1" }]],
  ["a remove whose cascade reaches beyond the document", "fo-board:1", [{ op: "remove", path: "/households/1" }]],
  ["a remove whose cascade stays in the document (cascadeOn)", "fo-party:1", [{ op: "remove", path: "/households/1" }]],
  ["a field, then the row's remove", "fo-board:1", [{ op: "replace", path: "/courses/1/name", value: "Fish" }, { op: "remove", path: "/courses/1" }]],
  ["a remove, then the row put back", "fo-board:1", [{ op: "remove", path: "/courses/1" }, { op: "add", path: "/courses/1", value: { name: "Soup" } }]],
  ["the root's field, then the root taken out", "fo-board:1", [{ op: "replace", path: "/weddings/name", value: "x" }, { op: "remove", path: "/weddings/1" }]],
  ["the root taken out and put back", "fo-board:1", [{ op: "remove", path: "/weddings/1" }, { op: "add", path: "/weddings/1", value: { name: "again" } }]],
  ["a list's row removed, its drinks beyond the list", "fo-all-courses:", [{ op: "remove", path: "/courses/2" }]],
  ["a list's row and its include", "fo-catalog:", [{ op: "replace", path: "/drinks/2/name", value: "Wine" }, { op: "remove", path: "/courses/1" }]],
  ["a row moved to another parent", "fo-all-households:", [{ op: "replace", path: "/households/2/weddings_id", value: 2 }]],
  ["a course moved, its drinks carried, then one of them removed", "fo-catalog:", [
    { op: "replace", path: "/courses/1/weddings_id", value: 2 }, { op: "remove", path: "/drinks/1" }]],
  ["a temporal row's field, then its remove", "fo-board:1", [{ op: "replace", path: "/notes/1/text", value: "and tables" }, { op: "remove", path: "/notes/1" }]],
  ["a temporal list's row", "fo-all-notes:", [{ op: "replace", path: "/notes/1/text", value: "x" }]],
  ["an implied document's first write", "fo-plan:7", [{ op: "replace", path: "/weddings/name", value: "planned" }]],
  ["an implied document's first write, an add", "fo-plan:8", [{ op: "add", path: "/courses/-", value: { name: "Soup" } }]],
  ["a written implied document", "fo-plan:1", [{ op: "replace", path: "/weddings/name", value: "planned" }, { op: "remove", path: "/courses/1" }]],
  ["a document that shows some columns", "fo-slim:1", [{ op: "replace", path: "/households/1/email", value: "q@x" }, { op: "remove", path: "/seats/1" }]],
  ["a root of its own", "fo-household:1", [{ op: "replace", path: "/households", value: { email: "n@x" } }]],
  ["a scoped single document", "fo-guest:1:a@x", [{ op: "replace", path: "/households/t", value: "hi" }]],
  ["a list by a condition", "fo-menu-like:So", [{ op: "replace", path: "/courses/1/name", value: "Sorbet" }, { op: "remove", path: "/drinks/1" }]],
  ["keywords for names", "fo-asks:1", [{ op: "add", path: "/asks/-", value: { from: "ann", in: 1 } }]],
  ["a refused write", "fo-board:1", [{ op: "replace", path: "/courses/2/name", value: "theirs" }]],
];

describe("the inverse, from the rows the write touches, as the whole document gave it", () => {
  for (const [what, doc, ops] of WRITES) {
    test(`${what} (${doc})`, async () => {
      const got = await inverses(doc, ops);
      if (what === "a refused write") {
        expect(got.error).toContain("Row not found");
        return;
      }
      expect(got.error).toBeUndefined();
      expect(got.inverse).toEqual(got.whole);
    });
  }
});
