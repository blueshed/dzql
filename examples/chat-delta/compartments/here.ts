import type { ServerWebSocket } from "bun";
import * as sessionDoc from "../documents/session";
import type { ConnectionData } from "../../../src/connection";
import type { PatchOp } from "../../../src/json-patch";
import type { Compartment } from "../../../src/compartments/compartment";
import { allOpenSockets, audienceFor, notify } from "../../../src/compartments/audience";
import { renderRequested } from "../../../src/compartments/render";
import { esc } from "../../../src/html";
import { reading } from "../../../src/reading";
import { part } from "../../../src/parts";
import { sessionPatched } from "./session";

// Who is in a room, as a document of its own: `here:<room>`, the names of everyone connected to
// it. It is eta's, not delta's: live connection state, kept nowhere and never on the ledger
// (undoing an arrival is nonsense), and nobody writes it over the wire -- it changes when a
// session's /room changes or a socket comes or goes. Its own document is its own channel, so the
// room's channel carries only the room's ops (delta's), and what listens to one never hears the
// other.

/** The first letter of a name, as the face it wears. */
export const face = (name: string, me: boolean): string => `<span class="face${me ? " me" : ""}" aria-hidden="true">${esc(name.charAt(0).toUpperCase())}</span>`;

/** Who is here, across the head of the conversation: a part, sent alone when someone arrives or leaves. */
export function renderPeople(people: string[], me: string): string {
  return part("people", `<div id="people" class="people" aria-label="Here">${people.map((p) => `<span class="who">${face(p, p === me)}<span class="note">${esc(p)}</span></span>`).join("")}</div>`);
}

/**
 * The names connected to `room`, from the kernel's open sockets and a session read each. `only`
 * and `as` count one socket under the name `as` even if the kernel has already let it go (a
 * closing socket) or its session no longer says so (a logout revokes the row before this runs).
 * One session in two tabs is one person.
 */
export function peopleIn(room: string, only?: ServerWebSocket<ConnectionData>, as?: string): string[] {
  reading("here", room);
  const sockets = audienceFor("here", room);
  if (only && !sockets.includes(only)) sockets.push(only);
  const names = sockets.map((ws) => (ws === only ? (as ?? null) : sessionDoc.read(ws.data.sessionId).name));
  return [...new Set(names.filter((n): n is string => n !== null))];
}

// Nothing is stored, so a room's presence version is a count kept here, for the echo.
const versions = new Map<string, number>();

/** Tells everyone else in the room that someone came or went; the socket whose coming or going it is needs no telling. */
function announce(room: string, exclude: ServerWebSocket<ConnectionData>, op: PatchOp): void {
  const version = (versions.get(room) ?? 0) + 1;
  versions.set(room, version);
  notify("here", room, { version, applied: [op] }, { echoTo: audienceFor("here", room, exclude) });
}

/** `name` arrived in `room`, unless another of this session's sockets already has it there. */
function announceJoin(room: string, ws: ServerWebSocket<ConnectionData>, name: string): void {
  const already = audienceFor("here", room, ws).some((other) => sessionDoc.read(other.data.sessionId).name === name);
  if (!already) announce(room, ws, { op: "add", path: "/people/-", value: name });
}

/** `name` left `room`, from the place it held, unless another of this session's sockets keeps it there. */
function announceLeave(room: string, ws: ServerWebSocket<ConnectionData>, name: string): void {
  const index = peopleIn(room, ws, name).indexOf(name);
  if (index < 0) return;
  const stillThere = audienceFor("here", room, ws).some((other) => sessionDoc.read(other.data.sessionId).name === name);
  if (!stillThere) announce(room, ws, { op: "remove", path: `/people/${index}` });
}

// Coming and going is a session write (its /room, or its name taken back): presence follows it.
sessionPatched.on(({ ws, before, applied }) => {
  for (const op of applied) {
    if (op.path !== "/room") continue;
    const newRoom = op.op === "remove" ? undefined : String(op.value ?? "").trim() || undefined;
    if (before.room && before.room !== newRoom && before.name) announceLeave(before.room, ws, before.name);
    if (newRoom && newRoom !== before.room && before.name) announceJoin(newRoom, ws, before.name);
  }

  const loggedOut = applied.some((op) => op.path === "/name" && op.op === "remove");
  if (loggedOut && before.room && before.name) announceLeave(before.room, ws, before.name);

  // A room is there while someone is in it, so a coming or a going can add one to the list of rooms
  // or take one off it: whoever is choosing a room is looking at that list, and is shown it again.
  if (loggedOut || applied.some((op) => op.path === "/room")) {
    const choosing = allOpenSockets().filter((other) => {
      const session = sessionDoc.read(other.data.sessionId);
      return other !== ws && session.name !== null && session.room === null;
    });
    if (choosing.length > 0) renderRequested.emit(choosing);
  }
});

export const here: Compartment = {
  docType: "here",
  resolveDoc(ws) {
    return sessionDoc.read(ws.data.sessionId).room ?? undefined;
  },
  // Nobody writes who is here; it follows the session and the sockets.
  permit: () => false,
  write: () => ({ version: 0, applied: [] }),
  onOpen(ws) {
    const { name, room } = sessionDoc.read(ws.data.sessionId);
    if (room && name) announceJoin(room, ws, name);
  },
  onClose(ws) {
    const { name, room } = sessionDoc.read(ws.data.sessionId);
    if (room && name) announceLeave(room, ws, name);
  },
};
