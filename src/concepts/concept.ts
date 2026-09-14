import type { ServerWebSocket } from "bun";
import type { ConnectionData } from "../connection";
import type { PatchOp } from "../json-patch";

export type WriteResult = { version: number; applied: PatchOp[]; rendered?: boolean };

export type Concept = {
  /** The document type name this concept owns on the wire (e.g. "session", "room"). */
  docType: string;
  /** Returns this concept's view of the current session, or `undefined` to defer to the next concept. */
  render(sessionId: string): string | undefined;
  /** Resolves the concrete document id this connection currently sees for its own docType, or undefined if none. */
  resolveDoc(ws: ServerWebSocket<ConnectionData>): string | undefined;
  /** May this connection apply `op` to the document it resolves? */
  permit(ws: ServerWebSocket<ConnectionData>, op: PatchOp): boolean;
  /** Applies a permitted write: side effects and its own echo included. `rendered` skips the automatic full render afterward. */
  write(ws: ServerWebSocket<ConnectionData>, docId: string, ops: PatchOp[]): WriteResult;
  onOpen?(ws: ServerWebSocket<ConnectionData>): void;
  onClose?(ws: ServerWebSocket<ConnectionData>): void;
};
