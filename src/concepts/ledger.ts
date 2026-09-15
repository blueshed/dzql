import { nextRedo, nextUndo, splitDoc } from "../ledger";
import type { Concept, WriteResult } from "./concept";

// Not src/ledger.ts (the SQL-backed history) -- this is the wire-facing
// concept: undo is a write to "the ledger", the same way logging out is a
// write to "the session", rather than a bare command with no document.

/**
 * Builds the ledger concept for one assembled example. It's a factory, not a
 * fixed export, because "undo" needs two things only the example (or the
 * kernel's own assembly of it) can supply, without the kernel importing any
 * specific example's concepts:
 *
 * - `lookup(docType)`: finds the concept that owns whatever document an
 *   undo actually lands on (a room undo needs the room concept's `replay`,
 *   a session undo needs the session concept's), since a session's ledger
 *   cursor can point at any document type it has ever written to.
 * - `active(sessionId)`: the same "is this session allowed to write at all
 *   right now" guard every other write path needs -- a stale, logged-out
 *   tab shouldn't be able to walk back a write made before it went stale.
 */
export function createLedgerConcept(
  lookup: (docType: string) => Concept | undefined,
  active: (sessionId: string) => boolean,
): Concept {
  return {
    docType: "ledger",
    // No render(): it has no view of its own, and is excluded from
    // assemble()'s render/inspect list -- an example's own concepts already
    // cover every state, and there's no ledger:<id> document to report on
    // for inspect.
    resolveDoc(ws) {
      return ws.data.sessionId; // undo is a cursor into this session's own ledger entries
    },
    // "Remove the latest [undoable entry]" is undo; "add [back] the latest
    // [undone one]" is redo -- a real document (this session's ledger) and
    // a real path, not a verb wearing one. Which entry "/latest" means is
    // resolved server-side, in write() below, so the client never needs to
    // know or track an id.
    permit(ws, op) {
      if ((op.op !== "remove" && op.op !== "add") || op.path !== "/latest") return false;
      // Same guard a stale, logged-out tab needs everywhere else: it
      // shouldn't be able to walk back a write made before it went stale.
      return active(ws.data.sessionId);
    },
    write(ws, sessionId, ops): WriteResult {
      const entry = ops[0]?.op === "add" ? nextRedo(sessionId) : nextUndo(sessionId);
      if (!entry) return { version: 0, applied: [] };

      const { docType, docId } = splitDoc(entry.doc);
      const owner = lookup(docType);
      // An entry for a doc type nothing in this example owns (or that
      // declines to support replay) simply isn't undoable -- it doesn't
      // get skipped in favor of an older entry; undo just does nothing.
      if (!owner?.replay) return { version: 0, applied: [] };

      return owner.replay(ws, docId, entry.inverse, entry.id);
    },
  };
}
