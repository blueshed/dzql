// The heart page's script (heart.html): three columns -- stories, documents, entities -- for one
// example, from the facts heart.ts reads (bundled into the page by page.ts). Click any item and it
// is the subject; what goes with it lights in the other two. Every mark has an ⓘ: a popover with
// the reason, which grows into a view of the evidence. Nothing here rewrites the model.

import type { Heart } from "./heart";
import { BOX, layout } from "../examples/modeling/heart";

const H: Heart = JSON.parse(document.getElementById("data")!.textContent!);
type Story = Heart["stories"][number];
type Doc = Heart["documents"][number];
type Ent = Heart["entities"][number];
type Sel = { k: "story"; id: number } | { k: "doc"; id: string } | { k: "ent"; id: string };
type Mark = { kind: "red"; ent: string } | { kind: "cost"; doc: string } | { kind: "unasked"; story: number; doc: string };

let sel: Sel = { k: "doc", id: H.documents[0]?.name ?? "" };
let hideStories = false;
let hideEnts = false;
let pop: Mark | null = null;
let grown: Mark | null = null;

const story = (n: number) => H.stories.find((s) => s.n === n)!;
const doc = (name: string) => H.documents.find((d) => d.name === name)!;
const ent = (name: string) => H.entities.find((e) => e.name === name)!;
const esc = (s: unknown) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const title = (name: string) => name.charAt(0).toUpperCase() + name.slice(1);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const list = (xs: string[]) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);
const bytes = (b: number) => (b < 1024 ? `${b} B` : `${(b / 1024).toFixed(1)} kB`);
const unaskedOf = (s: Story, d: string) => s.unasked.find((u) => u.doc === d);
const keyOf = (m: Mark) => (m.kind === "red" ? `red:${m.ent}` : m.kind === "cost" ? `cost:${m.doc}` : `unasked:${m.story}:${m.doc}`);

const SVG = (body: string, size = 18) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
const EYE = SVG('<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"></path><circle cx="12" cy="12" r="3"></circle>');
const EYE_OFF = SVG('<path d="M3 3l18 18"></path><path d="M10.6 10.6a2 2 0 0 0 2.8 2.8"></path><path d="M9.4 5.2A9.8 9.8 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4.2M6.6 6.6C3.8 8.5 2 12 2 12s3.5 7 10 7a9.6 9.6 0 0 0 5.4-1.6"></path>');
const INFO = SVG('<circle cx="12" cy="12" r="9"></circle><path d="M12 11v5"></path><path d="M12 7.5v.5"></path>');
const GROW = SVG('<path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"></path>', 16);
const CLOSE = SVG('<path d="M18 6 6 18M6 6l12 12"></path>', 16);
const BACK = SVG('<path d="M19 12H5M12 19l-7-7 7-7"></path>', 16);

/** What goes with the subject in the other two columns, and what was told and not asked for. */
function related() {
  if (sel.k === "doc") {
    const id = sel.id;
    return {
      stories: new Set(H.stories.filter((s) => s.born.includes(id)).map((s) => s.n)),
      docs: new Set([id]),
      ents: new Set(doc(id).reach),
      unaskedStories: new Set(H.stories.filter((s) => unaskedOf(s, id)).map((s) => s.n)),
      unaskedDocs: new Set<string>(),
    };
  }
  if (sel.k === "ent") {
    const id = sel.id;
    return {
      stories: new Set(H.stories.filter((s) => s.touches.includes(id)).map((s) => s.n)),
      docs: new Set(H.documents.filter((d) => d.reach.includes(id)).map((d) => d.name)),
      ents: new Set([id]),
      unaskedStories: new Set<number>(),
      unaskedDocs: new Set<string>(),
    };
  }
  const s = story(sel.id);
  return { stories: new Set([s.n]), docs: new Set(s.born), ents: new Set(s.touches), unaskedStories: new Set<number>(), unaskedDocs: new Set(s.unasked.map((u) => u.doc)) };
}

