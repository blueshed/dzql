import type { ServerWebSocket } from "bun";
import * as roomDoc from "../documents/room";
import type { ChatMessage } from "../documents/room";
import * as sessionDoc from "../documents/session";
import type { ConnectionData } from "../../../src/connection";
import { patchMessage } from "../../../src/json-patch";
import type { PatchOp } from "../../../src/json-patch";
import type { Concept } from "../../../src/concepts/concept";
import { renderRequested } from "../../../src/concepts/render";
import { sessionPatched } from "./session";

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
      <button data-write='{"doc":"ledger","op":"remove","path":"/latest"}'>Undo</button>
      <button data-write='{"doc":"session","op":"remove","path":"/name"}'>Log out</button>
    </div>
    <h2>Rooms</h2>
    <div data-applet="room-picker" data-props="${props}"></div>
  `;
}

// A message is a bubble: yours on the right in the button tint, everyone
// else's on the left with a monogram, the name shown only on the first of a
// run so a back-and-forth doesn't repeat it on every line.
function renderMessage(message: ChatMessage, index: number, messages: ChatMessage[], viewer: string): string {
  const mine = message.name === viewer;
  const firstOfRun = index === 0 || messages[index - 1]!.name !== message.name;
  const name = escapeHtml(message.name);
  const nameLine = !mine && firstOfRun ? `<span class="name">${name}</span>` : "";
  return (
    `<li${mine ? ' class="mine"' : ""}>` +
    `<span class="avatar" aria-hidden="true">${escapeHtml(message.name.charAt(0).toUpperCase())}</span>` +
    `<div class="body">${nameLine}<span class="bubble">${escapeHtml(message.text)}</span></div>` +
    `</li>`
  );
}

function renderPeople(people: string[], viewer: string): string {
  return people
    .map((person) => `<span${person === viewer ? ' class="me"' : ""}>${escapeHtml(person)}</span>`)
    .join("");
}

function renderChat(name: string, room: string, people: string[], messages: ChatMessage[]): string {
  return `
    <div class="user-bar">
      <span class="room-label">#${escapeHtml(room)}</span>
      <p class="people">${renderPeople(people, name)}</p>
      <button data-write='{"doc":"ledger","op":"remove","path":"/latest"}'>Undo</button>
      <button data-write='{"doc":"session","op":"remove","path":"/room"}'>Room</button>
      <button data-write='{"doc":"session","op":"remove","path":"/name"}'>Log out</button>
    </div>
    <ul class="messages" data-autoscroll>${messages.map((m, i) => renderMessage(m, i, messages, name)).join("")}</ul>
    <form data-write='{"doc":"room","op":"add","path":"/transcript/-"}'>
      <input name="text" autocomplete="off" required autofocus placeholder="Message #${escapeHtml(room)}" />
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
  // Undo landing back on the room document (e.g. a sent message walked
  // back): apply the ledger's inverse ops directly -- skipping permit(),
  // since this isn't a fresh request against the normal writable surface --
  // then echo and notify exactly as a direct write would. `rendered: true`
  // unconditionally, same as a direct write's broadcast: every connection in
  // the room besides the one that pressed undo needs the fresh render this
  // already triggered via notifyRoom, and the one that did gets it from the
  // dispatcher's own render fallback since this only skips *its* automatic
  // render, not anyone else's.
  replay(ws, roomName, ops, undoes) {
    const result = roomDoc.patch(roomName, ops, ws.data.sessionId, undoes);
    echoAndNotify(roomName, result.version, result.applied);
    return { ...result, rendered: true };
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
