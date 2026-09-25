import * as sessionDoc from "../documents/session";
import type { PatchOp } from "../../../src/json-patch";
import type { Compartment } from "../../../src/compartments/compartment";
import { join, write } from "../../../src/html";
import { keepPresence } from "../presence";

// The session: the ground the room sits on -- your name and your room, kept in delta
// (`session:<id>`, ../delta.ts), your own and nobody else's. What a write to it may be is here:
// a name or a room, trimmed, a blank ignored; logging out is the name taken back, and the room
// with it. Who is in a room follows from the sessions (../presence.ts).

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
const WRITABLE_PATHS = new Set(["/name", "/room"]);

export const session: Compartment = {
  docType: "session",
  perSession: true, // keyed by the session id: this session's alone
  under: "/sessions", // eta's `/name` is the document's `/sessions/name`
  resolveDoc(ws) {
    return ws.data.sessionId; // every connection always sees its own session
  },
  permit(ws, op) {
    if (!WRITABLE_PATHS.has(op.path)) return false;
    // A room only with a name: a stale tab, logged out elsewhere, does not wander into one.
    if (op.path === "/room") return sessionDoc.read(ws.data.sessionId).name !== null;
    return true;
  },
  // What the wire said, as the document takes it: a blank is nothing; the room you are in already
  // is nothing; logging out takes the name back, and the room with it.
  shape(_ws, id, ops) {
    const before = sessionDoc.read(id);
    const shaped: PatchOp[] = [];
    for (const op of ops) {
      const value = String(op.value ?? "").trim();
      if (op.path === "/name" && op.op === "remove") shaped.push({ op: "replace", path: "/name", value: null }, { op: "replace", path: "/room", value: null });
      else if (op.path === "/name" && value) shaped.push({ op: "replace", path: "/name", value });
      else if (op.path === "/room" && op.op === "remove" && before.room !== null) shaped.push({ op: "replace", path: "/room", value: null });
      else if (op.path === "/room" && op.op !== "remove" && value && value !== before.room) shaped.push({ op: "replace", path: "/room", value });
    }
    return shaped;
  },
  // a name or a room moved -- by a write, an undo, a redo: who is where follows
  afterChange: () => keepPresence(),
  onOpen: () => keepPresence(),
  onClose: () => keepPresence(),
};
