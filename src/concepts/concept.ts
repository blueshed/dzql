import type { ServerWebSocket } from "bun";
import type { ConnectionData } from "../connection";
import type { PatchOp } from "../json-patch";

export type WriteResult = { version: number; applied: PatchOp[]; rendered?: boolean };

export type Concept = {
  /** The document type name this concept owns on the wire (e.g. "session", "room"). */
  docType: string;
  /** Returns this concept's view of the current session, or `undefined` to defer to the next concept. Omit if this concept has no view of its own (e.g. it's reached only by docType, like ledger). */
  render?(sessionId: string): string | undefined;
  /** Resolves the concrete document id this connection currently sees for its own docType, or undefined if none. */
  resolveDoc(ws: ServerWebSocket<ConnectionData>): string | undefined;
  /** May this connection apply `op` to the document it resolves? */
  permit(ws: ServerWebSocket<ConnectionData>, op: PatchOp): boolean;
  /** Applies a permitted write: side effects and its own echo included. `rendered` skips the automatic full render afterward. */
  write(ws: ServerWebSocket<ConnectionData>, docId: string, ops: PatchOp[]): WriteResult;
  /**
   * Applies already-shaped ops (a ledger inverse, during undo) to `docId` and
   * echoes exactly as a direct write would -- skipping `permit` (undo isn't a
   * fresh request against the document's normal writable surface, it's the
   * ledger replaying its own recorded inverse) but otherwise going through
   * the same apply-then-echo path `write` does. `undoes` is the id of the
   * ledger entry being walked back, so the replay's own ledger row records
   * that link. Concepts reached only by docType (e.g. ledger itself) don't
   * implement this -- nothing ever undoes onto them.
   */
  replay?(ws: ServerWebSocket<ConnectionData>, docId: string, ops: PatchOp[], undoes: number): WriteResult;
  onOpen?(ws: ServerWebSocket<ConnectionData>): void;
  onClose?(ws: ServerWebSocket<ConnectionData>): void;
};
