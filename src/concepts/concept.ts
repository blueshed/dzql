import type { ServerWebSocket } from "bun";
import type { ConnectionData } from "../connection";
import type { PatchOp } from "../json-patch";
import type { HtmlOp } from "./render";

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
  /**
   * Applies a permitted write: side effects and its own echo included. `rendered` skips the
   * automatic full render afterward. Whether this write lands on the ledger at all is the
   * document's own choice, not this method's: a document whose `patch()` never calls `record()`
   * (e.g. wedding's session document, or a room's presence ops) is off the ledger by design --
   * its version stays 0 (or, for presence, doesn't advance), and undo never lands on it. There's
   * no flag for this on `Concept` itself; if the kernel ever needs to ask the question generically
   * rather than each document answering it by omission, `Concept.ledger?: false` is the shape.
   */
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
  /**
   * The HTML ops that bring this connection's page up to date after `result` was applied to
   * `docId` -- the delta in HTML's terms, in place of a full render. `[]` says the write changed
   * nothing on this connection's page (nothing is sent); `undefined` declines, and the kernel
   * sends the whole page as before. A concept may answer for some writes and decline the rest.
   */
  fragments?(ws: ServerWebSocket<ConnectionData>, docId: string, result: WriteResult): HtmlOp[] | undefined;
  onOpen?(ws: ServerWebSocket<ConnectionData>): void;
  onClose?(ws: ServerWebSocket<ConnectionData>): void;
};
