// HTML is the only vocabulary (CLAUDE.md): every view is a string of it, built with these. A
// gesture is a `data-write` attribute naming a document, an op and a JSON Pointer path -- the
// kernel's client (src/rendering/client/app.ts) forwards it as is -- with the value, if any, as JSON in
// `data-value`, so it goes with its type: `true`, not "true".
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

/** `value` as JSON for a single-quoted attribute, escaped so nothing in it can end the attribute. */
const quotedJson = (value: unknown): string => `'${JSON.stringify(value).replaceAll("&", "&amp;").replaceAll("'", "&#39;")}'`;

/**
 * Makes a control write: a form on submit, a button or row on click.
 * `<form${write("room", "add", "/messages/-")}>` sends the field's value to `room`'s messages.
 *
 * - Gives `data-write` (the document, the op, the path) and, with a value, `data-value`: the value as
 *   JSON, which the client parses, so a button sends `true`, `3` or `null` as such, and text as text.
 * - Each is JSON in single quotes, escaped, so a path built from what someone typed cannot end the
 *   attribute.
 */
export function write(doc: string, op: Op, path: string, value?: unknown): string {
  return ` data-write=${quotedJson({ doc, op, path })}${value === undefined ? "" : ` data-value=${quotedJson(value)}`}`;
}

/**
 * Says exactly what an applet's controls write, on its mount: each a document, an op and a path,
 * `appletWrites(["team", "replace", "/draft"], …)`, and a value where the control sends only that
 * one. A path segment that is only `*` is any one member: an id the applet reads from its props
 * (leave's calendar moves any request's starts), never `-`, the end of a list, which an applet
 * that appends names as such: `["trip", "add", "/party/-"]`, under any day's `*` as well.
 *
 * - An applet's controls are drawn in the browser, so the stories cannot find them in the page;
 *   a story's write that one of these names counts as offered instead, with any value, or with
 *   only the values it names.
 * - Only what is named: a write deeper, shallower, or with another op is not the applet's, so a
 *   page that lost the control for it fails its story.
 * - A value is how an applet says where it goes: a tap that opens a drawer (the wedding's photo,
 *   `["session", "replace", "/page", "?guest=2"]`) leads there, as a button with that
 *   `data-value` does, so a story may stand in the drawer.
 * - Gives `data-writes='[{"doc","op","path","values"?}]'`, the values of one document, op and
 *   path together, since every page that shows the applet is sent it. Only the story harness
 *   reads it.
 */
export function appletWrites(...writes: (readonly [doc: string, op: Op, path: string, value?: string | number | boolean])[]): string {
  const said: { doc: string; op: Op; path: string; values?: (string | number | boolean)[] }[] = [];
  for (const [doc, op, path, value] of writes) {
    const same = said.find((w) => w.doc === doc && w.op === op && w.path === path && (w.values === undefined) === (value === undefined));
    if (!same) said.push(value === undefined ? { doc, op, path } : { doc, op, path, values: [value] });
    else if (value !== undefined) same.values!.push(value);
  }
  return ` data-writes=${quotedJson(said)}`;
}

/**
 * An applet's props on its mount, quoted once: ` data-props="…"`, JSON whatever it holds.
 * `appletProps({ open, reveal, everyone }, { doc: "everyone:1", under: "/everyone" })` says, too,
 * the document the applet watches and where it sits in them (` data-doc="everyone:1"
 * data-under="/everyone"`; the root when `under` is not given: the props are the document).
 *
 * - The document is held whole at `under`, as the page is told it; the rest is small: what to show,
 *   and for whom. `v` is its version as held (` data-v`): `watch(doc, under)` in src/rendering/documents.ts
 *   gives all three, so the client passes over a patch the props already hold. The kernel's client lays each patch to the document on the props there and gives
 *   the applet them again (`update`), and a page is compared without the document, nor what is
 *   inside the mount (src/rendering/parts.ts): so a change to it sends the mount nothing but the patch.
 * - Without a document, the applet is sent its props again whenever they change.
 */
export function appletProps(props: unknown, watch?: { doc: string; under?: string; v?: number }): string {
  const watching = watch ? ` data-doc="${esc(watch.doc)}"${watch.under ? ` data-under="${esc(watch.under)}"` : ""}${watch.v === undefined ? "" : ` data-v="${watch.v}"`}` : "";
  return `${watching} data-props="${esc(JSON.stringify(props))}"`;
}

/** Joins the pieces of a view, dropping anything that is not a string (a `cond && html` that was false). */
export function join(...parts: (string | false | null | undefined)[]): string {
  return parts.filter((p): p is string => typeof p === "string").join("");
}