const isSel = (k: Sel["k"], id: string | number) => sel.k === k && sel.id === id;
const infoButton = (m: Mark, label: string, red = false) => `<button class="icon info${red ? " red" : ""}" data-mark="${esc(keyOf(m))}" data-key="${esc(keyOf(m))}" aria-label="${esc(label)}" title="${esc(label)}" aria-expanded="${pop && keyOf(pop) === keyOf(m)}">${INFO}</button>`;
const eye = (which: string, hidden: boolean, hide: string, show: string) =>
  `<button class="icon eye" data-act="${which}" data-key="${which}" aria-pressed="${hidden}" aria-label="${esc(hidden ? show : hide)}" title="${esc(hidden ? show : hide)}">${hidden ? EYE_OFF : EYE}</button>`;

function render() {
  const focused = (document.activeElement as HTMLElement | null)?.dataset.key;
  const r = related();
  const subject = sel.k === "doc" ? title(sel.id) : sel.k === "ent" ? sel.id : `story ${sel.id}`;

  // ── Stories ──
  const storiesHead =
    sel.k === "doc" ? `${r.stories.size} it was born from${r.unaskedStories.size ? ` · ${r.unaskedStories.size} tell it unasked` : ""}` : sel.k === "ent" ? `${r.stories.size} touch ${subject}` : subject;
  const shown = H.stories.filter((s) => !hideStories || r.stories.has(s.n) || r.unaskedStories.has(s.n));
  document.getElementById("stories")!.innerHTML = `
    <div class="head"><h2 id="stories-head">Stories · ${esc(storiesHead)}</h2>${eye("stories", hideStories, "Hide the stories that don't go with it", "Show every story")}</div>
    <ol class="stories">${shown
      .map((s) => {
        const on = r.stories.has(s.n);
        const unasked = r.unaskedStories.has(s.n);
        const cls = ["story", on && "on", unasked && "unasked", isSel("story", s.n) && "me"].filter(Boolean).join(" ");
        const tag = (unasked ? `<span class="tag">tells it, not asked · </span>` : "") + (s.kind === "cannot" ? `<span class="cannot">cannot · </span>` : "") + (s.post ? `<span class="tag">posts to ${esc(s.post)} · </span>` : "");
        const why = unasked && sel.k === "doc" ? infoButton({ kind: "unasked", story: s.n, doc: sel.id }, `Why is story ${s.n} marked?`) : "";
        return `<li><button class="${cls}" data-pick="story:${s.n}" data-key="story:${s.n}" aria-pressed="${isSel("story", s.n)}">${tag}${esc(s.name)}</button>${why}</li>`;
      })
      .join("")}</ol>`;

  // ── Documents ──
  const docsHead =
    sel.k === "doc" ? subject : sel.k === "ent" ? `${r.docs.size} reach ${subject}` : `${r.docs.size} it was born into${r.unaskedDocs.size ? ` · ${r.unaskedDocs.size} told unasked` : ""}`;
  document.getElementById("documents")!.innerHTML = `
    <div class="head"><h2 id="documents-head">Documents · ${esc(docsHead)}</h2></div>
    <div class="docs">${H.documents.map((d) => docCard(d, r)).join("")}</div>`;

  // ── Entities ──
  const visible = hideEnts ? new Set(H.entities.filter((e) => r.ents.has(e.name)).map((e) => e.name)) : undefined;
  const { pos, segs, width, height } = layout(H.entities, visible, document.getElementById("entities")!.clientWidth);
  const reached = H.entities.filter((e) => r.ents.has(e.name)).length;
  const entsHead = sel.k === "doc" ? `${reached} of ${H.entities.length} reached` : sel.k === "ent" ? subject : `${reached} it touches`;
  const nodes = Object.entries(pos)
    .map(([name, p]) => {
      const e = ent(name);
      const cls = ["ent", r.ents.has(name) && "on", e.red && "red", e.looked && "looked", isSel("ent", name) && "me"].filter(Boolean).join(" ");
      const why = e.red || e.looked ? infoButton({ kind: "red", ent: name }, e.red ? `Why is ${name} marked?` : `Who looks ${name} up?`, e.red) : "";
      return `<div class="node" style="left:${p.x}px;top:${p.y}px"><button class="${cls}" data-pick="ent:${esc(name)}" data-key="ent:${esc(name)}" aria-pressed="${isSel("ent", name)}" title="${esc(e.columns.join(" · "))}"><span class="name">${esc(name)}</span><span class="sub">${esc(e.columns.join(" · "))}</span></button>${why}</div>`;
    })
    .join("");
  document.getElementById("entities")!.innerHTML = `
    <div class="head"><h2 id="entities-head">Entities · ${esc(entsHead)}</h2>${eye("ents", hideEnts, "Show only the entities that go with it", "Show every entity")}</div>
    ${
      nodes
        ? `<div class="erd-wrap"><div class="erd" style="width:${width}px;height:${height}px">${segs.map((g) => `<div class="seg" style="left:${g.left}px;top:${g.top}px;width:${g.width}px;height:${g.height}px"></div>`).join("")}${nodes}</div></div>`
        : `<p class="empty">No entity goes with ${esc(subject)}.</p>`
    }
    <div class="legend">
      <span><i style="background:var(--go-bg);border:2px solid var(--ink)"></i>what you clicked</span>
      <span><i style="background:var(--go-bg);border:2px solid var(--go)"></i>goes with it</span>
      <span><i style="background:var(--red-bg);border:1px solid var(--red-line)"></i>reached by no document</span>
      <span><i style="background:var(--card);border:1px dashed var(--go)"></i>looked up, never held</span>
      <span><i style="background:var(--card);border:2px dashed var(--amber)"></i>told, not asked for</span>
      <span><i style="background:var(--amber-bg);border:2px solid var(--amber)"></i>a cost to look at</span>
    </div>`;

  renderPop();
  renderGrown();
  document.querySelector("main")!.inert = !!grown; // the grown view is modal: the page behind it is out of reach
  const again = focused && document.querySelector<HTMLElement>(`[data-key="${CSS.escape(focused)}"]`);
  if (again && !grown) again.focus();
}

