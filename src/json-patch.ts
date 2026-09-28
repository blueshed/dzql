import { parsePointer } from "./json-pointer";

/**
 * The wire's version, said on every page sent whole (`renderMessage`): 2 since a write carries an
 * id, which its echo and its refusal hand back. A page that meets a server of another version loads
 * itself again (src/client/app.ts), so the two speak alike; a page older than ids never looks, and
 * a server answers a write without an id as it always did. Here, beside the write's words, since a
 * page's bundle reads it and must reach nothing of the server's (src/client/imports.test.ts).
 */
export const WIRE = 2;

/** A single RFC 6902 JSON Patch operation. `path` is an RFC 6901 JSON Pointer. */
export type PatchOp = {
  op: "add" | "replace" | "remove";
  path: string;
  value?: unknown;
};

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

/** The wire echo of a write: sent to every connection that can see `doc`, before any HTML; to the writer's own, with its write's id. */
export function patchMessage(doc: string, version: number, ops: PatchOp[], id?: WriteId): string {
  return JSON.stringify({ type: "patch", doc, version, ops, ...(id !== undefined && { id }) });
}

/** The answer to a write that applied nothing, to its writer alone: its id, and why when the refusal says (`refuse`). The page handed back follows. */
export function refusedMessage(id: WriteId, reason?: string): string {
  return JSON.stringify({ type: "refused", id, ...(reason !== undefined && { reason }) });
}

/**
 * Applies `ops` to a copy of `value` and returns it: `add` sets a member or inserts into an array
 * (`-` appends), `replace` sets what is there, `remove` takes it out. Throws when an op's path
 * does not land -- a parent that is not there, an index past the end -- which, for a patch
 * stream, means the stream does not describe the value it is laid on.
 */
export function applyPatch<T>(value: T, ops: PatchOp[]): T {
  const root = { doc: structuredClone(value) as unknown };
  for (const op of ops) {
    const path = ["doc", ...parsePointer(op.path)];
    const last = path.pop()!;
    let parent: unknown = root;
    for (const segment of path) {
      parent = (parent as Record<string, unknown> | null)?.[segment];
      if (parent === null || typeof parent !== "object") throw new Error(`${op.op} ${op.path}: no such path`);
    }
    if (Array.isArray(parent)) {
      const index = last === "-" ? parent.length : Number(last);
      if (!Number.isInteger(index) || index < 0 || index > parent.length || (op.op !== "add" && index >= parent.length)) throw new Error(`${op.op} ${op.path}: no such index`);
      if (op.op === "add") parent.splice(index, 0, op.value);
      else if (op.op === "replace") parent[index] = op.value;
      else parent.splice(index, 1);
    } else {
      const object = parent as Record<string, unknown>;
      if (op.op !== "add" && !(last in object)) throw new Error(`${op.op} ${op.path}: no such member`);
      if (op.op === "remove") delete object[last];
      else object[last] = op.value;
    }
  }
  return root.doc as T;
}
