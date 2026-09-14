import type { ServerWebSocket } from "bun";
import { describe, expect, test } from "bun:test";
import { patch, read } from "./session";
import { roomSockets } from "../rooms";
import type { SessionData } from "../session";

function fakeSocket(): ServerWebSocket<SessionData> {
  return {} as ServerWebSocket<SessionData>;
}

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

  test("patching /room joins the room and updates the document", () => {
    const id = crypto.randomUUID();
    const ws = fakeSocket();
    const room = crypto.randomUUID();

    patch(id, [{ op: "replace", path: "/name", value: "Ada" }]);
    patch(id, [{ op: "replace", path: "/room", value: room }], ws);

    expect(read(id)).toEqual({ name: "Ada", room });
    expect(roomSockets(room).has(ws)).toBe(true);
  });

  test("switching rooms leaves the previous room's socket set", () => {
    const id = crypto.randomUUID();
    const ws = fakeSocket();
    const first = crypto.randomUUID();
    const second = crypto.randomUUID();

    patch(id, [{ op: "replace", path: "/room", value: first }], ws);
    patch(id, [{ op: "replace", path: "/room", value: second }], ws);

    expect(roomSockets(first).has(ws)).toBe(false);
    expect(roomSockets(second).has(ws)).toBe(true);
    expect(read(id).room).toBe(second);
  });

  test("removing /room leaves the room and clears it from the document", () => {
    const id = crypto.randomUUID();
    const ws = fakeSocket();
    const room = crypto.randomUUID();

    patch(id, [{ op: "replace", path: "/room", value: room }], ws);
    patch(id, [{ op: "remove", path: "/room" }], ws);

    expect(read(id).room).toBeNull();
    expect(roomSockets(room).has(ws)).toBe(false);
  });

  test("removing /name logs out: clears name, room, and room membership", () => {
    const id = crypto.randomUUID();
    const ws = fakeSocket();
    const room = crypto.randomUUID();

    patch(id, [{ op: "replace", path: "/name", value: "Ada" }]);
    patch(id, [{ op: "replace", path: "/room", value: room }], ws);

    patch(id, [{ op: "remove", path: "/name" }], ws);

    expect(read(id)).toEqual({ name: null, room: null });
    expect(roomSockets(room).has(ws)).toBe(false);
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
});
