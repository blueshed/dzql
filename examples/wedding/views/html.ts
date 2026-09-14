// HTML is the only vocabulary (CLAUDE.md): every view is a string of it, built here. A gesture
// is a `data-write` attribute naming a document, an op and a JSON Pointer path -- the kernel's
// client (src/client/app.ts) forwards it as is -- with the value, if any, in `data-value`.

export function esc(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export type Doc = "session" | "household" | "board" | "ledger";
export type Op = "add" | "replace" | "remove";

/** The attributes that make an element write: `data-write` (the document, the op, the path) and, when there is one, `data-value`. */
export function write(doc: Doc, op: Op, path: string, value?: unknown): string {
  const spec = JSON.stringify({ doc, op, path });
  return ` data-write='${spec}'${value === undefined ? "" : ` data-value="${esc(value)}"`}`;
}

/** Going to a page is a write to the session: the trail below the root ("" is the box at the root). */
export const nav = (page: string): string => write("session", "replace", "/page", page);

/** Joins the pieces of a view, dropping anything that is not a string (a `cond && html` that was false). */
export function join(...parts: (string | false | null | undefined)[]): string {
  return parts.filter((p): p is string => typeof p === "string").join("");
}
