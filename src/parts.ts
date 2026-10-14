import type { HtmlOp } from "./compartments/render";
import { esc } from "./html";
import { applyOps } from "@blueshed/delta/core";

// A page is drawn whole on the server and sent in parts. A render names the regions of its page
// with `part(key, html)`; the kernel keeps, per connection, the parts it last sent, and after a
// write draws the page again and sends only what differs: a part replaced, a row added or taken
// out of a list. The whole page goes only when its own outline changed -- a different page. Which
// parts a render names is the only thing it says about delivery; what to send is worked out.

type Recorded = { key: string; html: string };
const recordings: Recorded[][] = [];

/** What a part's root element carries, as its HTML says it: `data-eta-part="<key>"`. */
const carries = (key: string): string => `data-eta-part="${key.replaceAll('"', "&quot;")}"`;

/** Names a region of the page: its root element is tagged `data-eta-part="<key>"`, and it is sent on its own when it alone changed. A key is unique on its page. */
export function part(key: string, html: string): string {
  const tagged = html.replace(/^(\s*<[a-zA-Z][\w-]*)/, `$1 ${carries(key)}`);
  recordings.at(-1)?.push({ key, html: tagged });
  return tagged;
}

/**
 * A page as it is compared: every applet that watches a document (`data-doc`) with that document
 * left out of its props (at `data-under`; all of them when it sits at the root) and nothing inside
 * it. Its patches keep both: the document, which the client lays on the props, and what the applet
 * draws from them, which the server painted there only first. So a change to the document alone
 * changes nothing here. A tag's props it cannot read, or whose document is not where it says, it
 * leaves as they are.
 */
export function comparable(html: string): string {
  if (!html.includes("data-doc")) return html;
  let out = "";
  let copied = 0;
  let at = 0;
  for (let t = nextTag(html, at); t; t = nextTag(html, at)) {
    if (t.end) {
      at = t.at + 1;
      continue;
    }
    const end = tagEnd(html, t.at);
    const tag = html.slice(t.at, end);
    at = end;
    if (!watches(tag)) continue;
    out += html.slice(copied, t.at) + watchedTag(tag);
    copied = at = VOID.has(t.name) ? end : closing(html, end, t.name);
  }
  return out + html.slice(copied);
}

/** The elements that have no inside and no end tag: HTML's void elements. */
const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);

