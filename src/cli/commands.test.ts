import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connectCli, formatInspection, loadOrCreateSessionCookie, parseCommand, runCommand, watch } from "./commands";
import { createServer } from "../server";

describe("parseCommand", () => {
  test("maps each writer command to its wire ops", () => {
    expect(parseCommand(["name", "Ada"])).toEqual({
      kind: "write",
      doc: "session",
      ops: [{ op: "replace", path: "/name", value: "Ada" }],
    });
    expect(parseCommand(["room", "lobby"])).toEqual({
      kind: "write",
      doc: "session",
      ops: [{ op: "replace", path: "/room", value: "lobby" }],
    });
    expect(parseCommand(["leave"])).toEqual({
      kind: "write",
      doc: "session",
      ops: [{ op: "remove", path: "/room" }],
    });
    expect(parseCommand(["logout"])).toEqual({
      kind: "write",
      doc: "session",
      ops: [{ op: "remove", path: "/name" }],
    });
    expect(parseCommand(["send", "hello", "world"])).toEqual({
      kind: "write",
      doc: "room",
      ops: [{ op: "add", path: "/transcript/-", value: "hello world" }],
    });
    expect(parseCommand(["undo"])).toEqual({
      kind: "write",
      doc: "session",
      ops: [{ op: "add", path: "/undo" }],
    });
  });

  test("inspect and watch take no argument", () => {
    expect(parseCommand(["inspect"])).toEqual({ kind: "inspect" });
    expect(parseCommand(["watch"])).toEqual({ kind: "watch" });
  });

  test("an unrecognized or missing command is undefined", () => {
    expect(parseCommand([])).toBeUndefined();
    expect(parseCommand(["nonsense"])).toBeUndefined();
  });
});

describe("formatInspection", () => {
  test("renders session state and each doc's version and last ops as plain text", () => {
    const text = formatInspection({
      session: { name: "Ada", room: "lobby" },
      docs: [
        { doc: "session", version: 2, head: { ops: [{ op: "replace", path: "/room", value: "lobby" }] } },
        { doc: "room", version: 1 },
      ],
    });

    expect(text).toBe(
      [
        "session  name=Ada  room=lobby",
        'session  v2  last: replace /room "lobby"',
        "room     v1",
      ].join("\n"),
    );
  });

  test("an unset name or room prints as a dash", () => {
    const text = formatInspection({ session: { name: null, room: null }, docs: [] });
    expect(text).toBe("session  name=-  room=-");
  });

  test("a value-less op (e.g. remove) formats without a trailing value", () => {
    const text = formatInspection({
      session: { name: "Ada", room: null },
      docs: [{ doc: "session", version: 1, head: { ops: [{ op: "remove", path: "/room" }] } }],
    });
    expect(text).toContain("last: remove /room");
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

describe("cli against a real server", () => {
  let server: ReturnType<typeof createServer>;

  beforeAll(() => {
    server = createServer(0);
  });

  afterAll(() => {
    server.stop(true);
  });

  function url(): string {
    return new URL("/ws", server.url).toString().replace("http", "ws");
  }

  test("connectCli rejects when there's nothing listening", async () => {
    const throwaway = createServer(0);
    const deadUrl = new URL("/ws", throwaway.url).toString().replace("http", "ws");
    throwaway.stop(true);

    await expect(connectCli(deadUrl, "session_id=x")).rejects.toThrow("could not connect");
  });

  test("name, room, and send round-trip through inspect", async () => {
    const cookie = `session_id=${crypto.randomUUID()}`;
    const ws = await connectCli(url(), cookie);

    await runCommand(ws, parseCommand(["name", "Ada"])!);
    await runCommand(ws, parseCommand(["room", "lobby"])!);
    const afterSend = await runCommand(ws, parseCommand(["send", "hello"])!);

    expect(afterSend.session).toEqual({ name: "Ada", room: "lobby" });
    const room = afterSend.docs.find((d) => d.doc === "room");
    expect(room?.version).toBeGreaterThan(0);
    expect(room?.head?.ops).toEqual([
      { op: "add", path: "/transcript/-", value: { name: "Ada", text: "hello" } },
    ]);

    ws.close();
  });

  test("undo walks back the last write", async () => {
    const cookie = `session_id=${crypto.randomUUID()}`;
    const ws = await connectCli(url(), cookie);

    await runCommand(ws, parseCommand(["name", "Grace"])!);
    const afterUndo = await runCommand(ws, parseCommand(["undo"])!);

    expect(afterUndo.session.name).toBeNull();

    ws.close();
  });

  test("a plain inspect with no prior write reports the fresh session", async () => {
    const cookie = `session_id=${crypto.randomUUID()}`;
    const ws = await connectCli(url(), cookie);

    const inspection = await runCommand(ws, parseCommand(["inspect"])!);

    expect(inspection.session).toEqual({ name: null, room: null });
    expect(inspection.docs).toEqual([{ doc: "session", version: 0, head: undefined }]);

    ws.close();
  });

  test("watch reports patches as they arrive", async () => {
    const cookie = `session_id=${crypto.randomUUID()}`;
    const ws = await connectCli(url(), cookie);
    const lines: string[] = [];
    watch(ws, (line) => lines.push(line));

    await runCommand(ws, parseCommand(["name", "Watcher"])!);

    expect(lines).toEqual(['session v1  replace /name "Watcher"']);

    ws.close();
  });
});
