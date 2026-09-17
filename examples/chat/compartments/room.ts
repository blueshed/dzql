import type { ServerWebSocket } from "bun";
import * as roomDoc from "../documents/room";
import type { ChatMessage, RoomPatchResult } from "../documents/room";
import * as sessionDoc from "../documents/session";
import type { ConnectionData } from "../../../src/connection";
import type { PatchOp } from "../../../src/json-patch";
import type { Compartment } from "../../../src/compartments/compartment";
import { allOpenSockets, audienceFor, notify } from "../../../src/compartments/audience";
import { renderRequested, type HtmlOp } from "../../../src/compartments/render";
import { history, prefixDoc } from "../../../src/ledger";
import { bento, rows } from "../../../src/bento";
import { esc, join, write } from "../../../src/html";
import { slug } from "../../../src/tray";
import { icon } from "../icons";
import { renderNameForm, sessionPatched } from "./session";

// Chat is three steps -- your name, a room, say something -- and each page is a collection (the
// bento's rule 1), drawn with the kernel's surfaces (src/bento.ts): the rooms, a row each and the
// one form that names a new one; a room, its conversation and the one form that says something,
// with who is here across its head. The trail is the way back, and the page's tools are undo,
// redo and logging out. Nothing here is kept between taps: what the page shows is the session's
// name and room, and the room's transcript and people.
const { collectionPage, row } = bento({ icon, tray: "session", leave: { text: "Log out", icon: "log-out", path: "/name" } });

/** The first letter of a name, as the face it wears. */
const face = (name: string, me: boolean): string => `<span class="face${me ? " me" : ""}" aria-hidden="true">${esc(name.charAt(0).toUpperCase())}</span>`;

/** What room: every room a row, › into it; the form at the foot names a new one, and goes in. */
function renderRooms(name: string, rooms: string[]): string {
  const enter = (r: string) => write("session", "replace", "/room", r);
  return collectionPage([{ label: "Chat" }], {
    key: "rooms",
    body: join(
      `<p class="note">You are <b class="user-label">${esc(name)}</b>. Which room?</p>`,
      `<div class="list">${rows(rooms.map((r) => row({ id: `r-${slug(r)}`, tap: enter(r), what: `#${r}`, mark: "chevron" })), "No rooms yet. Name the first.")}</div>`,
      `<form class="say"${write("session", "replace", "/room")}><input name="room" autocomplete="off" required placeholder="A new room" aria-label="A new room"><button type="submit" class="tool">Go in</button></form>`,
    ),
  });
}

/** Who is here, across the head of the conversation; redrawn alone when someone arrives or leaves. */
function renderPeople(people: string[], me: string): string {
  return `<div id="people" class="people" aria-label="Here">${people.map((p) => `<span class="who">${face(p, p === me)}<span class="note">${esc(p)}</span></span>`).join("")}</div>`;
}

/** A message is a bubble: yours on the right, everyone else's on the left with a face, the name shown only on the first of a run. */
function renderMessage(message: ChatMessage, index: number, messages: ChatMessage[], viewer: string): string {
  const mine = message.name === viewer;
  const firstOfRun = index === 0 || messages[index - 1]!.name !== message.name;
  const nameLine = !mine && firstOfRun ? `<span class="name">${esc(message.name)}</span>` : "";
  return `<li id="m${message.id}"${mine ? ' class="mine"' : ""}>${face(message.name, mine)}<div class="body">${nameLine}<span class="bubble">${esc(message.text)}</span></div></li>`;
}

/** Say something: the room's conversation, and the form at its foot. "Chat" in the trail is the way back to the rooms. */
function renderRoom(name: string, room: string, people: string[], transcript: ChatMessage[]): string {
  return collectionPage([{ label: "Chat", back: write("session", "remove", "/room") }, { label: `#${room}` }], {
    key: "conversation",
    body: join(
      renderPeople(people, name),
      `<ul class="messages" id="messages" data-autoscroll>${transcript.map((m, i) => renderMessage(m, i, transcript, name)).join("")}</ul>`,
      `<form class="say"${write("room", "add", "/transcript/-")}><input name="text" autocomplete="off" required autofocus placeholder="Message #${esc(room)}" aria-label="Say"><button type="submit" class="tool">Send</button></form>`,
    ),
  });
}

// Which connections currently see a room is the kernel's own question now (change-request.md
// item 1, `audienceFor("room", room)`): `resolveDoc` below already says which room a socket
// sees, which is exactly `sees`'s default, so this compartment keeps no registry of its own.

// Presence is live connection state, not persisted data, so it's assembled here (from the
// kernel's open-connection registry + a session lookup per socket) rather than living in
// documents/room.ts, which only knows about the SQL-backed transcript. `only` and `as` treat one
// socket's name as `as` instead of its live, current one, and count it even if the kernel has
// already deregistered it (a closing socket) -- for a socket that just wrote its own session
// document (a logout revokes the row before this fires) or is on its way out, a fresh read (or
// the audience itself) no longer reflects the name it had a moment ago, even though every other
// socket's is still accurate.
function peopleIn(room: string, only?: ServerWebSocket<ConnectionData>, as?: string): string[] {
  const sockets = audienceFor("room", room);
  if (only && !sockets.includes(only)) sockets.push(only);
  const names = sockets.map((ws) => (ws === only ? (as ?? null) : sessionDoc.read(ws.data.sessionId).name));
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
  const version = history(prefixDoc("room", room), 1)[0]?.version ?? 0;
  notify("room", room, { version, applied: [op] }, { echoTo: audienceFor("room", room, exclude) });
}

