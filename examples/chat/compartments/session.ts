import type { ServerWebSocket } from "bun";
import * as sessionDoc from "../documents/session";
import type { ConnectionData } from "../../../src/connection";
import { patchMessage } from "../../../src/json-patch";
import type { PatchOp } from "../../../src/json-patch";
import { parsePointer } from "../../../src/json-pointer";
import { createEvent } from "../../../src/compartments/bus";
import type { Compartment } from "../../../src/compartments/compartment";
import { renderRequested } from "../../../src/compartments/render";

// The session is the tray (change-request.md item 10): the ground the room compartment sits on,
// not a place of its own on the page -- it has no `render` and isn't listed in the example's
// `compartments`. `room.ts` renders the door and the page. This takes the writes that move
// around the box -- a name, a room -- and the tray's own state: what is open, whose drawer, what
// find says.

// Fires after any successful write to a session document, so other compartments
// can react to what changed (e.g. room membership) without session needing
// to know they exist. `before` is the document's state prior to this write.
export const sessionPatched = createEvent<{
  ws: ServerWebSocket<ConnectionData>;
  before: sessionDoc.SessionDocument;
  applied: PatchOp[];
}>();

// A session doc's writable surface: which fields a connection may write on its own session --
// the name and the room, and the tray's own state (what is open, whose drawer, what find says).
// Blank/invalid values are rejected further down, inside documents/session.ts::patch() itself.
const WRITABLE = new Set(["name", "room", "open", "focus", "new", "filter", "hide"]);

// Echoes a session document's ops to its own connection (direct, unlike a
// room's broadcast) and lets other compartments react, e.g. room membership.
// Exported because undo (compartments/ledger.ts) can land back on this same
// document and needs to echo it exactly the same way a direct write does.
// Not a compartment, so there's no owning element for rule 2's default to re-render --
// the tray always asks for its own full page instead.
export function echoSessionPatch(
  ws: ServerWebSocket<ConnectionData>,
  before: sessionDoc.SessionDocument,
  version: number,
  applied: PatchOp[],
) {
  if (applied.length > 0) {
    ws.send(patchMessage("session", version, applied));
    sessionPatched.emit({ ws, before, applied });
    renderRequested.emit([ws]);
  }
  return { version, applied };
}

export const session: Compartment = {
  docType: "session",
  resolveDoc(ws) {
    return ws.data.sessionId; // every connection always sees its own session
  },
  permit(ws, op) {
    const [field] = parsePointer(op.path);
    if (!field || !WRITABLE.has(field)) return false;
    // Anything but the name requires an active (named) session -- otherwise a stale second tab
    // could silently join a room after logging out elsewhere: the write would be invisible
    // through read() (filtered by revoked_at) but the socket would still join the room's live
    // broadcast set.
    if (field !== "name") return sessionDoc.read(ws.data.sessionId).name !== null;
    return true;
  },
  write(ws, id, ops) {
    const before = sessionDoc.read(id);
    const result = sessionDoc.patch(id, ops);
    return echoSessionPatch(ws, before, result.version, result.applied);
  },
  // Undo landing back on the session document (e.g. re-logging-in a name
  // that was just removed): apply the ledger's inverse ops directly --
  // skipping permit(), since this isn't a fresh request against the normal
  // writable surface -- then echo exactly as a direct write would, so room
  // membership still reacts (see compartments/room.ts's sessionPatched listener).
  replay(ws, id, ops, undoes) {
    const before = sessionDoc.read(id);
    const result = sessionDoc.patch(id, ops, undoes);
    return echoSessionPatch(ws, before, result.version, result.applied);
  },
};
