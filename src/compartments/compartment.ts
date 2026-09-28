import type { ServerWebSocket } from "bun";
import type { ConnectionData } from "../connection";
import type { PatchOp } from "../json-patch";

/**
 * Where a document's truth lives (`@blueshed/delta`). Default `written`.
 *
 * - `written`: written by people, stored, and undoable (a room's messages).
 * - `fact`: written and stored, but never undone (a payment taken).
 * - `live`: kept by the server in memory (who is in a room).
 * - `sourced`: read from outside. `static`: fixed for the release.
 *
 * Only `written` and `fact` are written from the wire.
 */
export type Kind = "written" | "fact" | "live" | "sourced" | "static";

/**
 * An undo or a redo, as it landed: which way it went, what it wrote, and what that wrote over (its
 * inverse, which holds what it took back) -- in the wire's paths, each row whole, as the ledger
 * keeps them.
 */
export type Walk = { way: "undo" | "redo"; ops: PatchOp[]; inverse: PatchOp[] };

/**
 * A compartment looks after one type of document: which one a page is on, who may write to it, and
 * what a write becomes. It has no place on the page: the page is the example's `render(sessionId)`.
 *
 * Its hooks, in the order they run: `permit` and `shape` before a write; `permitUndo` before an
 * undo or redo; `afterWrite` after a fresh write, and `afterWalk` after an undo or redo, for the
 * writer; `afterChange` after any change.
 */
export type Compartment = {
  /** The document type it looks after, as the wire names it: `"room"` for `room:general`. */
  docType: string;
  /**
   * Which document of this type this person is on, or undefined: chat's is the room the session is
   * in. A write naming the type alone (`{doc: "room"}`) means this one. A page may also read, and
   * write, any other document named whole (`room:kitchen`).
   */
  resolveDoc(ws: ServerWebSocket<ConnectionData>): string | undefined;
  /**
   * There is one document per session: the session itself, a ledger, the ticker's desk. Each is seen
   * by its own session alone, and named on the wire by its type alone, since the session id is a
   * credential and never crosses the wire.
   */
  perSession?: true;
  /** What kind of document it is. Default `written`. */
  kind?: Kind;
  /**
   * Its writes are not history, so Undo skips them: where a tab is, a visit. Delta keeps its
   * documents off the ledger; saying so here too lets the kernel catch one left off by mistake.
   */
  ledger?: false;
  /** Where the wire's paths sit inside the document: a session's `/name` is at `/sessions/name` when this is `/sessions`. */
  under?: string;
  /**
   * Before a write: may this person make this change? Asked for each op.
   *
   * - Return false to refuse without a word: right for a write no page offers.
   * - Throw `refuse(reason)` (src/refusal.ts) to refuse and say why, beside the control.
   * - Omitted: nobody may (a live, sourced or static document).
   * - Asked only for a document the page can see, so a room you are in need not be checked again.
   */
  permit?(ws: ServerWebSocket<ConnectionData>, op: PatchOp, docId: string): boolean;
  /**
   * Before a write: what the page sent, as the document keeps it. Chat's turns `add /messages/-`
   * with the text into a message with a new id, its author and the time.
   *
   * - Return nothing to refuse without a word; throw `refuse(reason)` to say why.
   * - Only for a fresh write: an undo or redo is never shaped.
   */
  shape?(ws: ServerWebSocket<ConnectionData>, docId: string, ops: PatchOp[]): PatchOp[];
  /**
   * Before an undo or redo: may it go ahead? Given the ops it would write, in the wire's paths
   * (only the fields it sets back).
   *
   * - For a rule of time or state that holds against Undo too: answers closed at a deadline.
   * - Not `permit`: Undo may do what permit refuses (a message taken back).
   * - Throw `refuse(reason)` to say why. Omitted: always.
   */
  permitUndo?(ws: ServerWebSocket<ConnectionData>, docId: string, ops: PatchOp[]): boolean;
  /**
   * After a fresh write from this person has landed, with the ops as the page sent them: what
   * follows for the writer alone. Leave closes the drawer once its draft is asked for.
   *
   * - Say what it did with `tell(ws.data.sessionId, { doc, path, said })` (src/refusal.ts), beside
   *   the control that sent it: what the writer was told before has gone by then.
   * - Never after an undo or redo: that is `afterWalk`'s.
   * - A throw here is the server's failure, reported; the write stands.
   */
  afterWrite?(ws: ServerWebSocket<ConnectionData>, docId: string, ops: PatchOp[]): void | Promise<void>;
  /**
   * After an undo or redo of this person's has landed: what follows for the walker alone, as
   * `afterWrite` is for a fresh write.
   *
   * - A walk that changes nothing -- what it would set back is so already -- lands all the same, as
   *   delta moves the cursor past it, and this runs with `ops: []` and `inverse: []`: say nothing.
   * - Say what it took back, or put back, with `tell(ws.data.sessionId, { doc: "ledger", path:
   *   "/latest", said })`: the Undo tool's own place, which the kernel draws over the page. The
   *   wedding's "Undone: your answer."
   * - A throw here is the server's failure, reported; the walk stands.
   */
  afterWalk?(ws: ServerWebSocket<ConnectionData>, docId: string, walk: Walk): void | Promise<void>;
  /**
   * After any change to one of its documents, from anyone, undo and redo included, once it has been
   * told: keep what follows from it true. Chat's keeps the list of rooms.
   */
  afterChange?(docId: string, ops: PatchOp[]): void | Promise<void>;
  /** A page connected: chat's session keeps who is in each room. */
  onOpen?(ws: ServerWebSocket<ConnectionData>): void | Promise<void>;
  /** A page closed: chat's session keeps who is in each room. */
  onClose?(ws: ServerWebSocket<ConnectionData>): void | Promise<void>;
};
