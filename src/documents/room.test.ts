import { describe, expect, test } from "bun:test";
import { ensureExists, list, patch, read } from "./room";

describe("room document", () => {
  test("a fresh room reads as empty", () => {
    expect(read(crypto.randomUUID())).toEqual({ transcript: [] });
  });

  test("patching /transcript/- appends a message and returns it", () => {
    const room = crypto.randomUUID();
    const added = patch(room, [{ op: "add", path: "/transcript/-", value: { name: "Ada", text: "hello" } }]);

    expect(added?.name).toBe("Ada");
    expect(added?.text).toBe("hello");
    expect(typeof added?.sentAt).toBe("number");
    expect(read(room).transcript.map((m) => `${m.name}: ${m.text}`)).toEqual(["Ada: hello"]);
  });

  test("messages read back in chronological order", () => {
    const room = crypto.randomUUID();
    patch(room, [{ op: "add", path: "/transcript/-", value: { name: "Ada", text: "first" } }]);
    patch(room, [{ op: "add", path: "/transcript/-", value: { name: "Grace", text: "second" } }]);

    expect(read(room).transcript.map((m) => m.text)).toEqual(["first", "second"]);
  });

  test("read respects the limit, keeping only the most recent", () => {
    const room = crypto.randomUUID();
    for (let i = 0; i < 5; i++) {
      patch(room, [{ op: "add", path: "/transcript/-", value: { name: "Bot", text: `message ${i}` } }]);
    }

    expect(read(room, 2).transcript.map((m) => m.text)).toEqual(["message 3", "message 4"]);
  });

  test("an unrecognized op is ignored and returns no added message", () => {
    const room = crypto.randomUUID();
    expect(patch(room, [{ op: "remove", path: "/transcript/0" }])).toBeUndefined();
    expect(read(room).transcript).toEqual([]);
  });

  test("ensureExists then list includes the room", () => {
    const room = crypto.randomUUID();
    expect(list()).not.toContain(room);

    ensureExists(room);

    expect(list()).toContain(room);
  });
});
