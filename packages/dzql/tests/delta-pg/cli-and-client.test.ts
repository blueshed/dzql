/**
 * What left delta's CLI and client tests with Postgres: delta's own CLI and
 * browser client against dzql's Postgres (in process, PGlite), and dzql's
 * `sql` and `init` commands, as delta's `sql` and `init` were tested.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { createWs } from "@blueshed/delta/server";
import { connectWs, openDoc } from "@blueshed/delta/client";
import { setLogLevel } from "@blueshed/delta/logger";
import { applyFramework, applySql, createDocListener, defineDoc, defineSchema, docTypeFromDef, generateSql } from "../../src/postgres";
import { openPglite } from "../../src/postgres/pglite";

setLogLevel("silent");

const DELTA_CLI = join(dirname(require.resolve("@blueshed/delta/package.json")), "cli.ts");
const DZQL_CLI = resolve(import.meta.dir, "..", "..", "src", "cli", "index.ts");

async function run(cli: string, cwd: string, ...args: string[]) {
  const proc = Bun.spawn(["bun", cli, ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  const [code, stdout, stderr] = await Promise.all([proc.exited, new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  return { code, stdout, stderr };
}

describe("delta's CLI against dzql's Postgres, with no ledger", () => {
  test("delta answers { ack, version } and the ops as applied", async () => {
    const schema = defineSchema({ items: { columns: { name: "text" } } });
    const items = defineDoc("items:", { root: "items", include: [] });
    const pool = await openPglite();
    await applyFramework(pool);
    await applySql(pool, generateSql(schema, [items]));
    const ws = createWs();
    const listener = await createDocListener(ws, pool, { types: [docTypeFromDef(items, pool)] });
    const server = Bun.serve({ port: 0, routes: { [ws.path]: ws.upgrade }, websocket: ws.websocket });
    ws.setServer(server);
    try {
      const { code, stdout } = await run(DELTA_CLI, import.meta.dir, "delta", "items:", '[{"op":"add","path":"/items/-","value":{"name":"pg"}}]', "--url", `ws://localhost:${server.port}/ws`, "--json");
      expect(code).toBe(0);
      const lines = stdout.trim().split("\n").map((l) => JSON.parse(l));
      expect(lines).toHaveLength(1);
      expect(lines[0]).toMatchObject({ ack: true, ops: [{ op: "add", path: "/items/1", value: { id: 1, name: "pg" } }] });
    } finally {
      server.stop(true);
      await listener.destroy();
      await pool.end();
    }
  }, 30_000);
});

describe("delta's client against dzql's Postgres: send(ops, { inverse: true }) gives the id a new row was given", () => {
  test("with no ledger", async () => {
    const schema = defineSchema({
      venues: { columns: { name: "text?" }, temporal: false },
      rooms: { parent: "venues", columns: { name: "text" }, temporal: false },
    });
    const venue = defineDoc("venue:", { root: "venues", include: ["rooms"], implied: true });
    const pool = await openPglite();
    await applyFramework(pool);
    await applySql(pool, generateSql(schema, [venue]));
    const ws = createWs();
    const listener = await createDocListener(ws, pool, { types: [docTypeFromDef(venue, pool)] });
    const server = Bun.serve({ port: 0, routes: { [ws.path]: ws.upgrade }, websocket: ws.websocket });
    ws.setServer(server);
    const client = connectWs(`ws://localhost:${server.port}${ws.path}`);
    try {
      const doc = openDoc<any>("venue:1", client);
      await doc.ready;
      const ack = await doc.send([{ op: "add", path: "/rooms/-", value: { name: "attic" } }], { inverse: true });
      expect(ack.ops).toEqual([{ op: "add", path: "/rooms/1", value: expect.objectContaining({ id: 1, venues_id: 1, name: "attic" }) }]);
      const plain = await doc.send([{ op: "add", path: "/rooms/-", value: { name: "cellar" } }]);
      expect(plain.ops).toBeUndefined();   // not asked: the ack as it was
      expect(doc.data.peek().rooms[2].name).toBe("cellar");
    } finally {
      client.close();
      server.stop(true);
      await listener.destroy();
      await pool.end();
    }
  }, 30_000);
});

const TYPES_MODULE =
  `import { defineSchema, defineDoc } from ${JSON.stringify(resolve(import.meta.dir, "..", "..", "src", "postgres"))};\n` +
  `export const schema = defineSchema({ todos: { columns: { text: "text" }, temporal: false } });\n` +
  `export const docs = [defineDoc("todos:", { root: "todos", include: [] })];\n`;

describe("dzql sql --out", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "dzql-sql-out-"));
    writeFileSync(join(dir, "types.ts"), TYPES_MODULE);
  });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  test("writes a fresh --out file and stamps the generated header, the compiled reads in it", async () => {
    const out = join(dir, "003-tables.sql");
    const res = await run(DZQL_CLI, dir, "sql", "./types.ts", "--out", out);
    expect(res.code).toBe(0);
    expect(readFileSync(out, "utf8")).toContain("GENERATED FROM");
    expect(readFileSync(out, "utf8")).toContain("CREATE OR REPLACE FUNCTION dzql_open__todos(p_name TEXT)");
  });

  test("refuses to overwrite a non-generated --out file without --force", async () => {
    const out = join(dir, "hand-written.sql");
    writeFileSync(out, "-- my own SQL\nSELECT 1;\n");
    const res = await run(DZQL_CLI, dir, "sql", "./types.ts", "--out", out);
    expect(res.code).not.toBe(0);
    expect(res.stderr).toContain("Refusing to overwrite");
    expect(readFileSync(out, "utf8")).toBe("-- my own SQL\nSELECT 1;\n");
  });

  test("--force overwrites a non-generated --out file", async () => {
    const out = join(dir, "hand-written.sql");
    writeFileSync(out, "-- my own SQL\nSELECT 1;\n");
    expect((await run(DZQL_CLI, dir, "sql", "./types.ts", "--out", out, "--force")).code).toBe(0);
    expect(readFileSync(out, "utf8")).toContain("GENERATED FROM");
  });

  test("overwrites a previously generated --out file and keeps a backup", async () => {
    const out = join(dir, "003-tables.sql");
    await run(DZQL_CLI, dir, "sql", "./types.ts", "--out", out);
    expect((await run(DZQL_CLI, dir, "sql", "./types.ts", "--out", out)).code).toBe(0);
    expect(existsSync(out + ".bak")).toBe(true);
  });

  test("a missing module is a one-line error", async () => {
    const res = await run(DZQL_CLI, dir, "sql", "./does-not-exist.ts");
    expect(res.code).not.toBe(0);
    expect(res.stderr).toContain('Cannot load module "./does-not-exist.ts"');
    expect(res.stderr).not.toContain("ResolveMessage");
  });
});

describe("dzql init", () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "dzql-init-")); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  test("vendors the framework SQL stamped @blueshed/dzql; --with-auth adds the JWT reference", async () => {
    expect((await run(DZQL_CLI, dir, "init", "sql", "--with-auth")).code).toBe(0);
    const files = readdirSync(join(dir, "sql")).toSorted();
    expect(files).toContain("001a-delta-meta.sql");
    expect(files).toContain("002-users.sql");
    expect(readFileSync(join(dir, "sql", "001a-delta-meta.sql"), "utf8").split("\n", 1)[0]).toMatch(/^-- @blueshed\/dzql framework v\d+\.\d+\.\d+/);
  });

  test("--upgrade replaces a file delta init vendored, keeping a backup", async () => {
    const sqlDir = join(dir, "sql");
    await run(DZQL_CLI, dir, "init", "sql");
    const file = join(sqlDir, "001a-delta-meta.sql");
    writeFileSync(file, "-- @blueshed/delta framework v0.16.0\n-- vendored by delta init\nSELECT 1;\n");
    const res = await run(DZQL_CLI, dir, "init", "sql", "--upgrade");
    expect(res.code).toBe(0);
    expect(readFileSync(file, "utf8").split("\n", 1)[0]).toMatch(/^-- @blueshed\/dzql framework/);
    expect(existsSync(file + ".bak")).toBe(true);
  });
});
