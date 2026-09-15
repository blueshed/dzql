import type { ServerWebSocket } from "bun";
import * as roomDoc from "../documents/room";
import type { ChatMessage, RoomPatchResult } from "../documents/room";
import * as sessionDoc from "../documents/session";
import type { ConnectionData } from "../../../src/connection";
import { patchMessage } from "../../../src/json-patch";
import type { PatchOp } from "../../../src/json-patch";
import type { Concept } from "../../../src/concepts/concept";
import { renderRequested, type HtmlOp } from "../../../src/concepts/render";
import { history, prefixDoc } from "../../../src/ledger";
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
      <button data-write='{"doc":"ledger","op":"add","path":"/latest"}'>Redo</button>
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
    `<li id="m${message.id}"${mine ? ' class="mine"' : ""}>` +
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

function renderPeopleBar(people: string[], viewer: string): string {
  return `<p class="people" id="people">${renderPeople(people, viewer)}</p>`;
}

function renderChat(name: string, room: string, people: string[], messages: ChatMessage[]): string {
  return `
    <div class="user-bar">
      <span class="room-label">#${escapeHtml(room)}</span>
      ${renderPeopleBar(people, name)}
      <button data-write='{"doc":"ledger","op":"remove","path":"/latest"}'>Undo</button>
      <button data-write='{"doc":"ledger","op":"add","path":"/latest"}'>Redo</button>
      <button data-write='{"doc":"session","op":"remove","path":"/room"}'>Room</button>
      <button data-write='{"doc":"session","op":"remove","path":"/name"}'>Log out</button>
    </div>
    <ul class="messages" id="messages" data-autoscroll>${messages.map((m, i) => renderMessage(m, i, messages, name)).join("")}</ul>
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
  return peopleWith(room);
}

// `peopleIn`, but treating `only`'s name as `as` instead of its live, current one -- for a
// socket that just wrote its own session document (a logout revokes the row before this fires),
// a fresh read of *that one socket* no longer reflects the name it had a moment ago, even though
// every other socket's read is still accurate.
function peopleWith(room: string, only?: ServerWebSocket<ConnectionData>, as?: string): string[] {
  const names = [...roomSockets(room)].map((ws) => (ws === only ? (as ?? null) : sessionDoc.read(ws.data.sessionId).name));
  // The same session can hold more than one socket (multiple tabs), which
  // must not show up as the same person listed twice.
  return [...new Set(names.filter((n): n is string => n !== null))];
}

// A presence change (someone's name appearing in or disappearing from the room's live set) is
// echoed to everyone else in the room as a plain room op -- add /people/- or remove
// /people/<index> -- the same way a transcript write is, but never recorded to the ledger
// (undoing an arrival is nonsense: change-request.md item 5). `exclude` is the socket whose own
// join or leave this is: it doesn't need telling about its own presence, and (for a leave) may
// already be closed.
function notifyPresence(room: string, exclude: ServerWebSocket<ConnectionData>, op: PatchOp): void {
  const others = [...roomSockets(room)].filter((ws) => ws !== exclude);
  if (others.length === 0) return;
  const version = history(prefixDoc("room", room), 1)[0]?.version ?? 0;
  const result = { version, applied: [op] };
  const payload = patchMessage("room", version, [op]);
  for (const ws of others) ws.send(payload);
  renderRequested.emit({ sockets: others, write: { docType: "room", docId: room, result } });
}

// Adds `ws` to `room`'s live set and, only if `name` wasn't already there via another of this
// session's sockets, announces the arrival to everyone else.
function announceJoin(room: string, ws: ServerWebSocket<ConnectionData>, name: string): void {
  const already = peopleIn(room).includes(name);
  joinRoom(room, ws);
  if (!already) notifyPresence(room, ws, { op: "add", path: "/people/-", value: name });
}

// Removes `ws` from `room`'s live set and, only if that was `name`'s last socket there,
// announces the departure -- at the index `name` held just before it left (using `peopleWith`,
// not `peopleIn`: a logout's own session row is already revoked by the time this runs, so a
// live read of `ws` itself would miss the name it had a moment ago).
function announceLeave(room: string, ws: ServerWebSocket<ConnectionData>, name: string): void {
  const index = peopleWith(room, ws, name).indexOf(name);
  leaveRoom(room, ws);
  if (index >= 0 && !peopleIn(room).includes(name)) {
    notifyPresence(room, ws, { op: "remove", path: `/people/${index}` });
  }
}

// Echoes a room document's ops to everyone who can see it, then asks them to bring their
// page up to date -- naming the write, so `fragments` below can answer with the one <li>
// that changed instead of the whole page. Shared by a direct write and by undo landing here.
function echoAndNotify(room: string, result: RoomPatchResult): void {
  if (result.applied.length === 0) return;
  const payload = patchMessage("room", result.version, result.applied);
  for (const ws of roomSockets(room)) ws.send(payload);
  renderRequested.emit({ sockets: roomSockets(room), write: { docType: "room", docId: room, result } });
}

// "Joining"/"leaving" a room is now just a session document write (its
// /room field changing) -- room reacts to that fact instead of owning a
// join-room/leave-room event of its own.
sessionPatched.on(({ ws, before, applied }) => {
  for (const op of applied) {
    if (op.path !== "/room") continue;
    const newRoom = op.op === "remove" ? undefined : String(op.value ?? "").trim() || undefined;

    if (before.room && before.room !== newRoom && before.name) announceLeave(before.room, ws, before.name);
    if (newRoom && before.name) announceJoin(newRoom, ws, before.name);
  }

  const loggedOut = applied.some((op) => op.path === "/name" && op.op === "remove");
  if (loggedOut && before.room && before.name) announceLeave(before.room, ws, before.name);
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
    echoAndNotify(roomName, result);
    return { ...result, rendered: result.applied.length > 0 };
  },
  // Undo landing back on the room document (e.g. a sent message walked
  // back): apply the ledger's inverse ops directly -- skipping permit(),
  // since this isn't a fresh request against the normal writable surface --
  // then echo and notify exactly as a direct write would. `rendered: true`
  // unconditionally, same as a direct write's broadcast: every connection in
  // the room besides the one that pressed undo needs the fresh update this
  // already triggered via echoAndNotify, and the one that did gets it from
  // the dispatcher's own render fallback since this only skips *its*
  // automatic render, not anyone else's.
  replay(ws, roomName, ops, undoes) {
    const result = roomDoc.patch(roomName, ops, ws.data.sessionId, undoes);
    echoAndNotify(roomName, result);
    return { ...result, rendered: true };
  },
  // The delta in HTML's terms: a sent message is one <li> appended; a message walked back by
  // undo is its <li> removed, and the message after it redrawn, since it may now start a run
  // (and so show its name). Anything else -- a write with nothing applied never gets here --
  // is left to the full render.
  fragments(ws, roomName, result): HtmlOp[] | undefined {
    const { name, room: current } = sessionDoc.read(ws.data.sessionId);
    if (!name || current !== roomName) return undefined;
    const ops: HtmlOp[] = [];
    const isPresence = (op: PatchOp) => op.path === "/people/-" || /^\/people\/\d+$/.test(op.path);
    if (result.applied.some(isPresence)) {
      ops.push({ op: "replace", target: "#people", html: renderPeopleBar(peopleIn(roomName), name) });
    }
    const { added, removed } = result as RoomPatchResult;
    const { transcript } = roomDoc.read(roomName);
    if (added) {
      const at = transcript.length - 1;
      ops.push({ op: "add", target: "#messages", html: renderMessage(transcript[at]!, at, transcript, name) });
    }
    if (removed) {
      ops.push({ op: "remove", target: `#m${removed.id}` });
      const next = transcript.findIndex((m) => m.id > removed.id);
      if (next >= 0) ops.push({ op: "replace", target: `#m${transcript[next]!.id}`, html: renderMessage(transcript[next]!, next, transcript, name) });
    }
    return ops;
  },
  onOpen(ws) {
    const { name, room: current } = sessionDoc.read(ws.data.sessionId);
    if (current && name) announceJoin(current, ws, name);
  },
  onClose(ws) {
    const { name, room: current } = sessionDoc.read(ws.data.sessionId);
    if (current && name) announceLeave(current, ws, name);
  },
};
