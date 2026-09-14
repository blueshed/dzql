/** A single RFC 6902 JSON Patch operation. `path` is an RFC 6901 JSON Pointer. */
export type PatchOp = {
  op: "add" | "replace" | "remove";
  path: string;
  value?: unknown;
};
