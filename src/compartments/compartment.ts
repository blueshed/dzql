import type { ServerWebSocket } from "bun";
import type { ConnectionData } from "../connection";
import type { PatchOp } from "../json-patch";
import type { HtmlOp } from "./render";

export type WriteResult = { version: number; applied: PatchOp[] };

export type Compartment = {
  /** The document type name this compartment owns on the wire (e.g. "session", "room"). */
  docType: string;
  /**
   * Returns this compartment's place on the page for the current session, or `undefined` to
   * defer to the next compartment -- the kernel wraps what comes back in `<div id="c-<docType>">`
   * (item 10's rule 1). Omit entirely for something that isn't a compartment at all: the tray
   * (a document with no place of its own -- the ground the others sit on) and the ledger (a
   * document with no view at all) both keep every other part of this contract but drop `render`,
   * and neither is listed in `Example.compartments` -- only real compartments are.
   */
  render?(sessionId: string): string | undefined;
  /** Resolves the concrete document id this connection currently sees for its own docType, or undefined if none. */
  resolveDoc(ws: ServerWebSocket<ConnectionData>): string | undefined;
  /** May this connection apply `op` to the document it resolves? */
  permit(ws: ServerWebSocket<ConnectionData>, op: PatchOp): boolean;
  /**
   * Applies a permitted write: side effects and its own echo included, and -- per item 10's rule
   * 2 -- responsible for asking (`renderRequested.emit`) every connection that sees the document,
   * including this one, to be brought up to date; the kernel never renders a write's own
   * connection separately, so a write that doesn't ask leaves its own connection stale. Whether
   * this write lands on the ledger at all is the document's own choice, not this method's: a
   * document whose `patch()` never calls `record()` (e.g. wedding's tray document, or a room's
   * presence ops) is off the ledger by design -- its version stays 0 (or, for presence, doesn't
   * advance), and undo never lands on it. There's no flag for this on `Compartment` itself; if
   * the kernel ever needs to ask the question generically rather than each document answering it
   * by omission, `Compartment.ledger?: false` is the shape.
   */
  write(ws: ServerWebSocket<ConnectionData>, docId: string, ops: PatchOp[]): WriteResult;
  /**
   * Applies already-shaped ops (a ledger inverse, during undo) to `docId` and
   * echoes exactly as a direct write would -- skipping `permit` (undo isn't a
   * fresh request against the document's normal writable surface, it's the
   * ledger replaying its own recorded inverse) but otherwise going through
   * the same apply-then-echo path `write` does. `undoes` is the id of the
   * ledger entry being walked back, so the replay's own ledger row records
   * that link. Compartments reached only by docType (e.g. ledger itself) don't
   * implement this -- nothing ever undoes onto them.
   */
  replay?(ws: ServerWebSocket<ConnectionData>, docId: string, ops: PatchOp[], undoes: number): WriteResult;
  /**
   * The HTML ops that bring this connection's page up to date after `result` was applied to
   * `docId` -- the delta in HTML's terms. `[]` says the write changed nothing on this
   * connection's page (nothing is sent); `undefined` declines. Per item 10's rule 2, `fragments`
   * is now the exception, not the rule: when it's absent (or declines for this particular write)
   * but this compartment has a `render`, the kernel re-renders just this compartment's own
   * element (a single `replace` of `#c-<docType>`) instead of the whole page -- the whole page is
   * the fallback only when there's no owning compartment to re-render (a tray or ledger write) or
   * that compartment's `render` itself declines. A compartment may answer for some writes and
   * decline the rest.
   */
  fragments?(ws: ServerWebSocket<ConnectionData>, docId: string, result: WriteResult): HtmlOp[] | undefined;
  onOpen?(ws: ServerWebSocket<ConnectionData>): void;
  onClose?(ws: ServerWebSocket<ConnectionData>): void;
};
