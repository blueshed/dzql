import * as sessionDoc from "../documents/session";
import * as roomDoc from "../documents/room";
import type { PatchOp } from "dzql/rendering/json-patch";
import type { Resource } from "dzql/rendering/resources/resource";
import { join, write } from "dzql/rendering/html";
import { keepPresence } from "../presence";
import { refuse } from "dzql/rendering/refusal";

// The session: the ground the room sits on -- your name, your room and how far back in it you
// read, kept in delta (`session:<id>`, ../delta.ts), your own and nobody else's. What a write to it
// may be is here: a name or a room, trimmed, a blank ignored; logging out is the name taken back,
// and the room with it. Who is in a room follows from the sessions (../presence.ts).
//
// How far back you read is the session's, as where you are is: the message your window ends
// before (`/before`), a keyset, which a message said meanwhile never moves, as an offset would.
// The page still reads the room whole (`room:<name>`), so it is told every change to it, and
// draws its own fifty of it (../documents/room.ts): a message said meanwhile is after every
// window but the latest, so a page reading back draws the same and is sent nothing. A window as
// a document of its own (`room:general?before=<id>`), holding less, waits for a room too big to
// hold whole. The wire says `earlier`; `shape` names the message.

/** Without a name you cannot enter: the one form before anything else. */
export function renderNameForm(): string {
  return join(
    `<section class="door"><h1 class="cap">Chat</h1>`,
    `<form${write("session", "replace", "/name")}>`,
    `<label for="name" class="note">Your name</label>`,
    `<input id="name" name="name" autocomplete="off" autofocus required>`,
    `<button type="submit" class="tool">Continue</button>`,
    `</form></section>`,
  );
}

// A session's writable surface: the paths a connection may write on its own session.
const WRITABLE_PATHS = new Set(["/name", "/room", "/before"]);

export const session: Resource = {
  docType: "session",
  perSession: true, // keyed by the session id: this session's alone
  under: "/sessions", // eta's `/name` is the document's `/sessions/name`
  resolveDoc(ws) {
    return ws.data.sessionId; // every connection always sees its own session
  },
  permit(ws, op) {
    if (!WRITABLE_PATHS.has(op.path) || op.op === "add") return false; // a name or a room is replaced, or taken back
    // A room only with a name: a stale tab, logged out elsewhere, does not wander into one.
    if (op.path === "/room") return sessionDoc.read(ws.data.sessionId).name !== null;
    if (op.path === "/before") return sessionDoc.read(ws.data.sessionId).room !== null;
    return true;
  },
  // What the wire said, as the document takes it: a blank is nothing; the room you are in already
  // is nothing; logging out takes the name back, and the room with it. `earlier` is the fifty
  // before what you read, if there are any; taken back, the latest. Leaving a room leaves where you
  // read in it.
  shape(_ws, id, ops) {
    const was = sessionDoc.read(id);
    const back: PatchOp[] = was.before === null ? [] : [{ op: "replace", path: "/before", value: null }];
    const shaped: PatchOp[] = [];
    for (const op of ops) {
      const value = String(op.value ?? "").trim();
      if (op.path === "/name" && op.op === "remove") shaped.push({ op: "replace", path: "/name", value: null }, { op: "replace", path: "/room", value: null }, ...back);
      else if (op.path === "/name" && value) shaped.push({ op: "replace", path: "/name", value });
      else if (op.path === "/room" && op.op === "remove" && was.room !== null) shaped.push({ op: "replace", path: "/room", value: null }, ...back);
      else if (op.path === "/room" && op.op !== "remove" && value.includes(":")) throw refuse("A room's name has no colon in it."); // a room is a document named by its name, and `:` divides one
      else if (op.path === "/room" && op.op !== "remove" && value && value !== was.room) shaped.push({ op: "replace", path: "/room", value }, ...back);
      else if (op.path === "/before" && op.op === "remove") shaped.push(...back);
      else if (op.path === "/before" && value === "earlier") {
        const { messages, earlier } = roomDoc.read(was.room!, was.before);
        if (earlier) shaped.push({ op: "replace", path: "/before", value: messages[0]!.id });
      }
    }
    return shaped;
  },
  // a name or a room moved -- by a write, an undo, a redo: who is where follows
  afterChange: () => keepPresence(),
  onOpen: () => keepPresence(),
  onClose: () => keepPresence(),
};
