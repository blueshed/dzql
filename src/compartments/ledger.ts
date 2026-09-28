import type { Compartment } from "./compartment";

// The wire-facing ledger: undo is a write to "the ledger", the same way logging out is a write to
// "the session", rather than a bare command with no document. The ledger itself is delta's: each
// write recorded with its inverse, and the cursor undo walks is the session (src/server.ts).

/**
 * Builds the ledger compartment for one assembled example. `active(sessionId)` is the guard every
 * write path needs -- a stale, logged-out tab shouldn't be able to walk back a write made before
 * it went stale -- and only the example knows what that means.
 */
export function createLedgerCompartment(active: (sessionId: string) => boolean): Compartment {
  return {
    docType: "ledger",
    perSession: true, // a session's own ledger: its undo cursor
    resolveDoc(ws) {
      return ws.data.sessionId; // undo is a cursor into this session's own ledger entries
    },
    // "Remove the latest [undoable entry]" is undo; "add [back] the latest [undone one]" is redo --
    // a real document (this session's ledger) and a real path, not a verb wearing one. Which entry
    // "/latest" means is delta's to find, so the client never tracks an id.
    permit(ws, op) {
      if ((op.op !== "remove" && op.op !== "add") || op.path !== "/latest") return false;
      return active(ws.data.sessionId);
    },
  };
}
