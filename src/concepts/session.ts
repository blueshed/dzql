import type { ServerWebSocket } from "bun";
import * as sessionDoc from "../documents/session";
import type { ConnectionData } from "../connection";
import { undo } from "../documents/undo";
import type { UndoResult } from "../documents/undo";
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

// Fires when undo lands on a document other than the session's own (a room),
// so that document's concept can broadcast it to its actual audience --
// undo is triggered through the session doc (it's a session-scoped cursor)
// but the write it walks back may belong to any document.
export const undoApplied = createEvent<UndoResult>();

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
// down, inside documents/session.ts::patch() itself. /undo isn't really a
// session document field -- it's a command, routed through the session doc
// because undo is a per-session cursor, not because it reads or writes
// {name, room}.
const WRITABLE_PATHS = new Set(["/name", "/room", "/undo"]);

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
    // Writing /room or /undo requires an active (named) session -- otherwise
    // a stale second tab could silently act after logging out elsewhere:
    // the write would be invisible through read() (filtered by revoked_at)
    // but /room would still join the room's live broadcast set, and /undo
    // would still walk back a write made before the tab went stale.
    if (op.path === "/room" || op.path === "/undo") return sessionDoc.read(ws.data.sessionId).name !== null;
    return true;
  },
  write(ws, id, ops) {
    const before = sessionDoc.read(id);

    if (ops.some((op) => op.path === "/undo")) {
      const outcome = undo(id);
      if (!outcome) return { version: 0, applied: [] };

      if (outcome.docType === "session") {
        ws.send(patchMessage("session", outcome.version, outcome.applied));
        sessionPatched.emit({ ws, before, applied: outcome.applied });
        return { version: outcome.version, applied: outcome.applied };
      }

      undoApplied.emit(outcome);
      return { version: outcome.version, applied: outcome.applied, rendered: true };
    }

    const result = sessionDoc.patch(id, ops);
    if (result.applied.length > 0) {
      ws.send(patchMessage("session", result.version, result.applied));
      sessionPatched.emit({ ws, before, applied: result.applied });
    }
    return result;
  },
};
