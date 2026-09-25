import * as roomDoc from "../documents/room";
import type { ChatMessage } from "../documents/room";
import * as sessionDoc from "../documents/session";
import type { PatchOp } from "../../../src/json-patch";
import type { Compartment } from "../../../src/compartments/compartment";
import { part } from "../../../src/parts";
import { bento, rows } from "../../../src/bento";
import { esc, join, write } from "../../../src/html";
import { slug } from "../../../src/grid";
import { icon } from "../icons";
import { renderNameForm } from "./session";
import { keepLobby } from "../presence";

// Chat is three steps -- your name, a room, say something -- and each page is a collection (the
// bento's rule 1), drawn with the kernel's surfaces (src/bento.ts): the rooms, a row each and the
// one form that names a new one; a room, its conversation and the one form that says something,
// with who is here across its head. The trail is the way back, and the page's tools are undo,
// redo and logging out. Nothing here is kept between taps: what the page shows is the session's
// name and room, and the room's messages and people.
const { collectionPage, row } = bento({ icon, session: "session", leave: { text: "Log out", icon: "log-out", path: "/name" } });

/** The first letter of a name, as the face it wears. */
const face = (name: string, me: boolean): string => `<span class="face${me ? " me" : ""}" aria-hidden="true">${esc(name.charAt(0).toUpperCase())}</span>`;

/** What room: every room a row, › into it; the form at the foot names a new one, and goes in. */
function renderRooms(name: string, rooms: string[]): string {
  const enter = (r: string) => write("session", "replace", "/room", r);
  return collectionPage([{ label: "Chat" }], {
    key: "rooms",
    body: join(
      `<p class="note">You are <b class="user-label">${esc(name)}</b>. Which room?</p>`,
      `<div class="list">${rows(rooms.map((r) => row({ id: `r-${slug(r)}`, tap: enter(r), what: `#${r}`, mark: "chevron" })), "No rooms yet. Name the first.", "room-list")}</div>`,
      `<form class="say"${write("session", "replace", "/room")}><input name="room" autocomplete="off" required placeholder="A new room" aria-label="A new room"><button type="submit" class="tool">Go in</button></form>`,
    ),
  });
}

/** Who is here, across the head of the conversation: a part, sent alone when someone arrives or leaves. */
function renderPeople(people: string[], me: string): string {
  return part("people", `<div id="people" class="people" aria-label="Here">${people.map((p) => `<span class="who">${face(p, p === me)}<span class="note">${esc(p)}</span></span>`).join("")}</div>`);
}

/** A message is a bubble, and a part: yours on the right, everyone else's on the left with a face, the name shown only on the first of a run. */
function renderMessage(message: ChatMessage, index: number, messages: ChatMessage[], viewer: string): string {
  const mine = message.name === viewer;
  const firstOfRun = index === 0 || messages[index - 1]!.name !== message.name;
  const nameLine = !mine && firstOfRun ? `<span class="name">${esc(message.name)}</span>` : "";
  return part(`m${message.id}`, `<li id="m${message.id}"${mine ? ' class="mine"' : ""}>${face(message.name, mine)}<div class="body">${nameLine}<span class="bubble">${esc(message.text)}</span></div></li>`);
}

/** Say something: the room's conversation, and the form at its foot. "Chat" in the trail is the way back to the rooms. */
function renderRoom(name: string, room: string, people: string[], transcript: ChatMessage[]): string {
  return collectionPage([{ label: "Chat", back: write("session", "remove", "/room") }, { label: `#${room}` }], {
    key: "conversation",
    body: join(
      renderPeople(people, name),
      part("messages", `<ul class="messages" id="messages" data-autoscroll>${transcript.map((m, i) => renderMessage(m, i, transcript, name)).join("")}</ul>`),
      `<form class="say"${write("room", "add", "/messages/-")}><input name="text" autocomplete="off" required autofocus placeholder="Message #${esc(room)}" aria-label="Say"><button type="submit" class="tool">Send</button></form>`,
    ),
  });
}

/** Chat's page: the three steps. No name, the name form; no room, the rooms; else the room. */
export function render(sessionId: string): string {
  const { name, room: current } = sessionDoc.read(sessionId);
  if (!name) return renderNameForm();
  if (!current) return renderRooms(name, roomDoc.list());
  return renderRoom(name, current, roomDoc.people(current), roomDoc.read(current));
}

/** A room's conversation, kept in delta (`room:<name>`): a message is written by someone with a name. */
export const room: Compartment = {
  docType: "room",
  resolveDoc(ws) {
    return sessionDoc.read(ws.data.sessionId).room ?? undefined;
  },
  permit(ws, op) {
    if (op.path !== "/messages/-" || op.op !== "add") return false;
    return sessionDoc.read(ws.data.sessionId).name !== null;
  },
  // The wire says the text; the document takes a message: a new row under a time-ordered id, with
  // its author and the time. Blank text is no message.
  shape(ws, _room, ops) {
    const { name } = sessionDoc.read(ws.data.sessionId);
    return ops
      .map((op) => String(op.value ?? "").trim())
      .filter((text) => text !== "")
      .map((text): PatchOp => ({ op: "add", path: `/messages/${Bun.randomUUIDv7()}`, value: { name, text, sent_at: Date.now() } }));
  },
  // the first message in a room puts it on the list, and undoing the last takes it off
  afterChange: () => keepLobby(),
};

/** Who is in a room: live, kept by the server (../presence.ts), written by nobody on the wire. */
export const here: Compartment = {
  docType: "here",
  kind: "live",
  resolveDoc(ws) {
    return sessionDoc.read(ws.data.sessionId).room ?? undefined;
  },
};

/** Which rooms there are: live, kept by the server, seen by the pages that show it (the rooms). */
export const lobby: Compartment = {
  docType: "lobby",
  kind: "live",
  resolveDoc: () => undefined,
};
