// HTML is the only vocabulary: every view is a string of it, built here. A gesture is a
// `data-write` attribute naming a document, an op and a JSON Pointer path, with the value, if
// any, in `data-value`.
export const esc = (value: unknown): string =>
  String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");

export type Doc = "desk" | "watchlist" | "clock" | "ledger";
export type Op = "add" | "replace" | "remove";

export function write(doc: Doc, op: Op, path: string, value?: unknown): string {
  return ` data-write='${JSON.stringify({ doc, op, path })}'${value === undefined ? "" : ` data-value="${esc(value)}"`}`;
}

export const join = (...parts: (string | false | null | undefined)[]): string => parts.filter((p): p is string => typeof p === "string").join("");
