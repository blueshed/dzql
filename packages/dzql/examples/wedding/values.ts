// The little that every document's shape() shares: reading a wire value as what the column wants.

/** An integer, from a number or a string of digits (a path's segment, a word from the CLI); undefined otherwise. */
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

/** Yes or no: 1 or 0, as a button sends it, true or false, as a box does, or the CLI's word; undefined for anything else. */
export function yesNo(value: unknown): 0 | 1 | undefined {
  if (value === 1 || value === true || value === "yes") return 1;
  if (value === 0 || value === false || value === "no") return 0;
  return undefined;
}

