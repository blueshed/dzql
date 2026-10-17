/**
 * Migrations (reference/migrations.md): the changes a schema cannot say, run
 * once each, in order, at start-up, before the schema adds what it declares.
 * delta's `upgradeCases` (`@blueshed/delta/testing`), asked of Postgres in process
 * (PGlite; delta asks the same of SQLite); then dzql's own: the CLI.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { upgradeCases } from "@blueshed/delta/testing";
import { setLogLevel } from "@blueshed/delta/logger";
import { openPglite } from "../../src/postgres/pglite";
import { endUpgrades, pgliteUpgrades } from "./helpers/upgrades";

setLogLevel("silent");

const dirs: string[] = [];
afterAll(async () => {
  await endUpgrades();
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});
const tempDir = () => { const d = mkdtempSync(join(tmpdir(), "delta-migrate-")); dirs.push(d); return d; };

upgradeCases("pglite", pgliteUpgrades);

describe("the CLI: dzql migrate (a SQLite file is delta's own command)", () => {
  const CLI = resolve(import.meta.dir, "..", "..", "src", "cli", "index.ts");
  const run = async (...args: string[]) => {
    const proc = Bun.spawn(["bun", CLI, "migrate", ...args], { stdout: "pipe", stderr: "pipe" });
    const [code, out, err] = await Promise.all([proc.exited, new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
    return { code, out, err };
  };

  test("--status says what ran and what is pending; without it, runs what is pending (pglite)", async () => {
    const dir = tempDir();
    const migrations = join(dir, "migrations");
    mkdirSync(migrations);
    writeFileSync(join(migrations, "001-add-notes.ts"), `export const up = async (tx) => { await tx.query("ALTER TABLE things ADD COLUMN notes TEXT"); };\n`);
    const target = join(dir, "pgdata");
    const pool = await openPglite(target);
    await pool.query("CREATE TABLE things (id INT PRIMARY KEY)");
    await pool.end();
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

  test("a database that is not there, or no database named, is a bad argument", async () => {
    expect((await run(join(tempDir(), "nope"))).code).toBe(2);
    expect((await run()).code).toBe(2);
  });
});
