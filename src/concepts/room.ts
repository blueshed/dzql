import type { ServerWebSocket } from "bun";
import * as roomDoc from "../documents/room";
import type { ChatMessage } from "../documents/room";
import * as sessionDoc from "../documents/session";
import type { ConnectionData } from "../connection";
import { patchMessage } from "../json-patch";
import type { PatchOp } from "../json-patch";
import type { Concept } from "./concept";
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

function broadcastPeople(room: string) {
  const payload = JSON.stringify({ type: "render", selector: ".people", html: renderPeople(peopleIn(room)) });
  for (const ws of roomSockets(room)) ws.send(payload);
}

function broadcastMessage(room: string, message: ChatMessage) {
  const payload = JSON.stringify({ type: "append", selector: ".messages", html: renderMessage(message) });
  for (const ws of roomSockets(room)) ws.send(payload);
}

// Undo has no granular "remove at index" wire vocabulary of its own (that
// would be inventing a node set); it re-renders the whole list instead,
// same as any other transcript change that isn't a plain append.
function broadcastMessages(room: string) {
  const { transcript } = roomDoc.read(room);
  const payload = JSON.stringify({
    type: "render",
    selector: ".messages",
    html: transcript.map(renderMessage).join(""),
  });
  for (const ws of roomSockets(room)) ws.send(payload);
}

// Every connection in the room can see the room document, so (unlike a
// session's own doc) this is a broadcast, not a direct send.
function broadcastPatch(room: string, version: number, ops: PatchOp[]) {
  if (ops.length === 0) return;
  const payload = patchMessage("room", version, ops);
  for (const ws of roomSockets(room)) ws.send(payload);
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
      broadcastPeople(before.room);
    }
    if (newRoom) {
      joinRoom(newRoom, ws);
      broadcastPeople(newRoom);
    }
  }

  const loggedOut = applied.some((op) => op.path === "/name" && op.op === "remove");
  if (loggedOut && before.room) {
    leaveRoom(before.room, ws);
    broadcastPeople(before.room);
  }
});

// Undo is triggered through the session doc (see concepts/session.ts) but
// may land on a room's document -- react to that the same way a direct
// room write would, echoing the patch and refreshing the transcript for
// everyone currently in the room, not just whoever pressed undo.
undoApplied.on(({ docType, docId, version, applied }) => {
  if (docType !== "room" || applied.length === 0) return;
  broadcastPatch(docId, version, applied);
  broadcastMessages(docId);
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
  permit(ws, op) {
    if (op.path !== "/transcript/-" || op.op !== "add") return false;
    const { name } = sessionDoc.read(ws.data.sessionId);
    if (!name) return false;
    const text = String(op.value ?? "").trim();
    return text.length > 0;
  },
  write(ws, roomName, ops) {
    const { name } = sessionDoc.read(ws.data.sessionId);
    const prepared = ops.map((op) => ({ ...op, value: { name, text: String(op.value ?? "").trim() } }));

    const result = roomDoc.patch(roomName, prepared, ws.data.sessionId);
    if (result.applied.length > 0) broadcastPatch(roomName, result.version, result.applied);
    if (result.added) broadcastMessage(roomName, result.added);
    return { ...result, rendered: Boolean(result.added) };
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
