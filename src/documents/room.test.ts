import { describe, expect, test } from "bun:test";
import { history } from "../ledger";
import { ensureExists, list, patch, read } from "./room";

describe("room document", () => {
  test("a fresh room reads as empty", () => {
    expect(read(crypto.randomUUID())).toEqual({ transcript: [] });
  });

  test("patching /transcript/- appends a message and returns it", () => {
    const room = crypto.randomUUID();
    const added = patch(
      room,
      [{ op: "add", path: "/transcript/-", value: { name: "Ada", text: "hello" } }],
      "session-1",
    );

    expect(added?.name).toBe("Ada");
    expect(added?.text).toBe("hello");
    expect(typeof added?.sentAt).toBe("number");
    expect(read(room).transcript.map((m) => `${m.name}: ${m.text}`)).toEqual(["Ada: hello"]);
  });

  test("messages read back in chronological order", () => {
    const room = crypto.randomUUID();
    patch(room, [{ op: "add", path: "/transcript/-", value: { name: "Ada", text: "first" } }], "session-1");
    patch(room, [{ op: "add", path: "/transcript/-", value: { name: "Grace", text: "second" } }], "session-2");

    expect(read(room).transcript.map((m) => m.text)).toEqual(["first", "second"]);
  });

  test("read respects the limit, keeping only the most recent", () => {
    const room = crypto.randomUUID();
    for (let i = 0; i < 5; i++) {
      patch(room, [{ op: "add", path: "/transcript/-", value: { name: "Bot", text: `message ${i}` } }], "session-1");
    }

    expect(read(room, 2).transcript.map((m) => m.text)).toEqual(["message 3", "message 4"]);
  });

  test("an unrecognized op is ignored and returns no added message", () => {
    const room = crypto.randomUUID();
    expect(patch(room, [{ op: "remove", path: "/transcript/0" }], "session-1")).toBeUndefined();
    expect(read(room).transcript).toEqual([]);
  });

  test("ensureExists then list includes the room", () => {
    const room = crypto.randomUUID();
    expect(list()).not.toContain(room);

    ensureExists(room);

    expect(list()).toContain(room);
  });

  test("patching records two versions in the ledger with correct inverses", () => {
    const room = crypto.randomUUID();
    patch(room, [{ op: "add", path: "/transcript/-", value: { name: "Ada", text: "first" } }], "session-1");
    patch(room, [{ op: "add", path: "/transcript/-", value: { name: "Grace", text: "second" } }], "session-2");

    const entries = history(`room:${room}`);

    expect(entries.map((e) => e.version)).toEqual([2, 1]); // newest first
    expect(entries[0]?.sessionId).toBe("session-2");
    expect(entries[0]?.inverse).toEqual([{ op: "remove", path: "/transcript/1" }]);
    expect(entries[1]?.sessionId).toBe("session-1");
    expect(entries[1]?.inverse).toEqual([{ op: "remove", path: "/transcript/0" }]);
  });

  test("an ignored (unrecognized) op does not record a ledger entry", () => {
    const room = crypto.randomUUID();
    patch(room, [{ op: "remove", path: "/transcript/0" }], "session-1");

    expect(history(`room:${room}`)).toEqual([]);
  });
});
