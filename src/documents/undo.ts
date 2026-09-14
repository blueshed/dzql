import type { PatchOp } from "../json-patch";
import { nextUndo, splitDoc } from "../ledger";
import * as roomDoc from "./room";
import * as sessionDoc from "./session";

export type UndoResult = { docType: "session" | "room"; docId: string; version: number; applied: PatchOp[] };

/**
 * Walks back the newest not-yet-undone write this session made, to whichever
 * document it touched, applying the ledger's inverse as a new patch (so the
 * undo is itself in the ledger and echoed). Returns undefined if this
 * session has nothing left to undo.
 */
export function undo(sessionId: string): UndoResult | undefined {
  const entry = nextUndo(sessionId);
  if (!entry) return undefined;

  const { docType, docId } = splitDoc(entry.doc);

  if (docType === "session") {
    const result = sessionDoc.patch(docId, entry.inverse, entry.id);
    return { docType: "session", docId, version: result.version, applied: result.applied };
  }
  if (docType === "room") {
    const result = roomDoc.patch(docId, entry.inverse, sessionId, entry.id);
    return { docType: "room", docId, version: result.version, applied: result.applied };
  }
  return undefined;
}
