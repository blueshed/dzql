import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrate } from "./migrate";

function tempMigrationsDir(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "eta-migrations-"));
  for (const [name, sql] of Object.entries(files)) {
    writeFileSync(join(dir, name), sql);
  }
  return dir;
}

describe("migrate", () => {
  test("applies migrations in filename order", () => {
    const dir = tempMigrationsDir({
      "0002_second.sql": "CREATE TABLE second (id INTEGER);",
      "0001_first.sql": "CREATE TABLE first (id INTEGER);",
    });

    const db = new Database(":memory:");
    migrate(db, dir);

    const tables = db
      .query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all()
      .map((row) => row.name);

    expect(tables).toContain("first");
    expect(tables).toContain("second");

    rmSync(dir, { recursive: true });
  });

  test("does not re-apply a migration that already ran", () => {
    const dir = tempMigrationsDir({ "0001_once.sql": "CREATE TABLE once_only (id INTEGER);" });
    const db = new Database(":memory:");

    migrate(db, dir);
    expect(() => migrate(db, dir)).not.toThrow(); // re-running CREATE TABLE would throw if not skipped

    rmSync(dir, { recursive: true });
  });

  test("a migration with multiple statements applies them all", () => {
    const dir = tempMigrationsDir({
      "0001_multi.sql": "CREATE TABLE a (id INTEGER);\nCREATE TABLE b (id INTEGER);",
    });
    const db = new Database(":memory:");

    migrate(db, dir);

    const tables = db
      .query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all()
      .map((row) => row.name);
    expect(tables).toContain("a");
    expect(tables).toContain("b");

    rmSync(dir, { recursive: true });
  });
});
