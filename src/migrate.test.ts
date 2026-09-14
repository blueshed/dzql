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
    migrate(db, dir, "test");

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

    migrate(db, dir, "test");
    expect(() => migrate(db, dir, "test")).not.toThrow(); // re-running CREATE TABLE would throw if not skipped

    rmSync(dir, { recursive: true });
  });

  test("a migration with multiple statements applies them all", () => {
    const dir = tempMigrationsDir({
      "0001_multi.sql": "CREATE TABLE a (id INTEGER);\nCREATE TABLE b (id INTEGER);",
    });
    const db = new Database(":memory:");

    migrate(db, dir, "test");

    const tables = db
      .query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all()
      .map((row) => row.name);
    expect(tables).toContain("a");
    expect(tables).toContain("b");

    rmSync(dir, { recursive: true });
  });

  test("a migration that fails partway rolls back cleanly and is not recorded", () => {
    const dir = tempMigrationsDir({
      "0001_partial.sql": "CREATE TABLE good (id INTEGER);\nTHIS IS NOT VALID SQL;",
    });
    const db = new Database(":memory:");

    expect(() => migrate(db, dir, "test")).toThrow();

    const tables = db
      .query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((row) => row.name);
    expect(tables).not.toContain("good"); // rolled back, not left half-applied

    const applied = db.query<{ name: string }, []>("SELECT name FROM _migrations").all();
    expect(applied).toEqual([]); // failed migration is not recorded

    rmSync(dir, { recursive: true });
  });

  test("two namespaces can each apply a same-named file without colliding", () => {
    const kernelDir = tempMigrationsDir({ "0001_init.sql": "CREATE TABLE kernel_thing (id INTEGER);" });
    const exampleDir = tempMigrationsDir({ "0001_init.sql": "CREATE TABLE example_thing (id INTEGER);" });
    const db = new Database(":memory:");

    migrate(db, kernelDir, "eta");
    migrate(db, exampleDir, "wedding"); // same filename, different namespace: must not be skipped as "already applied"

    const tables = db
      .query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all()
      .map((row) => row.name);
    expect(tables).toContain("kernel_thing");
    expect(tables).toContain("example_thing");

    const names = db
      .query<{ name: string }, []>("SELECT name FROM _migrations ORDER BY name")
      .all()
      .map((row) => row.name);
    expect(names).toEqual(["eta/0001_init.sql", "wedding/0001_init.sql"]);

    rmSync(kernelDir, { recursive: true });
    rmSync(exampleDir, { recursive: true });
  });
});

describe("migrate legacy adoption", () => {
  test("a record from before namespacing is adopted, not re-applied", () => {
    const dir = tempMigrationsDir({ "0001_new.sql": "CREATE TABLE adopted (id INTEGER);" });
    const db = new Database(":memory:");
    // Simulate a database that ran this file under its old, unnamespaced name.
    db.run("CREATE TABLE _migrations (name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)");
    db.run("INSERT INTO _migrations (name, applied_at) VALUES ('0002_old.sql', 0)");
    db.run("CREATE TABLE adopted (id INTEGER)");

    expect(() => migrate(db, dir, "test", { "0002_old.sql": "0001_new.sql" })).not.toThrow();
    const names = db.query<{ name: string }, []>("SELECT name FROM _migrations").all().map((r) => r.name);
    expect(names).toEqual(["test/0001_new.sql"]);

    // Running again with the same legacy map is a no-op.
    expect(() => migrate(db, dir, "test", { "0002_old.sql": "0001_new.sql" })).not.toThrow();

    rmSync(dir, { recursive: true });
  });
});
