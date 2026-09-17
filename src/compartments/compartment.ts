import type { ServerWebSocket } from "bun";
import type { ConnectionData } from "../connection";
import type { PatchOp } from "../json-patch";
import type { HtmlOp } from "./render";

export type WriteResult = { version: number; applied: PatchOp[] };

export type Compartment = {
  /** The document type name this compartment owns on the wire (e.g. "session", "room"). */
  docType: string;
  /** Resolves the concrete document id this connection currently sees for its own docType, or undefined if none. */
  resolveDoc(ws: ServerWebSocket<ConnectionData>): string | undefined;
  /**
   * Does this connection see `docId` -- not necessarily its *own* `resolveDoc(ws)`, which only
   * answers for the one document this connection writes to (change-request.md item 1). Omit for
   * the common case: a document seen by nobody but whoever `resolveDoc` already names for it
   * (`src/compartments/audience.ts`'s `audienceFor` falls back to exactly that check). Implement
   * it when someone sees a document that isn't theirs to write -- the wedding's `household` is
   * everyone's own household code, but also every couple's tab, which has no household code of
   * its own to `resolveDoc` toward.
   */
  sees?(ws: ServerWebSocket<ConnectionData>, docId: string): boolean;
  /** May this connection apply `op` to the document it resolves? */
  permit(ws: ServerWebSocket<ConnectionData>, op: PatchOp): boolean;
  /**
   * Applies a permitted write and tells everyone who sees the document, this connection included
   * (`notify` in `src/compartments/audience.ts`): the kernel never brings a write's own connection
   * up to date separately, so a write that doesn't ask leaves it stale. Whether the write lands on
   * the ledger is the document's own choice: one whose `patch()` never calls `record()` (the
   * wedding's session, a room's presence ops) is off it, and undo never lands there.
   *
   * `undoes` is set when this is not a fresh request but the ledger walking one back or forward
   * (undo, redo): `ops` are then a recorded inverse, `permit` was not asked, and `undoes` is the
   * id of the entry being walked, for `record()`. Same path either way -- apply, then tell whoever
   * sees the document -- so what a fresh write does to the wire's value (chat shapes a message,
   * the wedding keeps only a name) it does only when `undoes` is undefined.
   */
  write(ws: ServerWebSocket<ConnectionData>, docId: string, ops: PatchOp[], undoes?: number): WriteResult;
  /**
   * The HTML ops that bring this connection's page up to date after `result` was applied to
   * `docId` -- the delta in HTML's terms. `[]` says the write changed nothing on this
   * connection's page (nothing is sent); `undefined` declines, and the page goes whole -- the
   * morph finds what changed. So `fragments` is the exception: answer only where smaller is
   * worth the care, since every target named has to be right for every state the page can be in.
   * A compartment may answer for some writes and decline the rest.
   */
  fragments?(ws: ServerWebSocket<ConnectionData>, docId: string, result: WriteResult): HtmlOp[] | undefined;
  onOpen?(ws: ServerWebSocket<ConnectionData>): void;
  onClose?(ws: ServerWebSocket<ConnectionData>): void;
};
