import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Concept } from "../concepts/concept";
import type { Example } from "../example";
import index from "../server.test.fixture.html";
import { patchMessage } from "../json-patch";
import { prefixDoc, record } from "../ledger";
import { createServer } from "../server";
import {
  connectCli,
  DEFAULT_SESSION_FILE,
  extractLimit,
  extractSessionFile,
  formatHistory,
  formatInspection,
  loadOrCreateSessionCookie,
  parseCommand,
  runCommand,
  watch,
} from "./commands";

describe("parseCommand", () => {
  test("inspect, watch, and undo take no argument", () => {
    expect(parseCommand(["inspect"])).toEqual({ kind: "inspect" });
    expect(parseCommand(["watch"])).toEqual({ kind: "watch" });
    expect(parseCommand(["undo"])).toEqual({
      kind: "write",
      doc: "ledger",
      ops: [{ op: "remove", path: "/latest" }],
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

describe("extractSessionFile", () => {
  test("defaults to the default session file when no flag is present", () => {
    expect(extractSessionFile(["undo"])).toEqual({
      sessionFile: DEFAULT_SESSION_FILE,
      rest: ["undo"],
    });
  });

  test("pulls a `--session <file>` flag out, wherever it appears", () => {
    expect(extractSessionFile(["--session", "alice.session", "write", "widget"])).toEqual({
      sessionFile: "alice.session",
      rest: ["write", "widget"],
    });
    expect(extractSessionFile(["write", "widget", "--session", "alice.session"])).toEqual({
      sessionFile: "alice.session",
      rest: ["write", "widget"],
    });
  });

  test("accepts `--session=<file>` too", () => {
    expect(extractSessionFile(["watch", "--session=bob.session"])).toEqual({
      sessionFile: "bob.session",
      rest: ["watch"],
    });
  });

  test("a `--session` with nothing after it falls back to the default", () => {
    expect(extractSessionFile(["undo", "--session"])).toEqual({
      sessionFile: DEFAULT_SESSION_FILE,
      rest: ["undo"],
    });
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

describe("extractLimit", () => {
  test("no flag leaves limit undefined", () => {
    expect(extractLimit(["watch"])).toEqual({ limit: undefined, rest: ["watch"] });
  });

  test("pulls a `--limit <n>` flag out, wherever it appears", () => {
    expect(extractLimit(["--limit", "5", "watch"])).toEqual({ limit: 5, rest: ["watch"] });
    expect(extractLimit(["watch", "--limit", "5"])).toEqual({ limit: 5, rest: ["watch"] });
  });

  test("accepts `--limit=<n>` too", () => {
    expect(extractLimit(["inspect", "--limit=10"])).toEqual({ limit: 10, rest: ["inspect"] });
  });

  test("a non-numeric or missing value leaves limit undefined", () => {
    expect(extractLimit(["--limit", "nonsense", "watch"])).toEqual({ limit: undefined, rest: ["watch"] });
    expect(extractLimit(["--limit"])).toEqual({ limit: undefined, rest: [] });
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

// A tiny, self-contained concept + example, the same kind server.test.ts
// uses -- proving the CLI's generic commands (inspect/watch/undo/write) work
// against any example, without needing the chat example to exist.
type WidgetState = { color: string };
const widgets = new Map<string, WidgetState>();

const widgetConcept: Concept = {
  docType: "widget",
  render(sessionId) {
    return `<p>${widgets.get(sessionId)?.color ?? ""}</p>`;
  },
  resolveDoc(ws) {
    return ws.data.sessionId;
  },
  permit(ws, op) {
    return op.path === "/color" && op.op === "replace";
  },
  write(ws, id, ops) {
    const before = widgets.get(id) ?? { color: "" };
    const applied = ops.filter((op) => op.path === "/color" && op.op === "replace");
    const inverse = applied.map(() => ({ op: "replace" as const, path: "/color", value: before.color }));
    if (applied[0]) widgets.set(id, { color: String(applied[0].value ?? "") });
    const version = record(prefixDoc("widget", id), applied, inverse, ws.data.sessionId);
    if (applied.length > 0) ws.send(patchMessage("widget", version, applied));
    return { version, applied };
  },
  replay(ws, id, ops, undoes) {
    const before = widgets.get(id) ?? { color: "" };
    const applied = ops;
    const inverse = applied.map(() => ({ op: "replace" as const, path: "/color", value: before.color }));
    const value = applied[applied.length - 1]?.value;
    widgets.set(id, { color: value !== undefined ? String(value) : "" });
    const version = record(prefixDoc("widget", id), applied, inverse, ws.data.sessionId, undoes);
    if (applied.length > 0) ws.send(patchMessage("widget", version, applied));
    return { version, applied };
  },
};

const cliTestExample: Example = {
  name: "cli-test",
  concepts: [widgetConcept],
  active: () => true,
  index,
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
    expect(widget?.entries?.[0]?.ops).toEqual([{ op: "replace", path: "/color", value: "blue" }]);

    ws.close();
  });

  test("undo walks back the last write", async () => {
    const cookie = `session_id=${crypto.randomUUID()}`;
    const ws = await connectCli(url(), cookie);

    await runCommand(ws, parseCommand(["write", "widget", "replace", "/color", "green"])!);
    const afterUndo = await runCommand(ws, parseCommand(["undo"])!);

    const widget = afterUndo.docs.find((d) => d.doc === "widget");
    expect(widget?.entries?.[0]?.ops).toEqual([{ op: "replace", path: "/color", value: "" }]);

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
      [{ op: "replace", path: "/color", value: "blue" }],
      [{ op: "replace", path: "/color", value: "green" }],
      [{ op: "replace", path: "/color", value: "red" }],
    ]);

    ws.close();
  });

  test("watch reports patches as they arrive", async () => {
    const cookie = `session_id=${crypto.randomUUID()}`;
    const ws = await connectCli(url(), cookie);
    const lines: string[] = [];
    watch(ws, (line) => lines.push(line));

    await runCommand(ws, parseCommand(["write", "widget", "replace", "/color", "red"])!);

    expect(lines).toEqual(['widget v1  replace /color "red"']);

    ws.close();
  });
});
