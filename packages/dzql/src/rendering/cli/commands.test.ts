import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Resource } from "../resources/resource";
import type { Example } from "../example";
import index from "../server.test.fixture.html";
import { Database } from "bun:sqlite";
import { createTables, defineDoc, defineSchema, registerDocs } from "@blueshed/delta/sqlite";
import { createLocal } from "@blueshed/delta/local";
import { read } from "../documents";
import { createServer } from "../server";
import { refuse } from "../refusal";
import {
  connectCli,
  DEFAULT_SESSION_FILE,
  extractFlag,
  extractSessionFile,
  formatHistory,
  formatInspection,
  loadOrCreateSessionCookie,
  parseCommand,
  runCommand,
  signIn,
  watch,
} from "./commands";
import { appDir } from "../names";

describe("parseCommand", () => {
  test("inspect, watch, and undo take no argument", () => {
    expect(parseCommand(["inspect"])).toEqual({ kind: "inspect" });
    expect(parseCommand(["watch"])).toEqual({ kind: "watch" });
    expect(parseCommand(["undo"])).toEqual({
      kind: "write",
      doc: "ledger",
      ops: [{ op: "remove", path: "/latest" }],
    });
    expect(parseCommand(["redo"])).toEqual({
      kind: "write",
      doc: "ledger",
      ops: [{ op: "add", path: "/latest" }],
    });
  });

  test("write <doc> <op> <path> [value] maps to that exact wire write", () => {
    expect(parseCommand(["write", "widget", "replace", "/color", "blue"])).toEqual({
      kind: "write",
      doc: "widget",
      ops: [{ op: "replace", path: "/color", value: "blue" }],
    });
    expect(parseCommand(["write", "widget", "remove", "/color"])).toEqual({
      kind: "write",
      doc: "widget",
      ops: [{ op: "remove", path: "/color" }],
    });
  });

  test("write with a multi-word value joins it back together", () => {
    expect(parseCommand(["write", "note", "add", "/lines/-", "hello", "world"])).toEqual({
      kind: "write",
      doc: "note",
      ops: [{ op: "add", path: "/lines/-", value: "hello world" }],
    });
  });

  test("write with a missing doc/op/path, or an op that isn't a real PatchOp kind, is undefined", () => {
    expect(parseCommand(["write"])).toBeUndefined();
    expect(parseCommand(["write", "widget"])).toBeUndefined();
    expect(parseCommand(["write", "widget", "replace"])).toBeUndefined();
    expect(parseCommand(["write", "widget", "nonsense", "/x"])).toBeUndefined();
  });

  test("an example's aliases are consulted for names the kernel doesn't know", () => {
    const aliases = {
      greet: (args: string[]) => ({ doc: "widget", ops: [{ op: "replace" as const, path: "/name", value: args.join(" ") }] }),
    };
    expect(parseCommand(["greet", "Ada"], aliases)).toEqual({
      kind: "write",
      doc: "widget",
      ops: [{ op: "replace", path: "/name", value: "Ada" }],
    });
  });

  test("an unrecognized or missing command is undefined", () => {
    expect(parseCommand([])).toBeUndefined();
    expect(parseCommand(["nonsense"])).toBeUndefined();
  });
});

describe("extractFlag", () => {
  test("pulls a `--flag <value>` out, wherever it appears, or `--flag=<value>`", () => {
    expect(extractFlag(["--session", "alice.session", "write", "widget"], "--session")).toEqual({ value: "alice.session", rest: ["write", "widget"] });
    expect(extractFlag(["watch", "--limit", "5"], "--limit")).toEqual({ value: "5", rest: ["watch"] });
    expect(extractFlag(["inspect", "--limit=10"], "--limit")).toEqual({ value: "10", rest: ["inspect"] });
  });

  test("no flag, or one with nothing after it, has no value", () => {
    expect(extractFlag(["watch"], "--limit")).toEqual({ value: undefined, rest: ["watch"] });
    expect(extractFlag(["undo", "--session"], "--session")).toEqual({ value: undefined, rest: ["undo"] });
  });

  test("extractSessionFile falls back to the default session file", () => {
    expect(extractSessionFile(["undo"])).toEqual({ sessionFile: DEFAULT_SESSION_FILE, rest: ["undo"] });
    expect(extractSessionFile(["watch", "--session=bob.session"])).toEqual({ sessionFile: "bob.session", rest: ["watch"] });
  });
});

