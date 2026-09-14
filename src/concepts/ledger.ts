import type { UndoResult } from "../documents/undo";
import { undo } from "../documents/undo";
import * as sessionDoc from "../documents/session";
import { createEvent } from "./bus";
import type { Concept } from "./concept";
import { echoSessionPatch } from "./session";

// Not src/ledger.ts (the SQL-backed history) -- this is the wire-facing
// concept: undo is a write to "the ledger", the same way logging out is a
// write to "the session", rather than a bare command with no document.

// Fires when undo lands on a document other than the session's own (a room),
// so that document's concept can broadcast it to its actual audience --
// undo is triggered through the ledger (a per-session cursor into it), but
// the write it walks back may belong to any document.
export const undoApplied = createEvent<UndoResult>();

export const ledger: Concept = {
  docType: "ledger",
  // No render(): it has no view of its own, and is excluded from
  // concepts/index.ts's render/inspect list -- session and room already
  // cover every state, and there's no ledger:<id> document to report on.
  resolveDoc(ws) {
    return ws.data.sessionId; // undo is a cursor into this session's own ledger entries
  },
  // "Remove the latest [undoable entry]" -- a real document (this session's
  // ledger) and a real path, not a verb wearing one. Which entry "/latest"
  // means is resolved server-side (see documents/undo.ts), so the client
  // never needs to know or track an id.
  permit(ws, op) {
    if (op.op !== "remove" || op.path !== "/latest") return false;
    // Same guard a stale, logged-out tab needs everywhere else: it shouldn't
    // be able to walk back a write made before it went stale.
    return sessionDoc.read(ws.data.sessionId).name !== null;
  },
  write(ws, sessionId) {
    const before = sessionDoc.read(sessionId);
    const outcome = undo(sessionId);
    if (outcome?.docType === "room") {
      undoApplied.emit(outcome);
      return { version: outcome.version, applied: outcome.applied, rendered: true };
    }
    return echoSessionPatch(ws, before, outcome?.version ?? 0, outcome?.applied ?? []);
  },
};