function docCard(d: Doc, r: ReturnType<typeof related>) {
  const me = isSel("doc", d.name);
  const on = r.docs.has(d.name);
  const unasked = r.unaskedDocs.has(d.name);
  const warn = d.squared && !d.squared.asked; // sharing, as the stories ask, is no warning
  const cls = ["doc", on && !me && "on", me && "me", unasked && "unasked", warn && "warn", sel.k !== "doc" && !on && !unasked && "dim"].filter(Boolean).join(" ");
  const cost = warn ? infoButton({ kind: "cost", doc: d.name }, `Why is ${title(d.name)}'s cost marked?`) : "";
  const u = sel.k === "story" && unasked ? unaskedOf(story(sel.id), d.name)! : null;
  const told = u
    ? `<div class="doc-unasked"><span>told, not asked for · ${esc(list(u.told.map((t) => t.member)))}</span>${infoButton({ kind: "unasked", story: (sel as { id: number }).id, doc: d.name }, `Why is ${title(d.name)} marked?`)}</div>`
    : "";
  const more = me
    ? `<div class="doc-more"><div class="shape">${d.shape.map((l) => `<div style="padding-left:${l.pad}px">${esc(l.text)}</div>`).join("")}</div><div class="cost${warn ? " warn" : ""}">${esc(costLine(d))}</div></div>`
    : "";
  return `<div class="${cls}"><div class="doc-top"><button class="doc-pick" data-pick="doc:${esc(d.name)}" data-key="doc:${esc(d.name)}" aria-pressed="${me}"><span class="doc-name">${esc(title(d.name))}</span><span class="doc-for">${esc(d.for)}</span></button>${cost}</div>${told}${more}</div>`;
}

function costLine(d: Doc) {
  if (d.squared?.asked) return `held by ${d.held} · every holder told of every write, as the stories ask: holders²`;
  if (d.squared) return "a holder's write tells every holder, some unasked: grows as holders²";
  if (!d.told) return `held by ${d.held}`;
  return `held by ${d.held} · told ${plural(d.told.count, "time")} in the run, ${bytes(d.told.bytes)}`;
}

// ── The popover: the reason, in a line or two ──

