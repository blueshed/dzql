/**
 * A time only the server sets (`default: "now"`) on Postgres in process (PGlite), beyond delta's
 * `serverTimeCases` (writes.test.ts), as delta's tests/server-time.test.ts asks SQLite and the JSON
 * file: an implied document shows none until its first write makes the row, which takes the write's
 * time; and a migration that adds one gives each row already there the migration's time, as
 * delta's `migrationCases` asks (migrations-from-empty.test.ts, on the Postgres server too).
 */
import { afterAll, beforeAll, expect, test } from "bun:test";
import type { Pool } from "pg";
import { createLocal } from "@blueshed/delta/local";
import { setLogLevel } from "@blueshed/delta/logger";
import { defineDoc, defineSchema } from "@blueshed/delta/backend";
import { addColumn, createTable } from "@blueshed/delta/migrations";
import { applyFramework, applySql, createDocListener, docTypeFromDef, generateSql } from "../../src/postgres";
import { migrate } from "../../src/postgres/migrate";
import { openPglite } from "../../src/postgres/pglite";

setLogLevel("silent");

const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?\+00:00$/;
const pools: Pool[] = [];
const open = async () => { const pool = await openPglite(); pools.push(pool); return pool; };
afterAll(async () => { for (const p of pools) await p.end(); });

const schema = defineSchema({ st_days: { columns: { note: "text", opened: { type: "timestamptz", default: "now" } } } });
const docs = [defineDoc("st-day:", { root: "st_days", include: [], implied: true })];
let pool: Pool;
beforeAll(async () => {
  pool = await open();
  await applyFramework(pool);
  await applySql(pool, generateSql(schema, docs));
});

test("an implied document shows no time until its first write makes the row, which takes the write's", async () => {
  const local = createLocal();
  const listener = await createDocListener(local.server, pool, { types: docs.map((def) => docTypeFromDef(def, pool)) });
  try {
    const me = local.as({ id: 1 });
    expect((await me.call("open", { doc: "st-day:1" })).result.st_days).toEqual({ id: 1, note: "", opened: null });
    const before = Date.now();
    expect((await me.call("delta", { doc: "st-day:1", ops: [{ op: "replace", path: "/st_days/note", value: "rain" }] })).error).toBeUndefined();
    const opened = (await local.as({ id: 2 }).call("open", { doc: "st-day:1" })).result.st_days.opened;
    expect(opened).toMatch(UTC);
    expect(Date.parse(opened)).toBeGreaterThanOrEqual(before - 1);
    expect(Date.parse(opened)).toBeLessThanOrEqual(Date.now());
  } finally {
    await listener.destroy();
  }
});

test("a migration that adds one gives each row already there the migration's time, to the millisecond", async () => {
  const db = await open();
  const history = [{ id: "001-people", changes: [createTable("people", { columns: { name: "text" }, temporal: false })] }];
  await migrate(db, history);
  await db.query("INSERT INTO people (id, name) VALUES (1, 'Ann')");
  const before = Date.now();
  await migrate(db, [...history, { id: "002-joined", changes: [addColumn("people", "joined", { type: "timestamptz", default: "now" })] }]);
  await Bun.sleep(5);
  // a row put in by hand later takes its own time: the default is now(), never 'now' (which Postgres reads once, as the column is made)
  await db.query("INSERT INTO people (id, name) VALUES (2, 'Bo')");
  const { rows } = await db.query("SELECT to_jsonb(joined) #>> '{}' AS joined FROM people ORDER BY id");
  expect(rows[0].joined).toMatch(UTC);
  expect(Date.parse(rows[0].joined)).toBeGreaterThanOrEqual(before - 1);
  expect(Date.parse(rows[1].joined)).toBeGreaterThan(Date.parse(rows[0].joined));
});
