import { describe, expect, test } from "bun:test";
import { history, record } from "../ledger";
import { patch as patchRoom, read as readRoom } from "./room";
import { patch as patchSession, read as readSession } from "./session";
import { undo } from "./undo";

describe("undo", () => {
  test("returns undefined when the session has nothing to undo", () => {
    expect(undo(crypto.randomUUID())).toBeUndefined();
  });

  test("walks back a session document write", () => {
    const id = crypto.randomUUID();
    patchSession(id, [{ op: "replace", path: "/name", value: "Ada" }]);

    const outcome = undo(id);

    expect(outcome).toEqual({ docType: "session", docId: id, version: 2, applied: [{ op: "remove", path: "/name" }] });
    expect(readSession(id)).toEqual({ name: null, room: null });
  });

  test("walks back a room document write made by this session", () => {
    const id = crypto.randomUUID();
    const room = crypto.randomUUID();
    patchRoom(room, [{ op: "add", path: "/transcript/-", value: { name: "Ada", text: "hello" } }], id);

    const outcome = undo(id);

    expect(outcome?.docType).toBe("room");
    expect(outcome?.docId).toBe(room);
    expect(outcome?.applied).toEqual([{ op: "remove", path: "/transcript/0" }]);
    expect(readRoom(room).transcript).toEqual([]);
  });

  test("a second undo walks further back rather than redoing the first undo", () => {
    const id = crypto.randomUUID();
    patchSession(id, [{ op: "replace", path: "/name", value: "Ada" }]);
    patchSession(id, [{ op: "replace", path: "/room", value: "general" }]);

    const first = undo(id);
    expect(first?.applied).toEqual([{ op: "remove", path: "/room" }]);

    const second = undo(id);
    expect(second?.applied).toEqual([{ op: "remove", path: "/name" }]);

    // nothing left: the two undos above are not themselves undoable writes
    expect(undo(id)).toBeUndefined();
  });

  test("undo is itself recorded in the ledger, attributed to the session that pressed it", () => {
    const id = crypto.randomUUID();
    patchSession(id, [{ op: "replace", path: "/name", value: "Ada" }]);

    undo(id);

    const entries = history(`session:${id}`);
    expect(entries[0]?.sessionId).toBe(id);
    expect(entries[0]?.ops).toEqual([{ op: "remove", path: "/name" }]);
  });

  test("undoing a different session's writes is not possible: sessions only ever see their own", () => {
    const a = crypto.randomUUID();
    const b = crypto.randomUUID();
    patchSession(a, [{ op: "replace", path: "/name", value: "Ada" }]);

    expect(undo(b)).toBeUndefined();
    expect(readSession(a).name).toBe("Ada");
  });

  test("an entry for a doc type neither session nor room owns is not undoable", () => {
    const id = crypto.randomUUID();
    record(`widget:${crypto.randomUUID()}`, [{ op: "replace", path: "/x", value: 1 }], [{ op: "remove", path: "/x" }], id);

    expect(undo(id)).toBeUndefined();
  });
});
