import type { ServerWebSocket } from "bun";
import * as roomDoc from "../documents/room";
import type { ChatMessage } from "../documents/room";
import * as sessionDoc from "../documents/session";
import type { ConnectionData } from "../connection";
import { patchMessage } from "../json-patch";
import type { PatchOp } from "../json-patch";
import type { Concept } from "./concept";
import { echoOwnSession, sessionEnded } from "./session";

// Which live connections are currently subscribed to which room, for
// broadcast. Not persisted data (see documents/room.ts for that) and not
// needed outside this concept, so it lives here rather than its own module.
const roomSocketSets = new Map<string, Set<ServerWebSocket<ConnectionData>>>();

function getSocketSet(roomId: string): Set<ServerWebSocket<ConnectionData>> {
  let sockets = roomSocketSets.get(roomId);
  if (!sockets) {
    sockets = new Set();
    roomSocketSets.set(roomId, sockets);
  }
  return sockets;
}

function joinRoom(roomId: string, ws: ServerWebSocket<ConnectionData>): void {
  getSocketSet(roomId).add(ws);
}

function leaveRoom(roomId: string, ws: ServerWebSocket<ConnectionData>): void {
  roomSocketSets.get(roomId)?.delete(ws);
}

function roomSockets(roomId: string): Set<ServerWebSocket<ConnectionData>> {
  return getSocketSet(roomId);
}

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

// Every connection in the room can see the room document, so (unlike a
// session's own doc) this is a broadcast, not a direct send.
function broadcastPatch(room: string, version: number, ops: PatchOp[]) {
  if (ops.length === 0) return;
  const payload = patchMessage(`room:${room}`, version, ops);
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
      const { name, room: previousRoom } = sessionDoc.read(ws.data.sessionId);
      const newRoom = String(payload.room ?? "").trim();
      if (!name || !newRoom) return; // a logged-out session (e.g. a stale second tab) can't join a room

      const result = sessionDoc.patch(ws.data.sessionId, [{ op: "replace", path: "/room", value: newRoom }]);
      echoOwnSession(ws, result);

      if (previousRoom) leaveRoom(previousRoom, ws);
      joinRoom(newRoom, ws);

      if (previousRoom) broadcastPeople(previousRoom);
      broadcastPeople(newRoom);
    },
    "leave-room": (ws) => {
      const { room: current } = sessionDoc.read(ws.data.sessionId);
      if (!current) return;

      const result = sessionDoc.patch(ws.data.sessionId, [{ op: "remove", path: "/room" }]);
      echoOwnSession(ws, result);
      leaveRoom(current, ws);
      broadcastPeople(current);
    },
    "send-message": (ws, payload) => {
      const { name, room: current } = sessionDoc.read(ws.data.sessionId);
      const text = String(payload.text ?? "").trim();
      if (!name || !current || !text) return false;

      const { version, applied, added } = roomDoc.patch(
        current,
        [{ op: "add", path: "/transcript/-", value: { name, text } }],
        ws.data.sessionId,
      );
      if (added) {
        broadcastPatch(current, version, applied);
        broadcastMessage(current, added);
      }
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
