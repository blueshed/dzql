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
 * Makes a control write: a form on submit, a button or row on click.
 * `<form${write("room", "add", "/messages/-")}>` sends the field's value to `room`'s messages.
 *
 * - Gives `data-write` (the document, the op, the path) and, with a value, `data-value`.
 * - The spec is JSON in single quotes, escaped, so a path built from what someone typed cannot end
 *   the attribute.
 */
export function write(doc: string, op: Op, path: string, value?: unknown): string {
  const spec = JSON.stringify({ doc, op, path }).replaceAll("&", "&amp;").replaceAll("'", "&#39;");
  return ` data-write='${spec}'${value === undefined ? "" : ` data-value="${esc(value)}"`}`;
}

/**
 * Says exactly what an applet's controls write, on its mount: each a document, an op and a path,
 * `appletWrites(["team", "replace", "/draft"], …)`. A path segment that is only `*` is any one
 * segment: an id the applet reads from its props (leave's calendar moves any request's starts).
 *
 * - An applet's controls are drawn in the browser, so the stories cannot find them in the page;
 *   a story's write that one of these names counts as offered instead, with any value.
 * - Only what is named: a write deeper, shallower, or with another op is not the applet's, so a
 *   page that lost the control for it fails its story.
 * - Gives `data-writes='[{"doc","op","path"}]'`. Only the story harness reads it.
 */
export function appletWrites(...writes: (readonly [doc: string, op: Op, path: string])[]): string {
  return ` data-writes='${JSON.stringify(writes.map(([doc, op, path]) => ({ doc, op, path }))).replaceAll("&", "&amp;").replaceAll("'", "&#39;")}'`;
}

/** Joins the pieces of a view, dropping anything that is not a string (a `cond && html` that was false). */
export function join(...parts: (string | false | null | undefined)[]): string {
  return parts.filter((p): p is string => typeof p === "string").join("");
}
