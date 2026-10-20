/**
 * Migrations (reference/migrations.md): the changes a schema cannot say, run
 * once each, in order, at start-up, before the schema adds what it declares.
 * `upgradeCases` from ./testing, asked of SQLite (dzql tells the same story on
 * Postgres; the JSON file runs no migrations); then SQLite's own: the list
 * refused, and the CLI.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { upgradeCases } from "@blueshed/delta/testing";
import * as sqlite from "../src/server/sqlite";
import { setLogLevel } from "../src/server/logger";
import { removeUpgradeDirs, sqliteUpgrades } from "./helpers/case-backends";

setLogLevel("silent");

const dirs: string[] = [];
afterAll(async () => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  removeUpgradeDirs();
});
const tempDir = () => { const d = mkdtempSync(join(tmpdir(), "delta-migrate-")); dirs.push(d); return d; };

upgradeCases("sqlite", sqliteUpgrades);

describe("the list", () => {
  test("is refused, before anything runs, when a migration has no id, nothing to run (no changes, no up), or a name twice", async () => {
    const db = new Database(":memory:");
    const up = () => {};
    await expect(sqlite.migrate(db, [{ id: "", up }])).rejects.toThrow(/has no id/);
    await expect(sqlite.migrate(db, [{ id: "001-x" } as any])).rejects.toThrow(/001-x has no changes and no up/);
    await expect(sqlite.migrate(db, [{ id: "001-x", up }, { id: "001-x", up }])).rejects.toThrow(/two migrations are named 001-x/);
    expect(db.query("SELECT name FROM sqlite_master WHERE name = 'delta_migrations'").get()).toBeNull();
  });

  test("a file in the folder with no changes and no up is refused, by name", async () => {
    const dir = tempDir();
    writeFileSync(join(dir, "001-nothing.ts"), "export const down = () => {};\n");
    await expect(sqlite.fromFolder(dir)).rejects.toThrow(/001-nothing.ts exports no changes and no up/);
  });

  test("migrate runs outside a transaction (SQLite): each migration is its own", async () => {
    const db = new Database(":memory:");
    db.run("BEGIN");
    await expect(sqlite.migrate(db, [])).rejects.toThrow(/outside a transaction/);
    db.run("ROLLBACK");
  });

  test("a database migrate makes is in WAL mode, as createTables' is: processes share the file", async () => {
    const db = new Database(join(tempDir(), "app.db"));
    await sqlite.migrate(db, []);
    expect((db.query("PRAGMA journal_mode").get() as { journal_mode: string }).journal_mode).toBe("wal");
    db.close();
  });
});

describe("the CLI: delta migrate", () => {
  const CLI = resolve(import.meta.dir, "..", "src", "cli.ts");
  const run = async (...args: string[]) => {
    const proc = Bun.spawn(["bun", CLI, "migrate", ...args], { stdout: "pipe", stderr: "pipe" });
    const [code, out, err] = await Promise.all([proc.exited, new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
    return { code, out, err };
  };

  {
    test("--status says what ran and what is pending; without it, runs what is pending", async () => {
      const dir = tempDir();
      const migrations = join(dir, "migrations");
      mkdirSync(migrations);
      writeFileSync(join(migrations, "001-add-notes.ts"), `export const up = (db) => db.run("ALTER TABLE things ADD COLUMN notes TEXT");\n`);
      const target = join(dir, "app.db");
      new Database(target).run("CREATE TABLE things (id INT PRIMARY KEY)");
      const status = await run(target, "--dir", migrations, "--status", "--json");
      expect([status.code, status.err]).toEqual([0, ""]);
      expect(JSON.parse(status.out)).toEqual({ fresh: false, ran: [], pending: ["001-add-notes"], unknown: [] });

      const migrated = await run(target, "--dir", migrations, "--json");
      expect([migrated.code, migrated.err]).toEqual([0, ""]);
      expect(JSON.parse(migrated.out)).toEqual({ ran: ["001-add-notes"], fresh: false, unknown: [] });

      const again = await run(target, "--dir", migrations, "--status");
      expect(again.code).toBe(0);
      expect(again.out).toContain("ran      001-add-notes");
      expect(again.out).not.toContain("pending");
      // another app's list, on the same database: its own records
      const other = await run(target, "--dir", migrations, "--app", "other", "--status", "--json");
      expect(JSON.parse(other.out)).toMatchObject({ ran: [], pending: ["001-add-notes"] });
    }, 30_000);
  }

  test("a database that is not there, or no database named, is a bad argument", async () => {
    expect((await run(join(tempDir(), "nope.db"))).code).toBe(2);
    expect((await run()).code).toBe(2);
    const pg = await run("postgres://localhost/app");   // Postgres is dzql's
    expect([pg.code, pg.err]).toEqual([2, "delta: postgres://localhost/app is Postgres: dzql migrate runs its migrations\n"]);
  });
});
