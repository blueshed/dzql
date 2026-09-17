import type { ServerWebSocket } from "bun";
import * as sessionDoc from "../documents/session";
import type { ConnectionData } from "../../../src/connection";
import type { PatchOp } from "../../../src/json-patch";
import { createEvent } from "../../../src/compartments/bus";
import type { Compartment } from "../../../src/compartments/compartment";
import { notify } from "../../../src/compartments/audience";
import { join, write } from "../../../src/html";

// The session is the tray (change-request.md item 10): the ground the room compartment sits on,
// not a place of its own on the page -- it has no `render` and isn't listed in the example's
// `compartments`. `renderNameForm` is still exported from here (this document decides when to
// show it), but `room.ts` is the one that renders it now, absorbing what used to be the tray's
// own page. Otherwise this only takes the writes that move around the room compartment -- a
// name, a room.

// Fires after any successful write to a session document, so other compartments
// can react to what changed (e.g. room membership) without session needing
// to know they exist. `before` is the document's state prior to this write.
export const sessionPatched = createEvent<{
  ws: ServerWebSocket<ConnectionData>;
  before: sessionDoc.SessionDocument;
  applied: PatchOp[];
}>();

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

// A session doc's writable surface: which JSON Pointer paths a connection
// may write on its own session. Blank/invalid values are rejected further
// down, inside documents/session.ts::patch() itself.
const WRITABLE_PATHS = new Set(["/name", "/room"]);

export const session: Compartment = {
  docType: "session",
  resolveDoc(ws) {
    return ws.data.sessionId; // every connection always sees its own session
  },
  permit(ws, op) {
    if (!WRITABLE_PATHS.has(op.path)) return false;
    // Writing /room requires an active (named) session -- otherwise a stale
    // second tab could silently join a room after logging out elsewhere:
    // the write would be invisible through read() (filtered by revoked_at)
    // but the socket would still join the room's live broadcast set.
    if (op.path === "/room") return sessionDoc.read(ws.data.sessionId).name !== null;
    return true;
  },
  // Undo lands here too (re-giving a name that was just removed): the same path, so room
  // membership still reacts (see compartments/room.ts's sessionPatched listener). The session's
  // own tabs are its audience; having no element of its own on the page, each is shown the page.
  write(ws, id, ops, undoes) {
    const before = sessionDoc.read(id);
    const result = sessionDoc.patch(id, ops, undoes);
    notify("session", id, result);
    if (result.applied.length > 0) sessionPatched.emit({ ws, before, applied: result.applied });
    return result;
  },
};