// Announces `name`'s arrival in `room`, unless it was already there via another of this
// session's sockets (the kernel has already registered `ws` as open by the time this runs, so
// that other socket -- not `ws` itself -- is what "already" has to mean).
function announceJoin(room: string, ws: ServerWebSocket<ConnectionData>, name: string): void {
  const already = audienceFor("room", room, ws).some((other) => sessionDoc.read(other.data.sessionId).name === name);
  if (!already) notifyPresence(room, ws, { op: "add", path: "/people/-", value: name });
}

// Announces `name`'s departure from `room`, at the index it held just before leaving, unless
// another of this session's sockets keeps it there. The kernel deregisters `ws` before calling
// onClose, so by the time this runs it may already be gone from the audience -- `peopleIn`
// counts it anyway, at its correct former name.
function announceLeave(room: string, ws: ServerWebSocket<ConnectionData>, name: string): void {
  const index = peopleIn(room, ws, name).indexOf(name);
  if (index < 0) return;
  const stillThere = audienceFor("room", room, ws).some((other) => sessionDoc.read(other.data.sessionId).name === name);
  if (!stillThere) notifyPresence(room, ws, { op: "remove", path: `/people/${index}` });
}

// "Joining"/"leaving" a room is now just a session document write (its
// /room field changing) -- room reacts to that fact instead of owning a
// join-room/leave-room event of its own.
sessionPatched.on(({ ws, before, applied }) => {
  for (const op of applied) {
    if (op.path !== "/room") continue;
    const newRoom = op.op === "remove" ? undefined : String(op.value ?? "").trim() || undefined;

    if (before.room && before.room !== newRoom && before.name) announceLeave(before.room, ws, before.name);
    if (newRoom && newRoom !== before.room && before.name) announceJoin(newRoom, ws, before.name);
  }

  const loggedOut = applied.some((op) => op.path === "/name" && op.op === "remove");
  if (loggedOut && before.room && before.name) announceLeave(before.room, ws, before.name);

  // A room is there while someone is in it, so a coming or a going can add one to the list or take
  // one off it: whoever is choosing a room is looking at that list, and is shown it again.
  if (loggedOut || applied.some((op) => op.path === "/room")) {
    const choosing = allOpenSockets().filter((other) => {
      const session = sessionDoc.read(other.data.sessionId);
      return other !== ws && session.name !== null && session.room === null;
    });
    if (choosing.length > 0) renderRequested.emit(choosing);
  }
});

/** Chat's page: the three steps. No name, the name form; no room, the rooms; else the room. */
export function render(sessionId: string): string {
  const { name, room: current } = sessionDoc.read(sessionId);
  if (!name) return renderNameForm();
  if (!current) return renderRooms(name, roomDoc.list());
  return renderRoom(name, current, peopleIn(current), roomDoc.read(current).transcript);
}

export const room: Compartment = {
  docType: "room",
  resolveDoc(ws) {
    return sessionDoc.read(ws.data.sessionId).room ?? undefined;
  },
  // May this connection write this path? Whether the value itself is valid
  // (e.g. non-blank text) is documents/room.ts::patch()'s call, not this one's.
  permit(ws, op) {
    if (op.path !== "/transcript/-" || op.op !== "add") return false;
    return sessionDoc.read(ws.data.sessionId).name !== null;
  },
  // A fresh write's value is the text alone, and is shaped into a message by its author here; an
  // undo or a redo brings ops that are already whole (a remove; a message with its own id).
  write(ws, roomName, ops, undoes) {
    const { name } = sessionDoc.read(ws.data.sessionId);
    const shaped = undoes === undefined ? ops.map((op) => ({ ...op, value: { name, text: op.value } })) : ops;
    const result = roomDoc.patch(roomName, shaped, ws.data.sessionId, undoes);
    notify("room", roomName, result); // everyone in the room, the writer too, naming the write so `fragments` can answer with the one <li>
    return result;
  },
  // The delta in HTML's terms: a sent message is one <li> appended; a message walked back by
  // undo is its <li> removed, and the message after it redrawn, since it may now start a run
  // (and so show its name); an arrival or a departure redraws who is here. Anything else is
  // left to the full render.
  fragments(ws, roomName, result): HtmlOp[] | undefined {
    const { name, room: current } = sessionDoc.read(ws.data.sessionId);
    if (!name || current !== roomName) return undefined;
    const ops: HtmlOp[] = [];
    const isPresence = (op: PatchOp) => op.path === "/people/-" || /^\/people\/\d+$/.test(op.path);
    if (result.applied.some(isPresence)) ops.push({ op: "replace", target: "#people", html: renderPeople(peopleIn(roomName), name) });
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
