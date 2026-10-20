/**
 * A time only the server sets (`default: "now"`), beyond what `serverTimeCases` (src/cases/writes.ts)
 * asks every backend: the schema takes it on a timestamptz alone; an implied document shows none
 * until its first write makes its row, which takes the write's time; and SQLite keeps the time,
 * never the text "now". The migration's time for rows already there is `migrationCases`'.
 */
import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTables, defineDoc, defineSchema, registerDocs } from "../src/server/sqlite";
import * as json from "../src/server/json";
import { createLocal } from "../src/server/local";
import { setLogLevel } from "../src/server/logger";

setLogLevel("silent");

test('defineSchema takes default "now" on a timestamptz alone, in the schema\'s words', () => {
  expect(() => defineSchema({ notes: { columns: { title: { type: "text", default: "now" } } } }))
    .toThrow(`notes: title's default "now" is the time a row is written, which only a timestamptz column takes (title is text)`);
  expect(() => defineSchema({ notes: { columns: { at: { type: "timestamptz", default: "now" } } } })).not.toThrow();
  expect(() => defineSchema({ notes: { columns: { at: { type: "timestamptz", nullable: true, default: "now" } } } })).not.toThrow();
});

const schema = defineSchema({ days: { columns: { note: "text", opened: { type: "timestamptz", default: "now" } } } });
const docs = [defineDoc("day:", { root: "days", include: [], implied: true })];
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?\+00:00$/;

for (const [name, register] of [
  ["SQLite", (local: ReturnType<typeof createLocal>) => {
    const db = new Database(":memory:");
    createTables(db, schema);
    registerDocs(local.server, db, schema, docs);
    return { db, end: () => {} };
  }],
  ["the JSON file", (local: ReturnType<typeof createLocal>) => {
    const dir = mkdtempSync(join(tmpdir(), "delta-server-time-"));
    json.registerDocs(local.server, join(dir, "data.json"), schema, docs);
    return { db: undefined, end: () => rmSync(dir, { recursive: true, force: true }) };
  }],
] as const) {
  test(`${name}: an implied document shows no time until its first write makes the row, which takes the write's`, async () => {
    const local = createLocal();
    const { db, end } = register(local);
    try {
      const me = local.as({ id: 1 });
      expect((await me.call("open", { doc: "day:1" })).result.days).toEqual({ id: 1, note: "", opened: null });
      const before = Date.now();
      expect((await me.call("delta", { doc: "day:1", ops: [{ op: "replace", path: "/days/note", value: "rain" }] })).error).toBeUndefined();
      const opened = (await local.as({ id: 2 }).call("open", { doc: "day:1" })).result.days.opened;
      expect(opened).toMatch(UTC);
      expect(Date.parse(opened)).toBeGreaterThanOrEqual(before - 1);
      // the write's own clock, which runs a tick ahead where writes come faster than the milliseconds (`now` in sqlite/rows.ts)
      expect(Date.parse(opened)).toBeLessThanOrEqual(Date.now() + 1000);
      // SQLite keeps the time a write gave it, as text in UTC: never the word
      if (db) expect(db.query("SELECT opened FROM days").get()).toEqual({ opened });
    } finally {
      end();
    }
  });
}
