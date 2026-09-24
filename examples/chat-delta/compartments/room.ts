import type { ServerWebSocket } from "bun";
import * as roomDoc from "../documents/room";
import type { Message } from "../documents/room";
import * as sessionDoc from "../documents/session";
import type { ConnectionData } from "../../../src/connection";
import type { PatchOp } from "../../../src/json-patch";
import type { Compartment } from "../../../src/compartments/compartment";
import { allOpenSockets, audienceFor, notify } from "../../../src/compartments/audience";
import { renderRequested } from "../../../src/compartments/render";
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

/**
 * The conversation, as the transcript applet (applets/transcript-applet.tsx) draws it: the room's
 * messages go once, as props in delta's own shape, and after that as the room's echo. The bubbles
 * are the applet's to draw; the server draws none.
 */
function transcriptApplet(me: string, transcript: Message[]): string {
  const messages = Object.fromEntries(transcript.map((m) => [m.id, m]));
  return `<div id="transcript" data-applet="transcript" data-doc="room" data-props="${esc(JSON.stringify({ me, messages }))}"></div>`;
}

/** Say something: the room's conversation, and the form at its foot. "Chat" in the trail is the way back to the rooms. */
function renderRoom(name: string, room: string, people: string[], transcript: Message[]): string {
  return collectionPage([{ label: "Chat", back: write("session", "remove", "/room") }, { label: `#${room}` }], {
    key: "conversation",
    body: join(
      renderPeople(people, name),
      transcriptApplet(name, transcript),
      `<form class="say"${write("room", "add", "/messages/-")}><input name="text" autocomplete="off" required autofocus placeholder="Message #${esc(room)}" aria-label="Say"><button type="submit" class="tool">Send</button></form>`,
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
  return renderRoom(name, current, peopleIn(current), roomDoc.read(current));
}

export const room: Compartment = {
  docType: "room",
  resolveDoc(ws) {
    return sessionDoc.read(ws.data.sessionId).room ?? undefined;
  },
  // May this connection write this path? Whether the value itself is valid
  // (e.g. non-blank text) is documents/room.ts::patch()'s call, not this one's.
  permit(ws, op) {
    if (op.path !== "/messages/-" || op.op !== "add") return false;
    return sessionDoc.read(ws.data.sessionId).name !== null;
  },
  // A fresh write's value is the text alone, and is made a message here: a new row under a
  // time-ordered id, with its author and the time. An undo or a redo brings ops delta already
  // made whole (a remove; the row itself). Blank text is no message, and nothing is written.
  write(ws, roomName, ops, undoes) {
    const { name } = sessionDoc.read(ws.data.sessionId);
    const shaped: PatchOp[] =
      undoes === undefined
        ? ops
            .map((op) => String(op.value ?? "").trim())
            .filter((text) => text !== "")
            .map((text) => ({ op: "add", path: `/messages/${Bun.randomUUIDv7()}`, value: { name, text, sent_at: Date.now() } }))
        : ops;
    if (shaped.length === 0) return { version: 0, applied: [] };
    const result = roomDoc.patch(roomName, shaped, ws.data.sessionId, undoes);
    notify("room", roomName, result); // everyone in the room, the writer too
    return result;
  },
  // A message, sent or walked back, is the transcript applet's to draw from the echo: nothing
  // follows it. Anything else (someone arriving or leaving) redraws the page, and the morph leaves
  // the applet be.
  fragments(_ws, _roomName, result) {
    return result.applied.every((op) => op.path.startsWith("/messages/")) ? [] : undefined;
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
