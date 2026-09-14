import type { ServerWebSocket } from "bun";
import { describe, expect, test } from "bun:test";
import { addMessage, getMessages, joinRoom, leaveRoom, roomSockets } from "./rooms";
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

  test("addMessage appends to the room's message list in order", () => {
    const room = crypto.randomUUID();

    addMessage(room, "Ada", "hello");
    addMessage(room, "Grace", "hi Ada");

    const messages = getMessages(room);
    expect(messages.map((m) => `${m.name}: ${m.text}`)).toEqual(["Ada: hello", "Grace: hi Ada"]);
  });

  test("getMessages on a fresh room returns an empty array", () => {
    expect(getMessages(crypto.randomUUID())).toEqual([]);
  });

  test("addMessage caps history at the most recent 50 messages", () => {
    const room = crypto.randomUUID();

    for (let i = 0; i < 55; i++) addMessage(room, "Bot", `message ${i}`);

    const messages = getMessages(room);
    expect(messages).toHaveLength(50);
    expect(messages[0]?.text).toBe("message 5");
    expect(messages.at(-1)?.text).toBe("message 54");
  });
});
