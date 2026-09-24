import type { ServerWebSocket } from "bun";
import type { ConnectionData } from "../connection";
import type { PatchOp } from "../json-patch";

/**
 * Where a document's truth lives (`@blueshed/delta`): `written` by people, stored,
 * undoable; a `fact`, stored and never undone; `live`, held in this process; `sourced`, read from
 * outside; `static`, fixed for the release. Only `written` and `fact` are written from the wire.
 */
export type Kind = "written" | "fact" | "live" | "sourced" | "static";

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
   * whose name is criteria (this month's appointments, last month's) judges by it. Omitted: nobody
   * may (a live, sourced or static document, which no one writes from the wire).
   */
  permit?(ws: ServerWebSocket<ConnectionData>, op: PatchOp, docId: string): boolean;
  /** What kind of document it is: where its truth lives. Default `written`. */
  kind?: Kind;
  /**
   * Its documents are kept off the ledger -- registered in delta without `ledger: true` -- because
   * a write to one is not history: a visit, the page a tab is on. Undo passes it by. Said here so a
   * document left off the ledger by mistake is told from one kept off it on purpose: the kernel
   * reports a write whose ledger entry disagrees with this.
   */
  ledger?: false;
  /** Where eta's paths sit within the document (a session's fields at `/sessions`). */
  at?: string;
  /**
   * For a fresh write only: the ops as the document takes them, from
   * the ops as the wire said them -- an id minted, the author and the time added, a blank taken out.
   * An undo or a redo is delta's, and never shaped.
   */
  shape?(ws: ServerWebSocket<ConnectionData>, docId: string, ops: PatchOp[]): PatchOp[];
  /** After a change to it has been told -- to keep what follows from it true (who is here, a list of rooms). */
  changed?(docId: string, ops: PatchOp[]): void | Promise<void>;
  /**
   * After a fresh write from this connection has landed (never an
   * undo or a redo), with the ops as the wire said them -- what follows for the writer alone: the
   * modal that asked is put away once the write answers it.
   */
  wrote?(ws: ServerWebSocket<ConnectionData>, docId: string, ops: PatchOp[]): void | Promise<void>;
  onOpen?(ws: ServerWebSocket<ConnectionData>): void | Promise<void>;
  onClose?(ws: ServerWebSocket<ConnectionData>): void | Promise<void>;
};