describe("formatInspection", () => {
  test("renders each doc's type, version, and last (most recent) ops as plain text, generically", () => {
    const text = formatInspection({
      docs: [
        {
          doc: "widget",
          version: 2,
          entries: [{ ops: [{ op: "replace", path: "/color", value: "blue" }] }, { ops: [{ op: "replace", path: "/color", value: "red" }] }],
        },
        { doc: "gadget", version: 1 },
      ],
    });

    expect(text).toBe(["widget   v2  last: replace /color \"blue\"", "gadget   v1"].join("\n"));
  });

  test("a value-less op (e.g. remove) formats without a trailing value", () => {
    const text = formatInspection({
      docs: [{ doc: "widget", version: 1, entries: [{ ops: [{ op: "remove", path: "/color" }] }] }],
    });
    expect(text).toContain("last: remove /color");
  });

  test("no docs at all formats as an empty string", () => {
    expect(formatInspection({ docs: [] })).toBe("");
  });
});

describe("formatHistory", () => {
  test("lists a doc's entries oldest first, one line each", () => {
    const lines = formatHistory({
      doc: "widget",
      entries: [
        { ops: [{ op: "replace", path: "/color", value: "red" }] }, // newest (history() orders DESC)
        { ops: [{ op: "replace", path: "/color", value: "blue" }] }, // oldest
      ],
    });
    expect(lines).toEqual(['widget  replace /color "blue"', 'widget  replace /color "red"']);
  });

  test("no entries formats as no lines", () => {
    expect(formatHistory({ doc: "widget" })).toEqual([]);
  });
});

describe("loadOrCreateSessionCookie", () => {
  test("mints and persists a session id on first use, then reuses it", () => {
    const dir = mkdtempSync(join(tmpdir(), "eta-cli-"));
    const file = join(dir, "session");

    const first = loadOrCreateSessionCookie(file);
    expect(first).toMatch(/^session_id=[0-9a-f-]{36}$/);
    expect(readFileSync(file, "utf8")).toBe(first.slice("session_id=".length));

    const second = loadOrCreateSessionCookie(file);
    expect(second).toBe(first);

    rmSync(dir, { recursive: true });
  });
});

// A tiny, self-contained resource + example, the same kind server.test.ts uses -- proving the
// CLI's generic commands (inspect/watch/undo/write) work against any example, without needing the
// chat example to exist. A widget per session, its colour, kept in a delta of this file's own.
const db = new Database(":memory:");
const schema = defineSchema({ widgets: { columns: { color: { type: "text", nullable: false, default: "" } as never }, temporal: false } });
createTables(db, schema);
const delta = createLocal();
registerDocs(delta.server, db, schema, [defineDoc("widget:", { root: "widgets", include: [], implied: true })], [], { ledger: true });

const widgetResource: Resource = {
  docType: "widget",
  perSession: true,
  under: "/widgets",
  resolveDoc(ws) {
    return ws.data.sessionId;
  },
  permit(_ws, op) {
    if (op.value === "plaid") throw refuse("No plaid.");
    return op.path === "/color" && op.op === "replace";
  },
};

const cliTestExample: Example = {
  name: "cli-test",
  // a sign-in that takes one password, as an app's own does
  routes: {
    "/login": async (req) => {
      const form = await req.formData();
      if (req.headers.get("origin") !== new URL(req.url).origin || form.get("password") !== "right") return new Response(null, { status: 303, headers: { Location: "/" } });
      return new Response(null, { status: 303, headers: { Location: "/", "Set-Cookie": `session_id=signed-${form.get("email")}; Path=/` } });
    },
  },
  resources: [widgetResource],
  render: (sessionId) => `<p>${read<{ widgets: { color: string } }>(`widget:${sessionId}`).widgets.color}</p>`,
  active: () => true,
  index,
  delta,
};

