import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { connectCli, parseCommand, runCommand, watch } from "../../src/cli/commands";
import { createServer } from "../../src/server";
import { aliases } from "./cli";
import { example } from "./index";

describe("chat's cli aliases", () => {
  test("each verb maps to its wire ops", () => {
    expect(parseCommand(["name", "Ada"], aliases)).toEqual({
      kind: "write",
      doc: "session",
      ops: [{ op: "replace", path: "/name", value: "Ada" }],
    });
    expect(parseCommand(["room", "lobby"], aliases)).toEqual({
      kind: "write",
      doc: "session",
      ops: [{ op: "replace", path: "/room", value: "lobby" }],
    });
    expect(parseCommand(["leave"], aliases)).toEqual({
      kind: "write",
      doc: "session",
      ops: [{ op: "remove", path: "/room" }],
    });
    expect(parseCommand(["logout"], aliases)).toEqual({
      kind: "write",
      doc: "session",
      ops: [{ op: "remove", path: "/name" }],
    });
    expect(parseCommand(["send", "hello", "world"], aliases)).toEqual({
      kind: "write",
      doc: "room",
      ops: [{ op: "add", path: "/messages/-", value: "hello world" }],
    });
  });

  test("undo, inspect, and watch stay the kernel's own generic commands, not chat aliases", () => {
    expect(parseCommand(["undo"], aliases)).toEqual({
      kind: "write",
      doc: "ledger",
      ops: [{ op: "remove", path: "/latest" }],
    });
    expect(parseCommand(["inspect"], aliases)).toEqual({ kind: "inspect" });
    expect(parseCommand(["watch"], aliases)).toEqual({ kind: "watch" });
  });
});

describe("chat's cli against a real server", () => {
  let server: ReturnType<typeof createServer>;

  beforeAll(() => {
    server = createServer(example, 0);
  });

  afterAll(() => {
    server.stop(true);
  });

  function url(): string {
    return new URL("/ws", server.url).toString().replace("http", "ws");
  }

  test("name, room, and send round-trip through inspect -- and the session id is never in it", async () => {
    const sessionId = crypto.randomUUID();
    const cookie = `session_id=${sessionId}`;
    const ws = await connectCli(url(), cookie);

    await runCommand(ws, parseCommand(["name", "Ada"], aliases)!);
    await runCommand(ws, parseCommand(["room", "lobby"], aliases)!);
    const afterSend = await runCommand(ws, parseCommand(["send", "hello"], aliases)!);

    const session = afterSend.docs.find((d) => d.doc === "session");
    const room = afterSend.docs.find((d) => d.doc === "room:lobby");
    // a session's change is its whole row, at eta's paths, its id -- the session id -- taken out
    expect(session?.entries?.[0]?.ops).toEqual([{ op: "replace", path: "", value: { name: "Ada", room: "lobby" } }]);
    expect(room?.version).toBeGreaterThan(0);
    expect(room?.entries?.[0]?.ops).toMatchObject([{ op: "add", value: { name: "Ada", text: "hello" } }]);
    expect(JSON.stringify(afterSend)).not.toContain(sessionId);

    ws.close();
  });

  test("undo walks back the last write", async () => {
    const cookie = `session_id=${crypto.randomUUID()}`;
    const ws = await connectCli(url(), cookie);

    await runCommand(ws, parseCommand(["name", "Grace"], aliases)!);
    const afterUndo = await runCommand(ws, parseCommand(["undo"], aliases)!);

    const session = afterUndo.docs.find((d) => d.doc === "session");
    expect(session?.entries?.[0]?.ops).toEqual([{ op: "replace", path: "", value: { name: null, room: null } }]);

    ws.close();
  });

  test("a plain inspect with no prior write reports the fresh session", async () => {
    const cookie = `session_id=${crypto.randomUUID()}`;
    const ws = await connectCli(url(), cookie);

    const inspection = await runCommand(ws, parseCommand(["inspect"], aliases)!);

    expect(inspection.docs).toEqual([{ doc: "session", version: 0, entries: [] }]);

    ws.close();
  });

  test("watch reports patches as they arrive", async () => {
    const cookie = `session_id=${crypto.randomUUID()}`;
    const ws = await connectCli(url(), cookie);
    const lines: string[] = [];
    watch(ws, (line) => lines.push(line));

    await runCommand(ws, parseCommand(["name", "Watcher"], aliases)!);

    expect(lines).toEqual(['session v1  replace  {"name":"Watcher","room":null}']);

    ws.close();
  });
});
