// The README's three opening sections, run as written: its files are these files, byte for byte, and
// its commands are run in an app of their own, as someone who has just said `bun add dzql
// @blueshed/delta` would run them (the workspace's packages linked in for npm's).
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { cpSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Subprocess } from "bun";
import { waitFor } from "@blueshed/delta/testing";

const here = import.meta.dir;
const readme = readFileSync(join(here, "..", "README.md"), "utf8");
const cli = join(here, "..", "src", "cli", "index.ts");
const file = (name: string) => readFileSync(join(here, name), "utf8");

/** The README's `sh` blocks, in order, each a list of commands: `bunx dzql` run as this checkout's, `bun add` already done. */
const blocks = [...readme.matchAll(/```sh\n([\s\S]*?)```/g)].map((m) =>
  m[1]!.trim().split("\n").filter((line) => !line.startsWith("bun add")).map((line) => line.replace(/^bunx dzql /, `bun ${cli} `).split(" ")),
);

/** An app's folder, with the workspace's packages where `bun add` would put npm's. */
function app(...files: [from: string, to: string][]): string {
  const dir = mkdtempSync(join(tmpdir(), "dzql-readme-"));
  symlinkSync(join(here, "..", "..", "..", "node_modules"), join(dir, "node_modules"));
  for (const [from, to] of files) cpSync(join(here, from), join(dir, to));
  return dir;
}

const running: Subprocess[] = [];
/** A command that serves, started in `cwd` on a free port: the URL its `Listening on` line names. */
async function serving(cmd: string[], cwd: string, env: Record<string, string> = {}): Promise<URL> {
  const proc = Bun.spawn(cmd, { cwd, env: { ...process.env, PORT: "0", LOG_LEVEL: "warn", NODE_ENV: "production", ...env }, stdout: "pipe", stderr: "inherit" });
  running.push(proc);
  let out = "";
  for await (const chunk of proc.stdout) {
    out += new TextDecoder().decode(chunk);
    const at = out.match(/Listening on (\S+)/);
    if (at) return new URL(at[1]!);
  }
  throw new Error(`${cmd.join(" ")} never listened: ${out}`);
}
afterAll(() => running.forEach((p) => p.kill()));

/** A command run to its end in `cwd`: what it printed. */
function ran(cmd: string[], cwd: string, env: Record<string, string> = {}): string {
  const r = Bun.spawnSync(cmd, { cwd, env: { ...process.env, LOG_LEVEL: "warn", ...env } });
  if (r.exitCode !== 0) throw new Error(`${cmd.join(" ")}: ${r.stderr.toString()}${r.stdout.toString()}`);
  return r.stdout.toString();
}

/** A socket to a server, and each message it is sent. */
async function socket(url: URL, path = "/ws") {
  const ws = new WebSocket(new URL(path, url.href.replace(/^http/, "ws")));
  const heard: any[] = [];
  ws.addEventListener("message", (e) => heard.push(JSON.parse(String(e.data))));
  await new Promise((r) => ws.addEventListener("open", r, { once: true }));
  let id = 0;
  const until = async <T>(found: () => T | undefined): Promise<T> => {
    for (let i = 0; i < 400; i++) {
      const it = found();
      if (it) return it;
      await Bun.sleep(10);
    }
    throw new Error(`not heard: ${JSON.stringify(heard).slice(0, 500)}`);
  };
  const ask = async (msg: object) => {
    const sent = ++id;
    ws.send(JSON.stringify({ id: sent, ...msg }));
    return until(() => heard.find((m) => m.id === sent));
  };
  return { ws, heard, until, ask };
}

test("the README's files are these files, byte for byte", () => {
  for (const name of ["rendering/routes.ts", "rendering/main.ts", "server.ts"]) expect(readme).toContain("```ts\n" + file(name) + "```");
  expect(readme).toContain("```html\n" + file("rendering/index.html") + "```");
  expect(blocks.map((b) => b.length)).toEqual([1, 1, 2]);
});

