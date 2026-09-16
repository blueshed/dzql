import { describe, expect, test } from "bun:test";
import { history } from "../../../src/ledger";
import { patch, read } from "./session";

describe("session document", () => {
  test("a fresh session id reads as an empty document", () => {
    expect(read(crypto.randomUUID())).toEqual({ name: null, room: null, ui: {} });
  });

  test("patching /name sets the session's name", () => {
    const id = crypto.randomUUID();
    patch(id, [{ op: "replace", path: "/name", value: "Ada" }]);
    expect(read(id)).toEqual({ name: "Ada", room: null, ui: {} });
  });

  test("a blank name is ignored", () => {
    const id = crypto.randomUUID();
    patch(id, [{ op: "replace", path: "/name", value: "   " }]);
    expect(read(id)).toEqual({ name: null, room: null, ui: {} });
  });

  test("patching /room sets the room, upserting the row if it didn't exist", () => {
    const id = crypto.randomUUID();
    const room = crypto.randomUUID();

    patch(id, [{ op: "replace", path: "/room", value: room }]);

    expect(read(id)).toEqual({ name: null, room, ui: { open: "conversation" } }); // entering a room opens the conversation
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

    expect(read(id)).toEqual({ name: null, room: null, ui: {} });
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
    expect(read(id)).toEqual({ name: null, room: null, ui: {} });
  });

  test("patch returns the new version and applied ops, recorded in the same ledger table as room patches", () => {
    const id = crypto.randomUUID();

    const result = patch(id, [{ op: "replace", path: "/name", value: "Ada" }]);
    expect(result.version).toBe(1);
    expect(result.applied).toEqual([{ op: "replace", path: "/name", value: "Ada" }]);

    const entries = history(`session:${id}`);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.sessionId).toBe(id);
    // Not `{ op: "replace", value: null }`: patch() treats a blank/null value as
    // invalid and ignores it, so restoring "no name" must be a real removal.
    expect(entries[0]?.inverse).toEqual([{ op: "remove", path: "/name" }]);
  });

  test("a patch that changes nothing does not record a ledger entry or bump the version", () => {
    const id = crypto.randomUUID();

    const result = patch(id, [{ op: "replace", path: "/name", value: "   " }]);

    expect(result.version).toBe(0);
    expect(result.applied).toEqual([]);
    expect(history(`session:${id}`)).toEqual([]);
  });

  test("logging out while in a room produces an inverse that restores both /name and /room", () => {
    const id = crypto.randomUUID();
    const room = crypto.randomUUID();

    patch(id, [{ op: "replace", path: "/name", value: "Ada" }]);
    patch(id, [{ op: "replace", path: "/room", value: room }]);
    patch(id, [{ op: "remove", path: "/name" }]);

    const entries = history(`session:${id}`);
    expect(entries[0]?.inverse).toEqual([
      { op: "replace", path: "/name", value: "Ada" },
      { op: "replace", path: "/room", value: room },
    ]);
  });

  test("logging out while in no room produces an inverse that only restores /name", () => {
    const id = crypto.randomUUID();

    patch(id, [{ op: "replace", path: "/name", value: "Ada" }]);
    patch(id, [{ op: "remove", path: "/name" }]);

    const entries = history(`session:${id}`);
    expect(entries[0]?.inverse).toEqual([{ op: "replace", path: "/name", value: "Ada" }]);
  });

  test("the tray's own state -- what is open, whose drawer, what find says -- is the visit's, kept off the ledger", () => {
    const id = crypto.randomUUID();
    patch(id, [{ op: "replace", path: "/name", value: "Ada" }]);
    const rows = history(`session/${id}`).length;
    patch(id, [
      { op: "replace", path: "/open", value: "people" },
      { op: "replace", path: "/focus", value: "Bob" },
      { op: "replace", path: "/filter/rooms", value: "ge" },
      { op: "replace", path: "/hide/rooms", value: true },
    ]);
    expect(read(id).ui).toEqual({ open: "people", focus: "Bob", filter: { rooms: "ge" }, hide: { rooms: true } });
    expect(history(`session/${id}`).length).toBe(rows); // nothing recorded
    // opening another compartment closes the drawer; an unknown compartment does not open
    patch(id, [{ op: "replace", path: "/open", value: "rooms" }]);
    expect(read(id).ui).toEqual({ open: "rooms", filter: { rooms: "ge" }, hide: { rooms: true } });
    expect(patch(id, [{ op: "replace", path: "/open", value: "attic" }]).applied).toEqual([]);
    // the modal opens and closes; only the room's is one
    patch(id, [{ op: "replace", path: "/new", value: "rooms" }]);
    expect(read(id).ui.new).toBe("rooms");
    expect(patch(id, [{ op: "replace", path: "/new", value: "people" }]).applied).toEqual([]);
    patch(id, [{ op: "remove", path: "/new" }]);
    expect(read(id).ui.new).toBeUndefined();
    // closing find forgets the eye with the word; a blank focus is ignored; a stray key too
    patch(id, [{ op: "remove", path: "/filter/rooms" }]);
    expect(read(id).ui).toEqual({ open: "rooms" });
    expect(patch(id, [{ op: "replace", path: "/focus", value: "  " }]).applied).toEqual([]);
    expect(patch(id, [{ op: "remove", path: "/hide/rooms" }]).applied).toEqual([]);
    expect(patch(id, [{ op: "replace", path: "/attic", value: 1 }]).applied).toEqual([]);
  });

  test("entering a room opens the conversation and closes the rest; leaving and logging out clear the tray", () => {
    const id = crypto.randomUUID();
    const room = crypto.randomUUID();
    patch(id, [{ op: "replace", path: "/name", value: "Ada" }, { op: "replace", path: "/open", value: "rooms" }, { op: "replace", path: "/filter/rooms", value: "x" }]);
    patch(id, [{ op: "replace", path: "/room", value: room }]);
    expect(read(id).ui).toEqual({ open: "conversation", filter: { rooms: "x" } });
    patch(id, [{ op: "replace", path: "/open", value: "people" }, { op: "replace", path: "/focus", value: "Ada" }]);
    patch(id, [{ op: "replace", path: "/room", value: room }]); // the same room again: nothing changes
    expect(read(id).ui).toEqual({ open: "people", focus: "Ada", filter: { rooms: "x" } });
    patch(id, [{ op: "remove", path: "/room" }]);
    expect(read(id).ui).toEqual({ filter: { rooms: "x" } });
    patch(id, [{ op: "remove", path: "/name" }]);
    expect(read(id)).toEqual({ name: null, room: null, ui: {} });
  });
});
