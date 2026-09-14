import type { ServerWebSocket } from "bun";
import * as sessionDoc from "../documents/session";
import type { ConnectionData } from "../connection";
import { patchMessage } from "../json-patch";
import type { PatchOp } from "../json-patch";
import { createEvent } from "./bus";
import type { Concept } from "./concept";

// Fires after any successful write to a session document, so other concepts
// can react to what changed (e.g. room membership) without session needing
// to know they exist. `before` is the document's state prior to this write.
export const sessionPatched = createEvent<{
  ws: ServerWebSocket<ConnectionData>;
  before: sessionDoc.SessionDocument;
  applied: PatchOp[];
}>();

function renderNameForm(): string {
  return `
    <form data-write='{"doc":"session","op":"replace","path":"/name"}'>
      <label for="name">Enter your name</label>
      <input id="name" name="name" autocomplete="off" autofocus required />
      <button type="submit">Continue</button>
    </form>
  `;
}

// A session doc's writable surface: which JSON Pointer paths a connection
// may write on its own session. Blank/invalid values are rejected further
// down, inside documents/session.ts::patch() itself.
const WRITABLE_PATHS = new Set(["/name", "/room"]);

export const session: Concept = {
  docType: "session",
  render(sessionId) {
    const { name } = sessionDoc.read(sessionId);
    return name ? undefined : renderNameForm();
  },
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
  write(ws, id, ops) {
    const before = sessionDoc.read(id);
    const result = sessionDoc.patch(id, ops);
    if (result.applied.length > 0) {
      ws.send(patchMessage("session", result.version, result.applied));
      sessionPatched.emit({ ws, before, applied: result.applied });
    }
    return result;
  },
};
