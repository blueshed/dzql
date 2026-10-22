/**
 * A `date` and a `numeric` carry out of Postgres as every backend carries them (`exportTables`): a
 * day as written, an exact decimal as its text (to_jsonb would give a JSON number, a float once
 * parsed), so the rows move on to SQLite or the JSON file unchanged.
 */
import { expect, test } from "bun:test";
import { daysApp } from "@blueshed/delta/testing";
import { applyFramework, applySql, exportTables, generateSql, importTables } from "../../src/postgres";
import { openPglite } from "../../src/postgres/pglite";

test("exportTables gives a day as written and an exact decimal as its text", async () => {
  const pool = await openPglite();
  try {
    await applyFramework(pool);
    await applySql(pool, generateSql(daysApp.schema, daysApp.docs));
    const seed = { tables: { case_payments: [...daysApp.seed.tables.case_payments!, { id: 3, title: "big", day: "0001-01-01", until: null, amount: "12345678901234567890.123456789", tip: "-0.10" }] } };
    await importTables(pool, daysApp.schema, seed);
    const out = await exportTables(pool, daysApp.schema);
    expect(out.tables.case_payments).toEqual(seed.tables.case_payments);
  } finally {
    await pool.end();
  }
});
