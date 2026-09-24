import type { ServerWebSocket } from "bun";
import type { ConnectionData } from "../connection";
import type { PatchOp } from "../json-patch";

export type WriteResult = { version: number; applied: PatchOp[] };

export type Compartment = {
  /** The document type name this compartment owns on the wire (e.g. "session", "room"). */
  docType: string;
  /**
   * The document of this type this connection is on, or undefined if none: what a write naming the
   * type alone (`{doc: "room"}`) means, and always seen. A connection sees and may write any number
   * of others, named whole (`room:kitchen`): whatever its page read.
   */
  resolveDoc(ws: ServerWebSocket<ConnectionData>): string | undefined;
  /**
   * Its documents are keyed by the session id: each is seen by its own session alone, and named on
   * the wire by its type alone, since the id is a person's only credential. A session, a ledger, a
   * desk. Who sees any other document is derived: the one a connection is on (`resolveDoc`), and
   * whatever its page read (`reading`, in the document's `read()`).
   */
  own?: true;
  /**
   * May this connection apply `op` to `docId`? Asked only once the connection sees `docId`, so a
   * compartment whose documents are all alike to the writer (the room you are in) can ignore it; one
   * whose name is criteria (this month's appointments, last month's) judges by it.
   */
  permit(ws: ServerWebSocket<ConnectionData>, op: PatchOp, docId: string): boolean;
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
  onOpen?(ws: ServerWebSocket<ConnectionData>): void;
  onClose?(ws: ServerWebSocket<ConnectionData>): void;
};
