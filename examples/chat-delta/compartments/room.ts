import * as roomDoc from "../documents/room";
import type { Message } from "../documents/room";
import * as sessionDoc from "../documents/session";
import type { PatchOp } from "../../../src/json-patch";
import type { Compartment } from "../../../src/compartments/compartment";
import { notify } from "../../../src/compartments/audience";
import { bento, rows } from "../../../src/bento";
import { esc, join, write } from "../../../src/html";
import { slug } from "../../../src/tray";
import { icon } from "../icons";
import { renderNameForm } from "./session";
import { peopleIn, renderPeople } from "./here";

// Chat is three steps -- your name, a room, say something -- and each page is a collection (the
// bento's rule 1), drawn with the kernel's surfaces (src/bento.ts): the rooms, a row each and the
// one form that names a new one; a room, its conversation and the one form that says something,
// with who is here across its head. The trail is the way back, and the page's tools are undo,
// redo and logging out. Nothing here is kept between taps: what the page shows is the session's
// name and room, and the room's transcript and people.
const { collectionPage, row } = bento({ icon, tray: "session", leave: { text: "Log out", icon: "log-out", path: "/name" } });

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

/**
 * The conversation, as the transcript applet (applets/transcript-applet.tsx) draws it: the room's
 * messages go once, as props in delta's own shape, and after that as the room's echo. The bubbles
 * are the applet's to draw; the server draws none.
 */
function transcriptApplet(me: string, room: string, transcript: Message[]): string {
  const messages = Object.fromEntries(transcript.map((m) => [m.id, m]));
  return `<div id="transcript" data-applet="transcript" data-doc="${esc(`room:${room}`)}" data-props="${esc(JSON.stringify({ me, messages }))}"></div>`;
}

/** Say something: the room's conversation, and the form at its foot. "Chat" in the trail is the way back to the rooms. */
function renderRoom(name: string, room: string, people: string[], transcript: Message[]): string {
  return collectionPage([{ label: "Chat", back: write("session", "remove", "/room") }, { label: `#${room}` }], {
    key: "conversation",
    body: join(
      renderPeople(people, name),
      transcriptApplet(name, room, transcript),
      `<form class="say"${write(`room:${room}`, "add", "/messages/-")}><input name="text" autocomplete="off" required autofocus placeholder="Message #${esc(room)}" aria-label="Say"><button type="submit" class="tool">Send</button></form>`,
    ),
  });
}

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
  // follows it. (Who is here is `here`'s document, on its own channel.)
  fragments: () => [],
};
