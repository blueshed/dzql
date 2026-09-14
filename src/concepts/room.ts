import * as roomDoc from "../documents/room";
import type { ChatMessage } from "../documents/room";
import * as sessionDoc from "../documents/session";
import { joinRoom, leaveRoom, roomSockets } from "../rooms";
import type { Concept } from "./concept";
import { sessionEnded } from "./session";

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

// Presence is live connection state, not persisted data, so it's assembled
// here (from the socket registry + a session lookup per socket) rather than
// living in documents/room.ts, which only knows about the SQL-backed transcript.
function peopleIn(room: string): string[] {
  const names = [...roomSockets(room)].map((ws) => sessionDoc.read(ws.data.sessionId).name);
  return names.filter((n): n is string => n !== null);
}

export function broadcastPeople(room: string) {
  const payload = JSON.stringify({ type: "render", selector: ".people", html: renderPeople(peopleIn(room)) });
  for (const ws of roomSockets(room)) ws.send(payload);
}

function broadcastMessage(room: string, message: ChatMessage) {
  const payload = JSON.stringify({ type: "append", selector: ".messages", html: renderMessage(message) });
  for (const ws of roomSockets(room)) ws.send(payload);
}

// The room concept doesn't need session to call into it — it reacts to the
// fact that a session ended on its own, since it's the one that cares.
sessionEnded.on(({ ws, sessionId }) => {
  const { room: current } = sessionDoc.read(sessionId);
  if (current) {
    leaveRoom(current, ws);
    broadcastPeople(current);
  }
});

export const room: Concept = {
  events: {
    "join-room": (ws, payload) => {
      const newRoom = String(payload.room ?? "").trim();
      if (!newRoom) return;

      const previousRoom = sessionDoc.read(ws.data.sessionId).room;
      sessionDoc.patch(ws.data.sessionId, [{ op: "replace", path: "/room", value: newRoom }]);

      if (previousRoom) leaveRoom(previousRoom, ws);
      joinRoom(newRoom, ws);

      if (previousRoom) broadcastPeople(previousRoom);
      broadcastPeople(newRoom);
    },
    "leave-room": (ws) => {
      const { room: current } = sessionDoc.read(ws.data.sessionId);
      if (!current) return;

      sessionDoc.patch(ws.data.sessionId, [{ op: "remove", path: "/room" }]);
      leaveRoom(current, ws);
      broadcastPeople(current);
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

    const { transcript } = roomDoc.read(current);
    return renderChat(name, current, peopleIn(current), transcript);
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
