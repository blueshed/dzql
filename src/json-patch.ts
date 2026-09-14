/** A single RFC 6902 JSON Patch operation. `path` is an RFC 6901 JSON Pointer. */
export type PatchOp = {
  op: "add" | "replace" | "remove";
  path: string;
  value?: unknown;
};

/** The wire echo of a write: sent to every connection that can see `doc`, before any HTML. */
export function patchMessage(doc: string, version: number, ops: PatchOp[]): string {
  return JSON.stringify({ type: "patch", doc, version, ops });
}
