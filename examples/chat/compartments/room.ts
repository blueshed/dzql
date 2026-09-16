import type { ServerWebSocket } from "bun";
import * as roomDoc from "../documents/room";
import type { ChatMessage, RoomPatchResult } from "../documents/room";
import * as sessionDoc from "../documents/session";
import type { ConnectionData } from "../../../src/connection";
import { patchMessage } from "../../../src/json-patch";
import type { PatchOp } from "../../../src/json-patch";
import type { Compartment } from "../../../src/compartments/compartment";
import { audienceFor, notify } from "../../../src/compartments/audience";
import { renderRequested, type HtmlOp } from "../../../src/compartments/render";
import { history, prefixDoc } from "../../../src/ledger";
import { sessionPatched } from "./session";
import { door, messageLi, page, peopleMini, peopleRows, talkMini } from "../views/page";

// Which connections currently see a room is the kernel's own question now (change-request.md
// item 1, `audienceFor("room", room)`): `resolveDoc` below already says which room a socket
// sees, which is exactly `sees`'s default, so this compartment keeps no registry of its own.

// Presence is live connection state, not persisted data, so it's assembled
// here (from the kernel's open-connection registry + a session lookup per socket) rather than
// living in documents/room.ts, which only knows about the SQL-backed transcript.
function peopleIn(room: string): string[] {
  return peopleWith(room);
}

// `peopleIn`, but treating `only`'s name as `as` instead of its live, current one, and counting
// it even if the kernel has already deregistered it (a closing socket) -- for a socket that just
// wrote its own session document (a logout revokes the row before this fires) or is on its way
// out, a fresh read (or the audience itself) no longer reflects the name it had a moment ago,
// even though every other socket's is still accurate.
function peopleWith(room: string, only?: ServerWebSocket<ConnectionData>, as?: string): string[] {
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
  const others = audienceFor("room", room, exclude);
  if (others.length === 0) return;
  const version = history(prefixDoc("room", room), 1)[0]?.version ?? 0;
  const result = { version, applied: [op] };
  const payload = patchMessage("room", version, [op]);
  for (const ws of others) ws.send(payload);
  renderRequested.emit({ sockets: others, write: { docType: "room", docId: room, result } });
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
// onClose, so by the time this runs it may already be gone from the audience -- `peopleWith`
// counts it anyway, at its correct former name.
function announceLeave(room: string, ws: ServerWebSocket<ConnectionData>, name: string): void {
  const index = peopleWith(room, ws, name).indexOf(name);
  if (index < 0) return;
  const stillThere = audienceFor("room", room, ws).some((other) => sessionDoc.read(other.data.sessionId).name === name);
  if (!stillThere) notifyPresence(room, ws, { op: "remove", path: `/people/${index}` });
}

// Echoes a room document's ops to everyone who can see it, then asks them to bring their
// page up to date -- naming the write, so `fragments` below can answer with the one <li>
// that changed instead of the whole page. Shared by a direct write and by undo landing here.
function echoAndNotify(room: string, result: RoomPatchResult): void {
  notify("room", room, result);
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
});

export const room: Compartment = {
  docType: "room",
  render(sessionId) {
    // Absorbs the tray's old page: with no name, room is the only compartment on the page, so
    // it's the one that shows the door (the tray itself has no `render` -- item 10's rule 3).
    const { name, room: current, ui } = sessionDoc.read(sessionId);
    if (!name) return door();
    return page({
      name,
      room: current,
      ui,
      rooms: roomDoc.list(),
      people: current ? peopleIn(current) : [],
      transcript: current ? roomDoc.read(current).transcript : [],
    });
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
    return result;
  },
  // Undo landing back on the room document (e.g. a sent message walked back): apply the
  // ledger's inverse ops directly -- skipping permit(), since this isn't a fresh request
  // against the normal writable surface -- then echo and notify exactly as a direct write
  // would, covering every connection in the room including the one that pressed undo (rule 2).
  replay(ws, roomName, ops, undoes) {
    const result = roomDoc.patch(roomName, ops, ws.data.sessionId, undoes);
    echoAndNotify(roomName, result);
    return result;
  },
  // The delta in HTML's terms: a sent message is one <li> appended to the open conversation, or
  // the conversation's small reading redrawn on the box; a message walked back by undo is its
  // <li> removed and the message after it redrawn, since it may now start a run (and so show
  // its name); an arrival or a departure redraws the people, as rows when they are open and as
  // faces on the box. Anything else is left to the full render.
  fragments(ws, roomName, result): HtmlOp[] | undefined {
    const { name, room: current, ui } = sessionDoc.read(ws.data.sessionId);
    if (!name || current !== roomName) return undefined;
    const ops: HtmlOp[] = [];
    const isPresence = (op: PatchOp) => op.path === "/people/-" || /^\/people\/\d+$/.test(op.path);
    if (result.applied.some(isPresence)) {
      const people = peopleIn(roomName);
      ops.push(ui.open === "people" ? { op: "replace", target: "#people-rows", html: peopleRows(people, name, ui) } : { op: "replace", target: "#people-mini", html: peopleMini(people, name) });
    }
    const { added, removed } = result as RoomPatchResult;
    const { transcript } = roomDoc.read(roomName);
    if (ui.open !== "conversation") {
      if (added || removed) ops.push({ op: "replace", target: "#talk-mini", html: talkMini(transcript) });
      return ops;
    }
    const word = ui.filter?.conversation;
    const hide = ui.hide?.conversation;
    if (added) {
      const at = transcript.length - 1;
      ops.push({ op: "add", target: "#messages", html: messageLi(transcript[at]!, at, transcript, name, word, hide) });
    }
    if (removed) {
      ops.push({ op: "remove", target: `#m${removed.id}` });
      const next = transcript.findIndex((m) => m.id > removed.id);
      if (next >= 0) ops.push({ op: "replace", target: `#m${transcript[next]!.id}`, html: messageLi(transcript[next]!, next, transcript, name, word, hide) });
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
