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

/** A page as it compares: an applet that takes its document's patches (`data-doc`) is compared without its props, which follow the patches, not the renders. */
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
    nodes.set(key, { key, html, skeleton: comparable(skeleton), children: children.map((c) => c.key) });
  };
  make(null, page);
  for (const p of parts) make(p.key, p.html);
  return { html: page, nodes };
}

const target = (key: string): string => `[data-eta-part="${key.replaceAll('"', '\\"')}"]`;

/**
 * What to send to bring a page drawn as `prev` to `next`: HTML ops, `[]` when nothing on it
 * changed, or undefined when the page's own outline changed and it must go whole.
 */
export function diff(prev: Drawn, next: Drawn): HtmlOp[] | undefined {
  const ops: HtmlOp[] = [];
  return settle(null, prev, next, ops) ? ops : undefined;
}

/** Brings the node `key` up to date through ops on what is inside it; false when it cannot, and must be replaced whole. */
function settle(key: string | null, prev: Drawn, next: Drawn, ops: HtmlOp[]): boolean {
  const p = prev.nodes.get(key);
  const n = next.nodes.get(key);
  if (!p || !n) return false;

  if (p.skeleton !== n.skeleton) {
    if (!isList(p) || !isList(n) || stripped(p) !== stripped(n)) return false;
    // A list: the same outline around a run of rows. Rows gone are taken out; rows kept keep their
    // order and are settled in turn; new rows go in after the row before them, or before the row
    // after them. A list that was empty has neither, and is replaced.
    const kept = n.children.filter((c) => p.children.includes(c));
    if (kept.join("\n") !== p.children.filter((c) => n.children.includes(c)).join("\n")) return false;
    if (kept.length === 0 && n.children.length > 0) return false;
    for (const gone of p.children.filter((c) => !n.children.includes(c))) ops.push({ op: "remove", target: target(gone) });
    n.children.forEach((c, i) => {
      if (p.children.includes(c)) return settleChild(c, prev, next, ops);
      const html = next.nodes.get(c)!.html;
      if (i > 0) ops.push({ op: "after", target: target(n.children[i - 1]!), html });
      else ops.push({ op: "before", target: target(n.children.find((k) => p.children.includes(k))!), html });
    });
    return true;
  }
  for (const c of n.children) settleChild(c, prev, next, ops);
  return true;
}

function settleChild(key: string, prev: Drawn, next: Drawn, ops: HtmlOp[]): void {
  if (!settle(key, prev, next, ops)) ops.push({ op: "replace", target: target(key), html: next.nodes.get(key)!.html });
}

const RUN = /(?:<!--part:[^>]*-->)+/g;

/** A node whose child parts sit in one unbroken run: a list. */
const isList = (node: Node): boolean => (node.skeleton.match(RUN) ?? []).length <= 1;
const stripped = (node: Node): string => node.skeleton.replace(RUN, "");
