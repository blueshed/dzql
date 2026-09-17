// HTML is the only vocabulary (CLAUDE.md): every view is a string of it, built with these. A
// gesture is a `data-write` attribute naming a document, an op and a JSON Pointer path -- the
// kernel's client (src/client/app.ts) forwards it as is -- with the value, if any, in `data-value`.
// Pure: an applet may import it in the browser.

export function esc(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export type Op = "add" | "replace" | "remove";

/** The attributes that make an element write: `data-write` (the document, the op, the path) and, when there is one, `data-value`. */
export function write(doc: string, op: Op, path: string, value?: unknown): string {
  const spec = JSON.stringify({ doc, op, path });
  return ` data-write='${spec}'${value === undefined ? "" : ` data-value="${esc(value)}"`}`;
}

/** Joins the pieces of a view, dropping anything that is not a string (a `cond && html` that was false). */
export function join(...parts: (string | false | null | undefined)[]): string {
  return parts.filter((p): p is string => typeof p === "string").join("");
}