function reason(m: Mark): { title: string; one: string; two: string; red: boolean } {
  if (m.kind === "red") {
    const e = ent(m.ent);
    const readers = e.code.filter((c) => !c.seed).map((c) => (c.by ? `${c.by}() in ${c.at.split(":")[0]}` : c.at));
    const touching = H.stories.filter((s) => s.touches.includes(e.name)).length;
    return {
      title: `${e.name} · ${e.red ? "reached by no document" : "looked up, never held"}`,
      one: readers.length ? `Read by ${list(readers)}; no document holds it.` : "No code but the seed names it, and no document holds it.",
      two: touching ? `${plural(touching, "story touches", "stories touch")} it.` : "No story touches it.",
      red: e.red,
    };
  }
  if (m.kind === "cost") {
    const d = doc(m.doc);
    const g = d.squared!;
    return {
      title: `${title(d.name)} · grows as holders²`,
      one: `In story ${g.story}, ${g.author}'s write was told to every holder: ${list(g.told.map((t) => t.member))}.`,
      two: "40 holders writing once: 1,600 told.",
      red: false,
    };
  }
  const u = unaskedOf(story(m.story), m.doc)!;
  const who = u.told.map((t) => t.member);
  return {
    title: `${title(m.doc)} · told, not asked for`,
    one: `In story ${m.story}, ${list(who)} ${who.length === 1 ? "was" : "were"} told of it, and the story's seen does not name ${who.length === 1 ? "them" : "any of them"}.`,
    two: `${bytes(u.told.reduce((a, t) => a + t.bytes, 0))} sent in the run.`,
    red: false,
  };
}

function renderPop() {
  const host = document.getElementById("pop")!;
  const anchor = pop && document.querySelector<HTMLElement>(`[data-mark="${CSS.escape(keyOf(pop))}"]`);
  if (!pop || !anchor) {
    host.innerHTML = "";
    return;
  }
  const why = reason(pop);
  const at = anchor.getBoundingClientRect();
  const left = Math.max(8, Math.min(at.right - 340, document.documentElement.clientWidth - 348));
  host.innerHTML = `<div class="pop${why.red ? " red" : ""}" role="dialog" aria-labelledby="pop-title" style="left:${left}px;top:${at.bottom + 6}px">
    <h3 id="pop-title">${esc(why.title)}</h3><p>${esc(why.one)}</p><p class="second">${esc(why.two)}</p>
    <div class="acts"><button class="icon" data-act="grow" data-key="grow" aria-label="Grow" title="Grow">${GROW}</button><button class="icon" data-act="close" data-key="close" aria-label="Close" title="Close">${CLOSE}</button></div>
  </div>`;
}

// ── Grown: the evidence, over the page ──

function renderGrown() {
  const host = document.getElementById("grown")!;
  if (!grown) {
    host.innerHTML = "";
    return;
  }
  const why = reason(grown);
  const status = why.title.split(" · ")[1]!;
  host.innerHTML = `<div class="grown" role="dialog" aria-modal="true" aria-labelledby="grown-title">
    <div class="grown-head"><button class="icon" data-act="back" data-key="back" aria-label="Back to the documents" title="Back to the documents">${BACK}</button>
      <h1 id="grown-title">${esc(why.title.split(" · ")[0]!)}</h1><div class="status${why.red ? " red" : ""}">${esc(status)}</div></div>
    <div class="three">${evidence(grown)}</div>
  </div>`;
}

const column = (head: string, body: string) => `<div><h2>${esc(head)}</h2>${body}</div>`;
const p = (text: string, second = false) => `<p${second ? ' class="second"' : ""}>${esc(text)}</p>`;
const where = (text: string) => `<div class="where">${esc(text)}</div>`;
const shapeBox = (lines: { text: string; pad: number }[]) => `<div class="box">${lines.map((l) => `<div style="padding-left:${l.pad}px">${esc(l.text)}</div>`).join("")}</div>`;
const opLine = (o: { op: string; path: string; value?: unknown }) => {
  const v = "value" in o ? JSON.stringify(o.value) : "";
  return `${o.op} ${o.path}${v ? ` ${v.length > 90 ? `${v.slice(0, 90)}…` : v}` : ""}`;
};

