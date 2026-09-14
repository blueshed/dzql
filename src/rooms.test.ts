import type { ServerWebSocket } from "bun";
import { describe, expect, test } from "bun:test";
import { joinRoom, leaveRoom, roomSockets } from "./rooms";
import type { SessionData } from "./session";

function fakeSocket(): ServerWebSocket<SessionData> {
  return {} as ServerWebSocket<SessionData>;
}

describe("rooms", () => {
  test("joinRoom adds a socket to the room's subscriber set", () => {
    const room = crypto.randomUUID();
    const ws = fakeSocket();

    joinRoom(room, ws);

    expect(roomSockets(room).has(ws)).toBe(true);
  });

  test("leaveRoom removes a socket from the room", () => {
    const room = crypto.randomUUID();
    const ws = fakeSocket();
    joinRoom(room, ws);

    leaveRoom(room, ws);

    expect(roomSockets(room).has(ws)).toBe(false);
  });

  test("leaveRoom on an unknown room is a no-op", () => {
    expect(() => leaveRoom(crypto.randomUUID(), fakeSocket())).not.toThrow();
  });

  test("roomSockets on a fresh room returns an empty set", () => {
    expect(roomSockets(crypto.randomUUID()).size).toBe(0);
  });
});