describe("Install dzql and use rendering", () => {
  let dir: string, url: URL;
  beforeAll(async () => {
    dir = app(["rendering/routes.ts", "routes.ts"], ["rendering/index.html", "index.html"], ["rendering/main.ts", "main.ts"]);
    url = await serving(blocks[0]![0]!, dir);
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  test("the page is served, and a save in one window shows in both, and is kept in the file", async () => {
    expect((await fetch(url)).status).toBe(200);
    const [one, two] = [await socket(url), await socket(url)];
    for (const w of [one, two]) await w.until(() => w.heard.find((m) => m.type === "render" && m.html.includes("<h1>Hello</h1>")));
    two.ws.send(JSON.stringify({ id: 1, doc: "message", ops: [{ op: "replace", path: "/messages/1/text", value: "Hi from two" }] }));
    await one.until(() => one.heard.find((m) => m.type === "render" && m.html.includes("<h1>Hi from two</h1>")));
    const kept = await waitFor(() => JSON.parse(readFileSync(join(dir, "data", "message.json"), "utf8")).tables.messages); // saved after it is told
    expect(kept).toEqual([{ id: 1, text: "Hi from two" }]);
    one.ws.close();
    two.ws.close();
  });
});

describe("Install dzql and use modelling", () => {
  let dir: string;
  beforeAll(() => {
    dir = app();
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  test("the model's page is served", async () => {
    const [start] = blocks[1]!;
    const page = await serving(start!, dir, { MODEL_PORT: "0" });
    expect(await (await fetch(new URL("/model", page))).text()).toContain("<html");
  }, 30_000);

  test("types.ts runs on delta's JSON file and on SQLite", async () => {
    const { docs, schema } = await import("./types");
    const json = await import("@blueshed/delta/json");
    const sqlite = await import("@blueshed/delta/sqlite");
    const { createWs } = await import("@blueshed/delta/server");
    const { mockClient, sendAndAwait } = await import("@blueshed/delta/testing");
    const db = new Database(":memory:");
    sqlite.createTables(db, schema);
    for (const register of [(ws: any) => json.registerDocs(ws, join(dir, "data", "app.json"), schema, docs), (ws: any) => sqlite.registerDocs(ws, db, schema, docs)]) {
      const ws = createWs();
      register(ws);
      const ann = mockClient({ clientId: "ann" });
      await sendAndAwait(ws, ann, { action: "open", doc: "team:1" });
      const ops = [{ op: "replace", path: "/teams/1/name", value: "Ops" }, { op: "add", path: "/requests/-", value: { starts: "2026-11-02", days: 2, status: "asked" } }];
      expect((await sendAndAwait(ws, ann, { action: "delta", doc: "team:1", ops })).error).toBeUndefined();
      const team = (await sendAndAwait(ws, mockClient({ clientId: "mo" }), { action: "open", doc: "team:1" })).result;
      expect(Object.values(team.requests)).toEqual([{ id: 1, teams_id: 1, starts: "2026-11-02", days: 2, status: "asked" }]);
    }
    db.close();
    await waitFor(() => readFileSync(join(dir, "data", "app.json"), "utf8").includes("2026-11-02")); // the file is saved after the write is answered
  });
});

describe("Install dzql and compile a Postgres server", () => {
  let dir: string;
  beforeAll(() => {
    dir = app(["types.ts", "types.ts"], ["server.ts", "server.ts"]);
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  test("dzql sql prints what it compiles, and the server keeps the team and tells whoever holds it", async () => {
    const [sql, serve] = blocks[2]!;
    expect(ran(sql!, dir)).toContain(`CREATE TABLE IF NOT EXISTS "requests"`);
    const url = await serving(serve!, dir);
    expect(await (await fetch(new URL("/health", url))).text()).toBe("ok");
    const [ann, mo] = [await socket(url), await socket(url)];
    await ann.ask({ action: "open", doc: "team:1" });
    expect((await mo.ask({ action: "open", doc: "team:1" })).result.teams).toMatchObject({ id: 1 });
    const ops = [{ op: "replace", path: "/teams/1/name", value: "Ops" }, { op: "add", path: "/requests/-", value: { starts: "2026-11-02", days: 2, status: "asked" } }];
    expect((await ann.ask({ action: "delta", doc: "team:1", ops })).error).toBeUndefined();
    await mo.until(() => mo.heard.find((m) => m.doc === "team:1" && JSON.stringify(m.ops ?? []).includes("2026-11-02")));
    ann.ws.close();
    mo.ws.close();
  }, 60_000);
});
