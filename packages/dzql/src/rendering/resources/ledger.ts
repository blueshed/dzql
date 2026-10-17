import type { Resource } from "./resource";

// The wire-facing ledger: undo is a write to "the ledger", the same way logging out is a write to
// "the session", rather than a bare command with no document. The ledger itself is delta's: each
// write recorded with its inverse, and the cursor undo walks is the session (src/server.ts).

/**
 * Builds the ledger resource for one assembled example. `active(sessionId)` is the guard every
 * write path needs -- a stale, logged-out tab shouldn't be able to walk back a write made before
 * it went stale -- and only the example knows what that means.
 */
export function createLedgerResource(active: (sessionId: string) => boolean): Resource {
  return {
    docType: "ledger",
    perSession: true, // a session's own ledger: its undo cursor
    resolveDoc(ws) {
      return ws.data.sessionId; // undo is a cursor into this session's own ledger entries
    },
    // "Remove the latest [undoable entry]" is undo; "add [back] the latest [undone one]" is redo --
    // a real document (this session's ledger) and a real path, not a verb wearing one. Which entry
    // "/latest" means is delta's to find, so the client never tracks an id. "/<handle>" names one
    // change of this session's by the handle its write's echo gave (src/server.ts): an assistant
    // and a person on one page each undo their own.
    permit(ws, op) {
      if ((op.op !== "remove" && op.op !== "add") || !(op.path === "/latest" || handleOf(op.path) !== undefined)) return false;
      return active(ws.data.sessionId);
    },
  };
}

/** The handle of a change a path names, `/<handle>`: sixteen hex digits, as `newHandle` makes them; undefined for any other path. */
export const handleOf = (path: string): string | undefined => (/^\/[0-9a-f]{16}$/.test(path) ? path.slice(1) : undefined);

/** A change's handle: random, so it says nothing of anyone's writes, and never the same twice. */
export const newHandle = (): string => [...crypto.getRandomValues(new Uint8Array(8))].map((b) => b.toString(16).padStart(2, "0")).join("");
