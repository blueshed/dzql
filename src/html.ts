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

/**
 * The attributes that make an element write: `data-write` (the document, the op, the path) and,
 * when there is one, `data-value`. The spec is JSON in single quotes, so a quote or an ampersand
 * in it -- a path built from what someone typed -- is escaped, and cannot end the attribute.
 */
export function write(doc: string, op: Op, path: string, value?: unknown): string {
  const spec = JSON.stringify({ doc, op, path }).replaceAll("&", "&amp;").replaceAll("'", "&#39;");
  return ` data-write='${spec}'${value === undefined ? "" : ` data-value="${esc(value)}"`}`;
}

/**
 * An applet's mount says what its own controls write -- drawn in the browser, so no `data-write`
 * is there for the stories to find -- as a document and the path they write under:
 * `data-writes='{"doc","path"}'`. Only the story harness reads it (a control for the story's write).
 */
export function writes(doc: string, path: string): string {
  return ` data-writes='${JSON.stringify({ doc, path }).replaceAll("&", "&amp;").replaceAll("'", "&#39;")}'`;
}

/** Joins the pieces of a view, dropping anything that is not a string (a `cond && html` that was false). */
export function join(...parts: (string | false | null | undefined)[]): string {
  return parts.filter((p): p is string => typeof p === "string").join("");
}