/** A start tag (`<name`) or an end tag (`</name`), where one begins. */
const TAG = /<(\/?)([a-zA-Z][\w-]*)/y;
/** One attribute of a start tag, after its name: its name, and its value however it is quoted. */
const ATTRIBUTE = /\s+([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/y;

type Attribute = { name: string; value: string; from: number; to: number };

/** A start tag's attributes, each with its value as a browser reads it, and where it stands in the tag. */
function attributes(tag: string): Attribute[] {
  const found: Attribute[] = [];
  ATTRIBUTE.lastIndex = /^<[a-zA-Z][\w-]*/.exec(tag)?.[0].length ?? 0;
  for (let m = ATTRIBUTE.exec(tag); m; m = ATTRIBUTE.exec(tag)) {
    found.push({ name: m[1]!.toLowerCase(), value: decoded(m[2] ?? m[3] ?? m[4] ?? ""), from: m.index, to: ATTRIBUTE.lastIndex });
  }
  return found;
}

/** An attribute's value as a browser reads it: the five that `esc` escapes (src/html.ts), unescaped. */
export const decoded = (value: string): string =>
  value.replaceAll("&quot;", '"').replaceAll("&#39;", "'").replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&amp;", "&");

/** Whether a start tag is an applet's that watches a document: it has `data-doc` of its own. */
export const watches = (tag: string): boolean => tag.includes("data-doc") && attributes(tag).some((a) => a.name === "data-doc");

/** A watching mount's tag, its props without the document they hold, and without the version of it they hold (`data-v`). */
function watchedTag(tag: string): string {
  const all = attributes(tag);
  const props = all.find((a) => a.name === "data-props");
  const rest = props && without(props.value, all.find((a) => a.name === "data-under")?.value ?? "");
  const changed = all.filter((a) => a.name === "data-v" || (a === props && rest !== undefined)).reverse(); // from the end, so each stands where it was found
  const now = (a: Attribute): string => (a === props && rest !== ROOT ? ` data-props="${esc(JSON.stringify(rest))}"` : "");
  return changed.reduce((t, a) => t.slice(0, a.from) + now(a) + t.slice(a.to), tag);
}

const ROOT = Symbol("the document is all the props");

/** A mount's own props, as JSON: its props (JSON) without the document it watches, at `under` -- nothing, when that is the root -- or as they are, when they cannot be read or it is not there. */
export function ownProps(json: string, under: string): string {
  const rest = without(json, under);
  return rest === ROOT ? "" : rest === undefined ? json : JSON.stringify(rest);
}

/** Props without what sits at `under`: `ROOT` when that is all of them; undefined when they cannot be read, or nothing is there. */
function without(json: string, under: string): unknown {
  if (under === "") return ROOT;
  try {
    const props = JSON.parse(json) as unknown;
    applyOps(props, [{ op: "remove", path: under }]);
    return props;
  } catch {
    return undefined;
  }
}

/**
 * The first start or end tag at or after `at`, passing over comments and a `<` that starts no tag:
 * where it starts, whether it is an end tag, and its name, lower-cased.
 */
function nextTag(html: string, at: number): { at: number; end: boolean; name: string } | undefined {
  for (at = html.indexOf("<", at); at >= 0; at = html.indexOf("<", at)) {
    if (html.startsWith("<!--", at)) {
      at = past(html, at);
      continue;
    }
    TAG.lastIndex = at;
    const m = TAG.exec(html);
    if (m) return { at, end: m[1] === "/", name: m[2]!.toLowerCase() };
    at++;
  }
  return undefined;
}

/** Past the comment that starts at `at`: after its `-->`, or the end of `html`. */
function past(html: string, at: number): number {
  const end = html.indexOf("-->", at + 4);
  return end < 0 ? html.length : end + 3;
}

/** Where the tag that starts at `at` ends: past its `>`, read with its quoted values respected; the end of `html` if it never does. */
function tagEnd(html: string, at: number): number {
  let quote = "";
  for (let i = at; i < html.length; i++) {
    const c = html[i]!;
    if (quote) {
      if (c === quote) quote = "";
    } else if (c === '"' || c === "'") quote = c;
    else if (c === ">") return i + 1;
  }
  return html.length;
}

/**
 * Where the element named `name`, whose start tag ends at `from`, ends: where its end tag starts;
 * or, left open, where the end tag of what holds it starts, as a browser ends it there; or the end
 * of `html`. What opens inside it is counted in and out, a void element never; a comment, and what
 * a tag quotes, are passed over.
 */
function closing(html: string, from: number, name: string): number {
  const open: string[] = [];
  for (let t = nextTag(html, from); t; t = nextTag(html, tagEnd(html, t.at))) {
    if (!t.end) {
      if (!VOID.has(t.name)) open.push(t.name);
    } else if (open.includes(t.name)) open.length = open.lastIndexOf(t.name); // it, and what it holds that was left open
    else return t.at; // its own end, or the end of what holds it
  }
  return html.length;
}


type Node = { key: string | null; html: string; skeleton: string; children: string[] };
/** A drawn page: its HTML, and its parts as a tree (the page itself is the node keyed `null`). */
export type Drawn = { html: string; nodes: Map<string | null, Node> };

const placeholder = (key: string): string => `<!--part:${key}-->`;

/** Draws a page, recording the parts it names, and lays them out as a tree. */
export function drawParts(draw: () => string): Drawn {
  const recorded: Recorded[] = [];
  recordings.push(recorded);
  let html: string;
  try {
    html = draw();
  } finally {
    recordings.pop();
  }
  return layout(html, recorded);
}

function layout(page: string, recorded: Recorded[]): Drawn {
  // A part counts if it is on the page, once. A key drawn twice the same (a view that draws a thing
  // twice and uses it once) is one part; a key standing for two different things is no part: what
  // holds it is sent instead.
  const byKey = new Map<string, Map<string, Recorded>>();
  for (const r of recorded) if (page.includes(r.html)) byKey.set(r.key, (byKey.get(r.key) ?? new Map()).set(r.html, r));
  const parts = [...byKey.values()].filter((rs) => rs.size === 1 && page.split([...rs.keys()][0]!).length === 2).map((rs) => [...rs.values()][0]!);

  // Each part's parent is the smallest other part that holds it; the page holds the rest.
  const parentOf = new Map<string, string | null>();
  for (const p of parts) {
    const holders = parts.filter((q) => q !== p && q.html.length > p.html.length && q.html.includes(p.html));
    holders.sort((a, b) => a.html.length - b.html.length);
    parentOf.set(p.key, holders[0]?.key ?? null);
  }

  const nodes = new Map<string | null, Node>();
  const make = (key: string | null, html: string): void => {
    const children = parts.filter((p) => parentOf.get(p.key) === key).sort((a, b) => html.indexOf(a.html) - html.indexOf(b.html));
    let skeleton = html;
    for (const c of children) skeleton = skeleton.replace(c.html, placeholder(c.key));
    nodes.set(key, { key, html, skeleton, children: children.map((c) => c.key) });
  };
  make(null, page);
  for (const p of parts) make(p.key, p.html);
  return { html: page, nodes };
}

const target = (key: string): string => `[data-eta-part="${key.replaceAll('"', '\\"')}"]`;

/**
 * What to send to bring a page drawn as `prev` to `next`: HTML ops, `[]` when nothing on it
 * changed, or undefined when the page's own outline changed and it must go whole. An applet that
 * watches a document (`data-doc`) holds it in its props, and every change to it reaches the page
 * as a patch (the stories check they do, `unheld` in src/harness.ts), which the applet draws from.
 * So the document, and what is drawn inside the mount, are not compared (`comparable`), and a
 * change to them alone sends nothing; they go only with the mount itself, when a part that holds
 * it is replaced or its own tag changes -- its small props, a class -- as the render drew them.
 * What follows where a person is belongs off the mount where it can, so its tag does not change.
 */
export function diff(prev: Drawn, next: Drawn): HtmlOp[] | undefined {
  const ops: HtmlOp[] = [];
  return settle(null, prev, next, ops, comparable) ? ops : undefined;
}

/**
 * Brings the node `key` up to date through ops on it and what is inside it; false when it cannot,
 * and must be replaced whole. A part whose own tag changed and not what is inside it (a class, an
 * `inert`, the page's address) is sent its tag alone.
 */
function settle(key: string | null, prev: Drawn, next: Drawn, ops: HtmlOp[], seen: (html: string) => string): boolean {
  const p = prev.nodes.get(key);
  const n = next.nodes.get(key);
  if (!p || !n) return false;
  const [pTag, pInside] = (key === null ? ["", p.skeleton] : splitTag(p.skeleton)).map(seen) as [string, string];
  const [nTag, nInside] = (key === null ? ["", n.skeleton] : splitTag(n.skeleton)).map(seen) as [string, string];
  const tag: HtmlOp | undefined = pTag !== nTag ? { op: "tag", target: target(key!), html: splitTag(n.html)[0] } : undefined;
  if (key !== null && watches(splitTag(p.skeleton)[0]) && watches(splitTag(n.skeleton)[0])) {
    if (tag) ops.push(tag); // a mount that watches a document, drawn again: what is inside it is the applet's
    return true;
  }

  if (pInside !== nInside) {
    if (!isList(pInside) || !isList(nInside) || pInside.replace(RUN, "") !== nInside.replace(RUN, "")) return false;
    if (tag) ops.push(tag);
    // A list: the same outline around a run of rows. Rows gone are taken out (`goneFrom`); rows
    // kept keep their order and are settled in turn; new rows go in after the row before them, or
    // before the row after them. A list that was empty has neither, and is replaced.
    const kept = n.children.filter((c) => p.children.includes(c));
    if (kept.join("\n") !== p.children.filter((c) => n.children.includes(c)).join("\n")) return false;
    if (kept.length === 0 && n.children.length > 0) return false;
    for (const gone of p.children.filter((c) => !n.children.includes(c))) ops.push({ op: "remove", target: goneFrom(key, gone, next) });
    n.children.forEach((c, i) => {
      if (p.children.includes(c)) return settleChild(c, prev, next, ops, seen);
      const html = next.nodes.get(c)!.html;
      if (i > 0) ops.push({ op: "after", target: target(n.children[i - 1]!), html });
      else ops.push({ op: "before", target: target(n.children.find((k) => p.children.includes(k))!), html });
    });
    return true;
  }
  if (tag) ops.push(tag);
  for (const c of n.children) settleChild(c, prev, next, ops, seen);
  return true;
}

/** An element's opening tag, and the rest: read with its quoted attribute values respected. */
export function splitTag(html: string): [string, string] {
  const end = tagEnd(html, Math.max(html.indexOf("<"), 0));
  return [html.slice(0, end), html.slice(end)];
}

function settleChild(key: string, prev: Drawn, next: Drawn, ops: HtmlOp[], seen: (html: string) => string): void {
  if (!settle(key, prev, next, ops, seen)) ops.push({ op: "replace", target: target(key), html: next.nodes.get(key)!.html });
}

/**
 * A row taken out of the list `key`: by its own key when the next page has no element that carries
 * it, and otherwise as the one inside `key`. A row that moved to another part -- or that the next
 * page draws twice, and so is no part -- may already have been put in there, in a part drawn before
 * this one, and its key alone names the first on the page: the copy just put in. Inside `key` it
 * can only be the row that left, since nothing goes into a list before its rows come out; and the
 * page's own rows come out before anything goes in, so they are named by their key alone.
 */
function goneFrom(key: string | null, row: string, next: Drawn): string {
  return key !== null && next.html.includes(carries(row)) ? `${target(key)} ${target(row)}` : target(row);
}

const RUN = /(?:<!--part:[^>]*-->)+/g;

/** An inside whose child parts sit in one unbroken run: a list. */
const isList = (inside: string): boolean => (inside.match(RUN) ?? []).length <= 1;

/**
 * What the fields on a page that write `path` of `doc` (their `data-write`) are drawn with, as a
 * browser reads them: an input's `value`, a textarea's text, less the newline a browser drops after
 * its start tag. What a write's `test` is held against (todo n4).
 */
export function drawnValues(page: string, doc: string, path: string): string[] {
  const values: string[] = [];
  let text: string | undefined;
  new HTMLRewriter()
    .on("input[data-write], textarea[data-write]", {
      element(el) {
        const spec = JSON.parse(decoded(el.getAttribute("data-write")!)) as { doc?: string; path?: string };
        if (spec.doc !== doc || spec.path !== path) return;
        if (el.tagName === "input") return void values.push(decoded(el.getAttribute("value") ?? ""));
        text = "";
        el.onEndTag(() => {
          values.push(decoded(text!).replace(/^\r?\n/, ""));
          text = undefined;
        });
      },
      text(chunk) {
        if (text !== undefined) text += chunk.text;
      },
    })
    .transform(page);
  return values;
}