describe("cli against a real server", () => {
  let server: ReturnType<typeof createServer>;

  beforeAll(() => {
    server = createServer(cliTestExample, 0);
  });

  afterAll(() => {
    server.stop(true);
  });

  function url(): string {
    return new URL("/ws", server.url).toString().replace("http", "ws");
  }

  test("connectCli rejects when there's nothing listening", async () => {
    const throwaway = createServer(cliTestExample, 0);
    const deadUrl = new URL("/ws", throwaway.url).toString().replace("http", "ws");
    throwaway.stop(true);

    await expect(connectCli(deadUrl, "session_id=x")).rejects.toThrow("could not connect");
  });

  test("a generic write round-trips through inspect", async () => {
    const cookie = `session_id=${crypto.randomUUID()}`;
    const ws = await connectCli(url(), cookie);

    const inspection = await runCommand(ws, parseCommand(["write", "widget", "replace", "/color", "blue"])!);

    const widget = inspection.docs.find((d) => d.doc === "widget");
    expect(widget?.version).toBeGreaterThan(0);
    expect(widget?.entries?.[0]?.ops).toEqual([{ op: "replace", path: "", value: { color: "blue" } }]); // the widget as it is now, its id (the session) left out

    ws.close();
  });

  test("a refused write says so, and why when its refusal says; one that lands says nothing of it", async () => {
    const ws = await connectCli(url(), `session_id=${crypto.randomUUID()}`);
    expect((await runCommand(ws, parseCommand(["write", "widget", "replace", "/color", "plaid"])!)).refused).toEqual({ reason: "No plaid." });
    expect((await runCommand(ws, parseCommand(["write", "widget", "remove", "/color"])!)).refused).toEqual({});
    expect(await runCommand(ws, parseCommand(["write", "widget", "replace", "/color", "teal"])!)).not.toHaveProperty("refused");
    ws.close();
  });

  test("login signs in by the app's own form, from the app's own origin, and answers the session it is given; a wrong one, none", async () => {
    expect(await signIn(url(), { email: "ada", password: "right" })).toBe("signed-ada");
    expect(await signIn(url(), { email: "ada", password: "wrong" })).toBeUndefined();
  });

  test("an app is found by its name among eta's examples, or by its own folder", () => {
    expect(appDir()).toEndWith("/src/rendering/../../examples/chat");
    expect(appDir("leave")).toEndWith("/src/rendering/../../examples/leave");
    expect(appDir("./app")).toBe(`${process.cwd()}/app`);
    expect(appDir("model/")).toBe(`${process.cwd()}/model`);
  });

  test("undo walks back the last write", async () => {
    const cookie = `session_id=${crypto.randomUUID()}`;
    const ws = await connectCli(url(), cookie);

    await runCommand(ws, parseCommand(["write", "widget", "replace", "/color", "green"])!);
    const afterUndo = await runCommand(ws, parseCommand(["undo"])!);

    const widget = afterUndo.docs.find((d) => d.doc === "widget");
    expect(widget?.entries?.[0]?.ops).toEqual([{ op: "replace", path: "", value: { color: "" } }]);

    ws.close();
  });

  test("a plain inspect with no prior write reports the doc it sees, with no ledger history yet", async () => {
    const cookie = `session_id=${crypto.randomUUID()}`;
    const ws = await connectCli(url(), cookie);

    const inspection = await runCommand(ws, parseCommand(["inspect"])!);

    expect(inspection.docs).toEqual([{ doc: "widget", version: 0, entries: [] }]);

    ws.close();
  });

  test("a limit passed to runCommand asks the server for that many entries", async () => {
    const cookie = `session_id=${crypto.randomUUID()}`;
    const ws = await connectCli(url(), cookie);

    await runCommand(ws, parseCommand(["write", "widget", "replace", "/color", "red"])!);
    await runCommand(ws, parseCommand(["write", "widget", "replace", "/color", "green"])!);
    const inspection = await runCommand(ws, parseCommand(["write", "widget", "replace", "/color", "blue"])!, 3);

    const widget = inspection.docs.find((d) => d.doc === "widget");
    expect(widget?.entries?.map((e) => e.ops)).toEqual([
      [{ op: "replace", path: "", value: { color: "blue" } }],
      [{ op: "replace", path: "", value: { color: "green" } }],
      [{ op: "replace", path: "", value: { color: "red" } }],
    ]);

    ws.close();
  });

  test("watch reports patches as they arrive", async () => {
    const cookie = `session_id=${crypto.randomUUID()}`;
    const ws = await connectCli(url(), cookie);
    const lines: string[] = [];
    watch(ws, (line) => lines.push(line));

    await runCommand(ws, parseCommand(["write", "widget", "replace", "/color", "red"])!);

    expect(lines).toEqual(['widget v1  replace /color "red"']); // what changed of the widget, at its path

    ws.close();
  });
});
