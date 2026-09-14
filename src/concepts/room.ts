import * as roomDoc from "../documents/room";
import type { ChatMessage } from "../documents/room";
import * as sessionDoc from "../documents/session";
import { joinRoom, leaveRoom, roomSockets } from "../rooms";
import type { Concept } from "./concept";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderRoomSelector(name: string, rooms: string[]): string {
  const props = escapeHtml(JSON.stringify({ rooms }));
  return `
    <div class="user-bar">
      <span class="user-label">${escapeHtml(name)}</span>
      <button data-event="logout">Log out</button>
    </div>
    <h2>Rooms</h2>
    <div data-applet="room-picker" data-props="${props}"></div>
  `;
}

function renderMessage(message: ChatMessage): string {
  return `<li><strong>${escapeHtml(message.name)}:</strong> ${escapeHtml(message.text)}</li>`;
}

function renderPeople(people: string[]): string {
  return people.map(escapeHtml).join(", ");
}

function renderChat(name: string, room: string, people: string[], messages: ChatMessage[]): string {
  return `
    <div class="user-bar">
      <span class="user-label">${escapeHtml(name)}</span>
      <span class="room-label">#${escapeHtml(room)}</span>
      <button data-event="leave-room">Change room</button>
      <button data-event="logout">Log out</button>
    </div>
    <p class="people">${renderPeople(people)}</p>
    <ul class="messages" data-autoscroll>${messages.map(renderMessage).join("")}</ul>
    <form data-event="send-message">
      <input name="text" autocomplete="off" required autofocus />
      <button type="submit">Send</button>
    </form>
  `;
}

export function broadcastPeople(room: string) {
  const html = renderPeople(roomDoc.read(room).people);
  const payload = JSON.stringify({ type: "render", selector: ".people", html });
  for (const ws of roomSockets(room)) ws.send(payload);
}

function broadcastMessage(room: string, message: ChatMessage) {
  const payload = JSON.stringify({ type: "append", selector: ".messages", html: renderMessage(message) });
  for (const ws of roomSockets(room)) ws.send(payload);
}

export const room: Concept = {
  events: {
    "join-room": (ws, payload) => {
      const previousRoom = sessionDoc.read(ws.data.sessionId).room;
      sessionDoc.patch(ws.data.sessionId, [{ op: "replace", path: "/room", value: payload.room }], ws);
      if (previousRoom) broadcastPeople(previousRoom);
      const { room: joined } = sessionDoc.read(ws.data.sessionId);
      if (joined) broadcastPeople(joined);
    },
    "leave-room": (ws) => {
      const { room: current } = sessionDoc.read(ws.data.sessionId);
      sessionDoc.patch(ws.data.sessionId, [{ op: "remove", path: "/room" }], ws);
      if (current) broadcastPeople(current);
    },
    "send-message": (ws, payload) => {
      const { name, room: current } = sessionDoc.read(ws.data.sessionId);
      const text = String(payload.text ?? "").trim();
      if (!name || !current || !text) return false;

      const added = roomDoc.patch(current, [{ op: "add", path: "/transcript/-", value: { name, text } }]);
      if (added) broadcastMessage(current, added);
      return true; // already broadcast a targeted append; skip the automatic full render
    },
  },
  render(sessionId) {
    const { name, room: current } = sessionDoc.read(sessionId);
    if (!name) return undefined; // not reached in practice: the session concept always renders first
    if (!current) return renderRoomSelector(name, roomDoc.list());

    const { people, transcript } = roomDoc.read(current);
    return renderChat(name, current, people, transcript);
  },
  onOpen(ws) {
    const { room: current } = sessionDoc.read(ws.data.sessionId);
    if (current) joinRoom(current, ws);
  },
  onClose(ws) {
    const { room: current } = sessionDoc.read(ws.data.sessionId);
    if (current) {
      leaveRoom(current, ws);
      broadcastPeople(current);
    }
  },
};
