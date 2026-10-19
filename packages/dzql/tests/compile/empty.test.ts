import { expect, test } from "bun:test";
import { applyFramework, applySql, defineSchema, generateSql } from "../../src/postgres";
import { openPglite } from "../../src/postgres/pglite";

// An app with no documents yet -- a new starter, before its first story -- compiles to SQL Postgres
// takes: each case over the documents, with none, is its fallback alone.
test("an app with no documents compiles, and its SQL applies", async () => {
  const sql = generateSql(defineSchema({}), []);
  expect(sql).not.toMatch(/CASE [\w.]+\n\s*\n\s*ELSE/);
  const pool = await openPglite();
  try {
    await applyFramework(pool);
    await applySql(pool, sql);
  } finally {
    await pool.end();
  }
});
