import type { HtmlOp } from "./compartments/render";

// A page is drawn whole on the server and sent in parts. A render names the regions of its page
// with `part(key, html)`; the kernel keeps, per connection, the parts it last sent, and after a
// write draws the page again and sends only what differs: a part replaced, a row added or taken
// out of a list. The whole page goes only when its own outline changed -- a different page. Which
// parts a render names is the only thing it says about delivery; what to send is worked out.

type Recorded = { key: string; html: string };
const recordings: Recorded[][] = [];

/** Names a region of the page: its root element is tagged `data-eta-part="<key>"`, and it is sent on its own when it alone changed. A key is unique on its page. */
export function part(key: string, html: string): string {
  const tagged = html.replace(/^(\s*<[a-zA-Z][\w-]*)/, `$1 data-eta-part="${key.replaceAll('"', "&quot;")}"`);
  recordings.at(-1)?.push({ key, html: tagged });
  return tagged;
}

/** A page with the props of every applet that takes its document's patches (`data-doc`) left out: how the stories compare a page, since props follow the patches between renders. */
export const comparable = (html: string): string => html.replace(/<[^>]*\sdata-doc="[^"]*"[^>]*>/g, (tag) => tag.replace(/\sdata-props="[^"]*"/, ""));


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

/** A part inside the part `key` (or, for `null`, the page). */
const within = (key: string | null, inner: string): string => (key === null ? target(inner) : `${target(key)} ${target(inner)}`);

/**
 * What to send to bring a page drawn as `prev` to `next`: HTML ops, `[]` when nothing on it
 * changed, or undefined when the page's own outline changed and it must go whole. An applet that
 * takes its document's patches (`data-doc`) is never sent its props again: its props are that
 * document, whose every change reaches the page as a patch (the stories check they are, `unheld`
 * in src/harness.ts). So they are not compared.
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

  if (pInside !== nInside) {
    if (!isList(pInside) || !isList(nInside) || pInside.replace(RUN, "") !== nInside.replace(RUN, "")) return false;
    if (tag) ops.push(tag);
    // A list: the same outline around a run of rows. Rows gone are taken out -- a row that moved to
    // another part, from this one, since a part drawn before this one may hold it already; rows
    // kept keep their order and are settled in turn; new rows go in after the row before them, or
    // before the row after them. A list that was empty has neither, and is replaced.
    const kept = n.children.filter((c) => p.children.includes(c));
    if (kept.join("\n") !== p.children.filter((c) => n.children.includes(c)).join("\n")) return false;
    if (kept.length === 0 && n.children.length > 0) return false;
    for (const gone of p.children.filter((c) => !n.children.includes(c))) ops.push({ op: "remove", target: next.nodes.has(gone) ? within(key, gone) : target(gone) });
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
  let quote = "";
  for (let i = html.indexOf("<"); i < html.length; i++) {
    const c = html[i]!;
    if (quote) {
      if (c === quote) quote = "";
    } else if (c === '"' || c === "'") quote = c;
    else if (c === ">") return [html.slice(0, i + 1), html.slice(i + 1)];
  }
  return [html, ""];
}

function settleChild(key: string, prev: Drawn, next: Drawn, ops: HtmlOp[], seen: (html: string) => string): void {
  if (!settle(key, prev, next, ops, seen)) ops.push({ op: "replace", target: target(key), html: next.nodes.get(key)!.html });
}

const RUN = /(?:<!--part:[^>]*-->)+/g;

/** An inside whose child parts sit in one unbroken run: a list. */
const isList = (inside: string): boolean => (inside.match(RUN) ?? []).length <= 1;
