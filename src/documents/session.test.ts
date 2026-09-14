import { describe, expect, test } from "bun:test";
import { history } from "../ledger";
import { patch, read } from "./session";

describe("session document", () => {
  test("a fresh session id reads as an empty document", () => {
    expect(read(crypto.randomUUID())).toEqual({ name: null, room: null });
  });

  test("patching /name sets the session's name", () => {
    const id = crypto.randomUUID();
    patch(id, [{ op: "replace", path: "/name", value: "Ada" }]);
    expect(read(id)).toEqual({ name: "Ada", room: null });
  });

  test("a blank name is ignored", () => {
    const id = crypto.randomUUID();
    patch(id, [{ op: "replace", path: "/name", value: "   " }]);
    expect(read(id)).toEqual({ name: null, room: null });
  });

  test("patching /room sets the room, upserting the row if it didn't exist", () => {
    const id = crypto.randomUUID();
    const room = crypto.randomUUID();

    patch(id, [{ op: "replace", path: "/room", value: room }]);

    expect(read(id)).toEqual({ name: null, room });
  });

  test("a blank room is ignored", () => {
    const id = crypto.randomUUID();
    patch(id, [{ op: "replace", path: "/room", value: "   " }]);
    expect(read(id).room).toBeNull();
  });

  test("switching rooms updates the document to the new room", () => {
    const id = crypto.randomUUID();
    const first = crypto.randomUUID();
    const second = crypto.randomUUID();

    patch(id, [{ op: "replace", path: "/room", value: first }]);
    patch(id, [{ op: "replace", path: "/room", value: second }]);

    expect(read(id).room).toBe(second);
  });

  test("removing /room clears it from the document", () => {
    const id = crypto.randomUUID();
    const room = crypto.randomUUID();

    patch(id, [{ op: "replace", path: "/room", value: room }]);
    patch(id, [{ op: "remove", path: "/room" }]);

    expect(read(id).room).toBeNull();
  });

  test("removing /name logs out: clears both name and room", () => {
    const id = crypto.randomUUID();
    const room = crypto.randomUUID();

    patch(id, [{ op: "replace", path: "/name", value: "Ada" }]);
    patch(id, [{ op: "replace", path: "/room", value: room }]);
    patch(id, [{ op: "remove", path: "/name" }]);

    expect(read(id)).toEqual({ name: null, room: null });
  });

  test("a session can set a name again after logging out (reactivation, not gone forever)", () => {
    const id = crypto.randomUUID();

    patch(id, [{ op: "replace", path: "/name", value: "Ada" }]);
    patch(id, [{ op: "remove", path: "/name" }]);
    patch(id, [{ op: "replace", path: "/name", value: "Ada again" }]);

    expect(read(id).name).toBe("Ada again");
  });

  test("an unrecognized path is ignored without throwing", () => {
    const id = crypto.randomUUID();
    expect(() => patch(id, [{ op: "replace", path: "/nope", value: "x" }])).not.toThrow();
    expect(read(id)).toEqual({ name: null, room: null });
  });

  test("patch returns the new version and records it in the same ledger table as room patches", () => {
    const id = crypto.randomUUID();

    const v1 = patch(id, [{ op: "replace", path: "/name", value: "Ada" }]);
    expect(v1).toBe(1);

    const entries = history(`session:${id}`);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.sessionId).toBe(id);
    expect(entries[0]?.inverse).toEqual([{ op: "replace", path: "/name", value: null }]);
  });

  test("a patch that changes nothing does not record a ledger entry or bump the version", () => {
    const id = crypto.randomUUID();

    const version = patch(id, [{ op: "replace", path: "/name", value: "   " }]);

    expect(version).toBe(0);
    expect(history(`session:${id}`)).toEqual([]);
  });
});
