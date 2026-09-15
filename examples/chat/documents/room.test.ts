import { describe, expect, mock, test } from "bun:test";
import * as ledger from "../../../src/ledger";
import { history } from "../../../src/ledger";
import { ensureExists, list, patch, read } from "./room";

describe("room document", () => {
  test("a fresh room reads as empty", () => {
    expect(read(crypto.randomUUID())).toEqual({ transcript: [] });
  });

  test("patching /transcript/- appends a message and returns it, with the new version", () => {
    const room = crypto.randomUUID();
    const result = patch(
      room,
      [{ op: "add", path: "/transcript/-", value: { name: "Ada", text: "hello" } }],
      "session-1",
    );

    expect(result.version).toBe(1);
    expect(result.applied).toEqual([{ op: "add", path: "/transcript/-", value: { name: "Ada", text: "hello" } }]);
    expect(result.added?.name).toBe("Ada");
    expect(result.added?.text).toBe("hello");
    expect(typeof result.added?.sentAt).toBe("number");
    expect(read(room).transcript.map((m) => `${m.name}: ${m.text}`)).toEqual(["Ada: hello"]);
  });

  test("blank or whitespace-only text is ignored and returns no added message", () => {
    const room = crypto.randomUUID();
    const result = patch(room, [{ op: "add", path: "/transcript/-", value: { name: "Ada", text: "   " } }], "session-1");

    expect(result.added).toBeUndefined();
    expect(result.applied).toEqual([]);
    expect(read(room).transcript).toEqual([]);
  });

  test("leading and trailing whitespace is trimmed from a message's text", () => {
    const room = crypto.randomUUID();
    const result = patch(
      room,
      [{ op: "add", path: "/transcript/-", value: { name: "Ada", text: "  hello  " } }],
      "session-1",
    );

    expect(result.added?.text).toBe("hello");
    expect(read(room).transcript.map((m) => m.text)).toEqual(["hello"]);
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

  test("removing /transcript/N with nothing at that index is ignored and returns no added message", () => {
    const room = crypto.randomUUID();
    const result = patch(room, [{ op: "remove", path: "/transcript/0" }], "session-1");
    expect(result.added).toBeUndefined();
    expect(result.applied).toEqual([]);
    expect(read(room).transcript).toEqual([]);
  });

  test("removing /transcript/N deletes that message, with an inverse that re-adds it", () => {
    const room = crypto.randomUUID();
    patch(room, [{ op: "add", path: "/transcript/-", value: { name: "Ada", text: "first" } }], "session-1");
    patch(room, [{ op: "add", path: "/transcript/-", value: { name: "Grace", text: "second" } }], "session-2");

    const result = patch(room, [{ op: "remove", path: "/transcript/1" }], "session-2");

    expect(result.applied).toEqual([{ op: "remove", path: "/transcript/1" }]);
    expect(read(room).transcript.map((m) => m.text)).toEqual(["first"]);

    const entries = history(`room:${room}`);
    expect(entries[0]?.inverse).toEqual([
      { op: "add", path: "/transcript/-", value: { name: "Grace", text: "second" } },
    ]);
  });

  test("a write can be attributed as undoing an earlier ledger entry", () => {
    const room = crypto.randomUUID();
    patch(room, [{ op: "add", path: "/transcript/-", value: { name: "Ada", text: "first" } }], "session-1");
    const original = history(`room:${room}`)[0]!;

    patch(room, original.inverse, "session-1", original.id);

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

  test("removing from an empty room does not record a ledger entry", () => {
    const room = crypto.randomUUID();
    patch(room, [{ op: "remove", path: "/transcript/0" }], "session-1");

    expect(history(`room:${room}`)).toEqual([]);
  });

  test("a patch is one transaction: if record() throws, nothing it did commits (change-request.md item 11)", () => {
    const room = crypto.randomUUID();
    const versionBefore = history(`room:${room}`)[0]?.version ?? 0;
    // Snapshot the real exports *before* mocking -- `ledger` is a live binding, so restoring
    // via `{ ...ledger }` after the mock is installed would just spread the mock back in.
    const real = { ...ledger };

    mock.module("../../../src/ledger", () => ({
      ...real,
      record: () => {
        throw new Error("simulated ledger failure");
      },
    }));

    try {
      expect(() =>
        patch(room, [{ op: "add", path: "/transcript/-", value: { name: "Ada", text: "boom" } }], "session-1"),
      ).toThrow("simulated ledger failure");
    } finally {
      mock.module("../../../src/ledger", () => real);
    }

    // the message insert that came before record()'s throw rolled back with it
    expect(read(room).transcript).toEqual([]);
    expect(history(`room:${room}`)[0]?.version ?? 0).toBe(versionBefore);
  });

  test("ops outside /transcript and malformed transcript indices are ignored", () => {
    const room = crypto.randomUUID();
    const result = patch(
      room,
      [
        { op: "replace", path: "/name", value: "nope" },
        { op: "remove", path: "/transcript/not-a-number" },
        { op: "remove", path: "/transcript/-1" },
      ],
      "session-1",
    );

    expect(result.applied).toEqual([]);
    expect(read(room).transcript).toEqual([]);
  });
});
