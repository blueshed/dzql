import type { PatchOp } from "../../../src/json-patch";

// The little that every document's patch() shares: reading a wire value as what the column
// wants, and the inverse that puts a scalar back.

/** An integer, from a number or a string of digits (a button's data-value is always a string); undefined otherwise. */
export function integer(value: unknown): number | undefined {
  if (value === null || value === undefined || value === "" || typeof value === "boolean") return undefined;
  const n = Number(value);
  return Number.isInteger(n) ? n : undefined;
}

/** Trimmed text, or null when blank. */
export function text(value: unknown): string | null {
  const s = String(value ?? "").trim();
  return s ? s : null;
}

/** Yes or no, however a form or a button spells it; undefined for anything else. */
export function yesNo(value: unknown): 0 | 1 | undefined {
  if (value === 1 || value === true || value === "1" || value === "true" || value === "yes" || value === "on") return 1;
  if (value === 0 || value === false || value === "0" || value === "false" || value === "no" || value === "off") return 0;
  return undefined;
}

/**
 * The op that restores a scalar to `value`. A `replace` can't put back "no value" (a blank is
 * refused as invalid), so restoring null is a `remove` -- or undo of a field's very first
 * setting would silently do nothing.
 */
export function restore(path: string, value: unknown): PatchOp {
  return value === null || value === undefined ? { op: "remove", path } : { op: "replace", path, value };
}
