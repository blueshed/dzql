import { describe, expect, test } from "bun:test";
import {
  addMessage,
  clearSession,
  ensureRoom,
  getMessages,
  getSessionName,
  getSessionRoom,
  leaveCurrentRoom,
  listRooms,
  setSessionName,
  setSessionRoom,
} from "./db";

describe("sessions", () => {
  test("a fresh session id has no name and no room", () => {
    const id = crypto.randomUUID();
    expect(getSessionName(id)).toBeNull();
    expect(getSessionRoom(id)).toBeNull();
  });

  test("setSessionRoom then leaveCurrentRoom clears it back to null", () => {
    const id = crypto.randomUUID();
    setSessionName(id, "Ada");

    setSessionRoom(id, "general");
    expect(getSessionRoom(id)).toBe("general");

    leaveCurrentRoom(id);
    expect(getSessionRoom(id)).toBeNull();
  });

  test("clearSession resets both name and room", () => {
    const id = crypto.randomUUID();
    setSessionName(id, "Ada");
    setSessionRoom(id, "general");

    clearSession(id);

    expect(getSessionName(id)).toBeNull();
    expect(getSessionRoom(id)).toBeNull();
  });
});

describe("rooms", () => {
  test("a brand new room name does not appear in listRooms until ensureRoom is called", () => {
    const room = crypto.randomUUID();
    expect(listRooms()).not.toContain(room);

    ensureRoom(room);

    expect(listRooms()).toContain(room);
  });

  test("ensureRoom is idempotent for an existing room", () => {
    const room = crypto.randomUUID();
    ensureRoom(room);
    ensureRoom(room);

    expect(listRooms().filter((name) => name === room)).toHaveLength(1);
  });
});

describe("messages", () => {
  test("getMessages on an empty room returns an empty array", () => {
    expect(getMessages(crypto.randomUUID())).toEqual([]);
  });

  test("addMessage persists messages in chronological order", () => {
    const room = crypto.randomUUID();

    addMessage(room, "Ada", "hello");
    addMessage(room, "Grace", "hi Ada");

    const messages = getMessages(room);
    expect(messages.map((m) => `${m.name}: ${m.text}`)).toEqual(["Ada: hello", "Grace: hi Ada"]);
  });

  test("getMessages respects the limit, keeping only the most recent", () => {
    const room = crypto.randomUUID();
    for (let i = 0; i < 5; i++) addMessage(room, "Bot", `message ${i}`);

    const messages = getMessages(room, 2);

    expect(messages.map((m) => m.text)).toEqual(["message 3", "message 4"]);
  });
});
