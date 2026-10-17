import * as roomDoc from "../documents/room";
import type { ChatMessage } from "../documents/room";
import * as sessionDoc from "../documents/session";
import type { PatchOp } from "dzql/rendering/json-patch";
import type { Resource } from "dzql/rendering/resources/resource";
import { part } from "dzql/rendering/parts";
import { bento, layers, rows } from "dzql/rendering/bento";
import { esc, join, write } from "dzql/rendering/html";
import { slug } from "dzql/rendering/grid";
import { icon } from "../icons";
import { renderNameForm } from "./session";
import { keepLobby } from "../presence";

// Chat is three steps -- your name, a room, say something -- and each page is a collection, not a box,
// drawn with the kernel's surfaces (src/bento.ts): the rooms, a row each and the
// one form that names a new one; a room, its conversation and the one form that says something,
// with who is here across its head. The trail is the way back, and the page's tools are undo,
// redo and logging out. Nothing here is kept between taps: what the page shows is the session's
// name, room and how far back it reads, and the room's messages and people.
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
      `<form class="say" aria-label="Go into a new room"${write("session", "replace", "/room")}><input name="room" autocomplete="off" required placeholder="A new room" aria-label="A new room"><button type="submit" class="tool">Go in</button></form>`,
    ),
  });
}

/**
 * Who is here, across the head of the conversation: a list, and a part, sent alone when someone
 * arrives or leaves. You are your face in your own colour, not your name; a reader, who cannot see
 * the colour, hears "You", as your messages say.
 */
function renderPeople(people: string[], me: string): string {
  const who = (p: string) => (p === me ? `<li class="who">${face(p, true)}<span class="sr-only">You</span></li>` : `<li class="who">${face(p, false)}<span class="note">${esc(p)}</span></li>`);
  return part("people", `<ul id="people" class="people" aria-label="Here">${people.map(who).join("")}</ul>`);
}

/**
 * A message is a bubble, and a part: yours on the right, everyone else's on the left. A run is
 * said once, at its start: another's face and name, or, for yours, "You" to a reader, who cannot
 * see which side it sits on. The rest of another's run keep the face's place, empty.
 */
function renderMessage(message: ChatMessage, index: number, messages: ChatMessage[], viewer: string): string {
  const mine = message.name === viewer;
  const firstOfRun = index === 0 || messages[index - 1]!.name !== message.name;
  const mark = mine ? "" : firstOfRun ? face(message.name, false) : `<span class="face-gap"></span>`;
  const who = !firstOfRun ? "" : mine ? `<span class="sr-only">You</span>` : `<span class="name">${esc(message.name)}</span>`;
  return part(`m${message.id}`, `<li id="m${message.id}"${mine ? ' class="mine"' : ""}>${mark}<div class="body">${who}<span class="bubble">${esc(message.text)}</span></div></li>`);
}

/**
 * Say something: the room's conversation, and the form at its foot. "Chat" in the trail is the way
 * back to the rooms. Fifty messages at a time (../documents/room.ts): "Earlier" at their head while
 * there are more, and reading back, "Latest" at the foot in place of the form. Another fifty
 * share no message with these, so the conversation goes whole, as a room does when you go in.
 */
function renderRoom(name: string, room: string, people: string[], before: string | null, { messages, earlier }: { messages: ChatMessage[]; earlier: boolean }): string {
  return collectionPage([{ label: "Chat", back: write("session", "remove", "/room") }, { label: `#${room}` }], {
    key: "conversation",
    body: join(
      renderPeople(people, name),
      part(
        "messages",
        `<ul class="messages" id="messages" data-autoscroll>${earlier ? `<li class="earlier"><button type="button" class="tool"${write("session", "replace", "/before", "earlier")}>Earlier</button></li>` : ""}${messages.map((m, i) => renderMessage(m, i, messages, name)).join("")}</ul>`,
      ),
      part(
        "foot",
        `<div class="foot">${
          before === null
            ? `<form class="say" aria-label="Say something"${write("room", "add", "/messages/-")}><input name="text" autocomplete="off" required autofocus placeholder="Message" aria-label="Message"><button type="submit" class="tool">Send</button></form>`
            : `<button type="button" class="tool"${write("session", "remove", "/before")}>Latest</button>`
        }</div>`,
      ),
    ),
  });
}

/** Chat's page: the three steps, in the bento's frame (nothing opens over them). No name, the name form; no room, the rooms; else the room. */
export function render(sessionId: string): string {
  const { name, room: current, before } = sessionDoc.read(sessionId);
  const page = !name ? renderNameForm() : !current ? renderRooms(name, roomDoc.list()) : renderRoom(name, current, roomDoc.people(current), before, roomDoc.read(current, before));
  return layers(page, "", "");
}

/** A room's conversation, kept in delta (`room:<name>`): a message is written by someone with a name. */
export const room: Resource = {
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
export const here: Resource = {
  docType: "here",
  kind: "live",
  resolveDoc(ws) {
    return sessionDoc.read(ws.data.sessionId).room ?? undefined;
  },
};

/** Which rooms there are: live, kept by the server, seen by the pages that show it (the rooms). */
export const lobby: Resource = {
  docType: "lobby",
  kind: "live",
  resolveDoc: () => undefined,
};
