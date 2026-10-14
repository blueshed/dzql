import { applyOps, type DeltaOp } from "@blueshed/delta/core";

/**
 * The wire's version, said on every page sent whole (`renderMessage`): 2 since a write carries an
 * id, which its echo and its refusal hand back; 3 since a typed field's write may carry a `test`
 * of the value it was drawn with, which an older server would take as no write; 4 since a value goes
 * with its type: a button's `data-value` is JSON (`true`, not "true") and a number field sends a
 * number, which an older page would send as text. A page that meets a server of another version loads
 * itself again (src/client/app.ts), so the two speak alike; a page older than ids never looks, and
 * a server answers a write without an id as it always did. Here, beside the write's words, since a
 * page's bundle reads it and must reach nothing of the server's (src/client/imports.test.ts).
 */
export const WIRE = 4;

/** A single RFC 6902 JSON Patch operation. `path` is an RFC 6901 JSON Pointer. */
export type PatchOp = {
  op: "add" | "replace" | "remove";
  path: string;
  value?: unknown;
};

/** Is this one of a write's verbs: `add`, `replace` or `remove`? */
export const isVerb = (op: unknown): op is PatchOp["op"] => op === "add" || op === "replace" || op === "remove";

/**
 * RFC 6902's `test`, a condition and not a change: the value the field that writes `path` was drawn
 * with when someone began typing in it (todo n4). The server holds it against what that field is
 * drawn with on their page now, and refuses the write when it differs: someone else changed it since.
 */
export type Test = { op: "test"; path: string; value: string };

/** Is this op a `test`? */
export const isTest = (op: { op: unknown }): op is Test => op.op === "test";

/**
 * A write's id: the sender's own, a number or a string, which the server only hands back -- on the
 * echo of the change the write made, to its writer alone, or on its refusal -- so a page knows its
 * own write from anyone else's.
 */
export type WriteId = number | string;

/** The longest string an id may be: the server never sends back more than a write's own words would say. */
export const LONGEST_ID = 64;

/** Is this an id: a number JSON can say back (not 1e400, which parses as Infinity), or a string of at most `LONGEST_ID`? */
export const isWriteId = (id: unknown): id is WriteId => (typeof id === "number" && Number.isFinite(id)) || (typeof id === "string" && id.length <= LONGEST_ID);

/**
 * The wire echo of a write: sent to every connection that can see `doc`, before any HTML; to the
 * writer's own, with its write's id and the handle of the change it made, which undoes it by name
 * (`remove /<change>` on the ledger).
 */
export function patchMessage(doc: string, version: number, ops: PatchOp[], id?: WriteId, change?: string): string {
  return JSON.stringify({ type: "patch", doc, version, ops, ...(id !== undefined && { id, ...(change !== undefined && { change }) }) });
}

/** The answer to a write that applied nothing, to its writer alone: its id, and why when the refusal says (`refuse`). The page handed back follows. */
export function refusedMessage(id: WriteId, reason?: string): string {
  return JSON.stringify({ type: "refused", id, ...(reason !== undefined && { reason }) });
}

/**
 * Applies `ops` to a copy of `value` and returns it, by delta's own rule (`applyOps`): `add` sets a
 * member or inserts into an array (`-` appends), `replace` sets what is there, `remove` takes it
 * out. Throws when an op's path does not land -- which, for a patch stream, means the stream does
 * not describe the value it is laid on.
 */
export function applyPatch<T>(value: T, ops: PatchOp[]): T {
  const copy = structuredClone(value);
  applyOps(copy, ops as DeltaOp[]);
  return copy;
}
