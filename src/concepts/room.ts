import type { ServerWebSocket } from "bun";
import * as roomDoc from "../documents/room";
import type { ChatMessage } from "../documents/room";
import * as sessionDoc from "../documents/session";
import type { ConnectionData } from "../connection";
import { patchMessage } from "../json-patch";
import type { PatchOp } from "../json-patch";
import type { Concept } from "./concept";
import { renderRequested } from "./render";
import { sessionPatched, undoApplied } from "./session";

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
      <button data-write='{"doc":"session","op":"add","path":"/undo"}'>Undo</button>
      <button data-write='{"doc":"session","op":"remove","path":"/name"}'>Log out</button>
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
      <button data-write='{"doc":"session","op":"add","path":"/undo"}'>Undo</button>
      <button data-write='{"doc":"session","op":"remove","path":"/room"}'>Change room</button>
      <button data-write='{"doc":"session","op":"remove","path":"/name"}'>Log out</button>
    </div>
    <p class="people">${renderPeople(people)}</p>
    <ul class="messages" data-autoscroll>${messages.map(renderMessage).join("")}</ul>
    <form data-write='{"doc":"room","op":"add","path":"/transcript/-"}'>
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
  // The same session can hold more than one socket (multiple tabs), which
  // must not show up as the same person listed twice.
  return [...new Set(names.filter((n): n is string => n !== null))];
}

// Every connection in the room can see the room document, so any change to
// it -- a write, an undo -- asks the whole room to re-render, not just
// whoever caused it.
function notifyRoom(room: string): void {
  renderRequested.emit(roomSockets(room));
}

// Echoes a room document's ops to everyone who can see it, then asks them
// to re-render. Shared by a direct write and by undo landing on this doc.
function echoAndNotify(room: string, version: number, ops: PatchOp[]): void {
  if (ops.length === 0) return;
  const payload = patchMessage("room", version, ops);
  for (const ws of roomSockets(room)) ws.send(payload);
  notifyRoom(room);
}

// "Joining"/"leaving" a room is now just a session document write (its
// /room field changing) -- room reacts to that fact instead of owning a
// join-room/leave-room event of its own.
sessionPatched.on(({ ws, before, applied }) => {
  for (const op of applied) {
    if (op.path !== "/room") continue;
    const newRoom = op.op === "remove" ? undefined : String(op.value ?? "").trim() || undefined;

    if (before.room && before.room !== newRoom) {
      leaveRoom(before.room, ws);
      notifyRoom(before.room);
    }
    if (newRoom) {
      joinRoom(newRoom, ws);
      notifyRoom(newRoom);
    }
  }

  const loggedOut = applied.some((op) => op.path === "/name" && op.op === "remove");
  if (loggedOut && before.room) {
    leaveRoom(before.room, ws);
    notifyRoom(before.room);
  }
});

// Undo is triggered through the session doc (see concepts/session.ts) but
// may land on a room's document -- react to that the same way a direct
// room write would.
undoApplied.on(({ docType, docId, version, applied }) => {
  if (docType === "room") echoAndNotify(docId, version, applied);
});

export const room: Concept = {
  docType: "room",
  render(sessionId) {
    const { name, room: current } = sessionDoc.read(sessionId);
    if (!name) return undefined; // not reached in practice: the session concept always renders first
    if (!current) return renderRoomSelector(name, roomDoc.list());

    const { transcript } = roomDoc.read(current);
    return renderChat(name, current, peopleIn(current), transcript);
  },
  resolveDoc(ws) {
    return sessionDoc.read(ws.data.sessionId).room ?? undefined;
  },
  // May this connection write this path? Whether the value itself is valid
  // (e.g. non-blank text) is documents/room.ts::patch()'s call, not this one's.
  permit(ws, op) {
    if (op.path !== "/transcript/-" || op.op !== "add") return false;
    return sessionDoc.read(ws.data.sessionId).name !== null;
  },
  write(ws, roomName, ops) {
    const { name } = sessionDoc.read(ws.data.sessionId);
    const prepared = ops.map((op) => ({ ...op, value: { name, text: op.value } }));

    const result = roomDoc.patch(roomName, prepared, ws.data.sessionId);
    echoAndNotify(roomName, result.version, result.applied);
    return { ...result, rendered: result.applied.length > 0 };
  },
  onOpen(ws) {
    const { room: current } = sessionDoc.read(ws.data.sessionId);
    if (current) joinRoom(current, ws);
  },
  onClose(ws) {
    const { room: current } = sessionDoc.read(ws.data.sessionId);
    if (current) {
      leaveRoom(current, ws);
      notifyRoom(current);
    }
  },
};