function evidence(m: Mark): string {
  if (m.kind === "red") {
    const e = ent(m.ent);
    const readers = e.code.filter((c) => !c.seed);
    const seed = e.code.filter((c) => c.seed);
    const touching = H.stories.filter((s) => s.touches.includes(e.name));
    return [
      column("What it holds", shapeBox([{ text: `${e.name}${e.parent ? ` · under ${e.parent}` : ""}`, pad: 0 }, ...e.columns.map((c) => ({ text: c, pad: 16 }))]) + (seed.length ? p(`${plural(seed.length, "line")} of the seed make${seed.length === 1 ? "s" : ""} its rows: ${seed.map((c) => c.at).join(", ")}.`) : "")),
      column(
        "Who reads it",
        (readers.length ? readers.map((c) => (c.by ? p(`${c.by}()`) : "") + where(c.at) + `<div class="box">${esc(c.line)}</div>`).join("") : p("No code outside delta.ts and the seed names it.")) +
          p("No document holds it, so nobody is told when it changes.", true),
      ),
      column("The stories", touching.length ? touching.map((s) => p(`${s.n}. ${s.name}`)).join("") : p(`None of the ${H.stories.length} touches it.`)),
    ].join("");
  }
  if (m.kind === "cost") {
    const d = doc(m.doc);
    const g = d.squared!;
    return [
      column("What it holds", shapeBox(d.shape) + p(`Held by ${d.for}.`)),
      column(
        "Who holds it, who is told",
        p(`Story ${g.story}: ${story(g.story).name}.`) +
          p(`${g.author} holds it, and their write was told to every holder:`) +
          g.told.map((t) => where(`${t.member} · ${t.how} · ${bytes(t.bytes)}`)).join("") +
          p("So every holder's write is told to every holder.", true),
      ),
      column(
        "How it grows · each holder writes once",
        [10, 40, 100].map((n) => `<div class="scale"><span>${n} holders</span><b${n >= 40 ? ' class="warn"' : ""}>${(n * n).toLocaleString("en-GB")} told</b></div>`).join(""),
      ),
    ].join("");
  }
  const s = story(m.story);
  const u = unaskedOf(s, m.doc)!;
  const patches = Map.groupBy(u.told, (t) => JSON.stringify(t.patch));
  return [
    column("The story", p(`${s.n}. ${s.name}`) + p(`${s.as} ${s.kind === "closesTab" ? "closes a tab" : s.post ? `posts to ${s.post}` : "writes"}; seen by ${s.seen.length ? list(s.seen) : "nobody"}.`, true)),
    column("Who was told", u.told.map((t) => p(`${t.member}`) + where(`${t.how} · ${bytes(t.bytes)}`)).join("")),
    column(
      "The patch",
      [...patches.values()].map((to) => where(`to ${list(to.map((t) => t.member))}`) + `<div class="box">${to[0]!.patch.length ? to[0]!.patch.map((o) => `<div>${esc(opLine(o))}</div>`).join("") : '<div class="faint">no patch: the page alone</div>'}</div>`).join(""),
    ),
  ].join("");
}

// ── What a click does ──

function markOf(key: string): Mark {
  const [kind, a, b] = key.split(":") as [string, string, string];
  return kind === "red" ? { kind, ent: a } : kind === "cost" ? { kind, doc: a } : { kind: "unasked", story: Number(a), doc: b };
}

function focusKey(key: string) {
  document.querySelector<HTMLElement>(`[data-key="${CSS.escape(key)}"]`)?.focus();
}

document.addEventListener("click", (e) => {
  const t = (e.target as HTMLElement).closest<HTMLElement>("[data-pick],[data-mark],[data-act]");
  if (!t) return;
  if (t.dataset.pick) {
    const [k, id] = t.dataset.pick.split(/:(.*)/) as [Sel["k"], string];
    sel = k === "story" ? { k, id: Number(id) } : { k, id };
    pop = null;
    render();
  } else if (t.dataset.mark) {
    const m = markOf(t.dataset.mark);
    pop = pop && keyOf(pop) === keyOf(m) ? null : m;
    render();
    if (pop) focusKey("grow");
  } else {
    const act = t.dataset.act;
    if (act === "stories") hideStories = !hideStories;
    if (act === "ents") hideEnts = !hideEnts;
    const from = pop ?? grown;
    if (act === "close") pop = null;
    if (act === "grow") [grown, pop] = [pop, null];
    if (act === "back") grown = null;
    render();
    if (act === "grow") focusKey("back");
    if ((act === "close" || act === "back") && from) focusKey(keyOf(from));
  }
});

document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape" || !(grown || pop)) return;
  const from = grown ?? pop!;
  if (grown) grown = null;
  else pop = null;
  render();
  focusKey(keyOf(from));
});

// the popover is placed by its mark: it follows a column's scroll, and the page's
document.addEventListener("scroll", () => pop && renderPop(), { capture: true, passive: true });
addEventListener("resize", () => {
  render();
  renderPop();
});

document.title = `${title(H.example)} · the modeller`;
document.getElementById("title")!.textContent = title(H.example);
document.getElementById("alone")!.hidden = H.ran;
render();
