// The heart of a model: its stories, its documents and its entities, and what goes with what --
// drawn from the model document as it is
// kept, not from a run of an app's code. Pure: the server draws the first paint with it, and the
// heart applet (applets/heart-applet.ts) draws every one after, as the model's patches come.
//
//   born into   a story is born into each document that says it serves it.
//   touches     the entities a story says it touches.
//   reaches     a document reaches its root and each entity it holds; its shape is that tree,
//               each held entity under the one it hangs from.
//   entities    worked out, never kept: each a document holds, with every field any document gives
//               it and the first parent any gives it; and each a story touches that no document
//               holds -- looked up, never held.
//   gaps        a story no document serves; a document that serves no story still told; an entity
//               only such documents hold: needed by no story.

import { esc } from "dzql/rendering/html";
import { byId, readingOf, shapeOf, type Requires, type StoryWrite } from "dzql/modelling/reading";

export type Field = { name: string; type: string };
export type { Requires, StoryWrite }; // reading's, the one statement of them
export type Held = { parent: string | null; fields: Field[] };

/** The model document as delta keeps it: its stories and its documents, each a row by its id. */
export type Raw = {
  models: { name: string };
  stories?: Record<string, { id: string | number; text: string; actor: string; kind: string; post?: string | null; touches?: string[]; writes?: StoryWrite[] | null; requires?: Requires[] | null }>;
  documents?: Record<string, { id: string | number; name: string; root: string; own?: number | boolean; list?: number | boolean; holds?: Record<string, Held>; held_by?: string[]; stories?: (string | number)[] }>;
};

/** A word's one: requests, request; people, person (as the modeller says a document's id). */
export function singular(word: string): string {
  if (word === "people") return "person";
  if (/(ss|us|series|news)$/.test(word)) return word;
  if (/ies$/.test(word)) return word.slice(0, -3) + "y";
  if (/s$/.test(word)) return word.slice(0, -1);
  return word;
}

/** A document's shape: its name, then its root and each entity it holds under the one it hangs from, indented; one whose parent it does not hold hangs from the root. */
export const shape = (head: string, root: string, holds: Record<string, Held>): { text: string; pad: number }[] =>
  shapeOf(head, root, Object.keys(holds).filter((e) => e !== root), (e) => holds[e]?.parent ?? null);


/** What a story touches: what it says it touches, and what it writes. */
export const touched = (s: { touches?: string[]; writes?: StoryWrite[] | null }): string[] => [...new Set([...(s.touches ?? []), ...(s.writes ?? []).map((w) => w.entity)])];
/** A write as said: `replace requests.status=approved`. */
export const saidWrite = (w: StoryWrite) => `${w.op} ${w.entity}${w.path ? `.${w.path}` : ""}${w.to !== undefined ? `=${w.to}` : ""}`;

/** The heart's facts, worked out from the model document. */
export function heartOf(raw: Raw) {
  const rows = Object.values(raw.stories ?? {}).sort(byId);
  const docs = Object.values(raw.documents ?? {})
    .sort(byId)
    .map((d) => ({ ...d, holds: d.holds ?? {}, held_by: d.held_by ?? [], serves: (d.stories ?? []).map(String) }));
  const told = new Set(rows.map((s) => String(s.id)));
  const needless = new Set(docs.filter((d) => !d.serves.some((id) => told.has(id))).map((d) => d.name));

  // the entities as the checks, the proof and the guards have them (dzql/modelling/reading)
  const entities = [...readingOf(raw).entities.values()].map((e) => ({ name: e.name, parent: e.parent, columns: [...e.fields.keys()], documents: e.documents }));

  return {
    example: raw.models.name,
    stories: rows.map((s) => ({
      n: Number(s.id),
      name: s.text,
      as: s.actor,
      kind: s.kind,
      post: s.post ?? null,
      born: docs.filter((d) => d.serves.includes(String(s.id))).map((d) => d.name),
      touches: touched(s),
    })),
    documents: docs.map((d) => ({
      name: d.name,
      for: d.held_by.join(", ") || "nobody yet",
      reach: [d.root, ...Object.keys(d.holds).filter((e) => e !== d.root)],
      shape: shape(d.own || d.list ? `${d.name}${d.list ? ":" : ""}` : `${d.name}:<${singular(d.root)}>`, d.root, d.holds),
      held: d.held_by.length,
      needless: needless.has(d.name),
    })),
    entities: entities.map((e) => ({
      ...e,
      red: e.documents.length > 0 && e.documents.every((d) => needless.has(d)),
      looked: e.documents.length === 0,
    })),
  };
}

export type Heart = ReturnType<typeof heartOf>;
type Story = Heart["stories"][number];
type Doc = Heart["documents"][number];

// ───────────────────────────── the entities' tree, laid out ─────────────────────────────

export const BOX = { W: 176, H: 46, COL: 236, ROW: 56, LINE: 14 };
/**
 * How tall a box is to show every column, wrapped as the box wraps them: a line holds about `per`
 * characters of the list (fewer in a box with a mark at its right). One line is the box as it was.
 */
export function boxHeight(columns: string[], per = 23): number {
  let lines = 1, used = 0;
  for (const c of columns) {
    const need = (used ? 3 : 0) + c.length;
    if (used && used + need > per) (lines++, (used = c.length));
    else used += need;
  }
  return BOX.H + (lines - 1) * BOX.LINE;
}
/** The narrowest a column may be: a box and room for its connector's spine. */
export const MIN_COL = BOX.W + 24;

/**
 * The entities as a tree from their parent links:
 * depth left to right, each leaf on a row of its own, a parent level with the middle of its
 * children, each root's tree a little apart from the next. `visible` keeps some: one whose parent is
 * hidden is a root. `fit` is the width it has: a tree deeper than fits takes narrower columns.
 */
export function layout(tables: { name: string; parent: string | null; h?: number }[], visible?: Set<string>, fit = Infinity) {
  const { W, H, ROW } = BOX;
  const hOf = (n: string) => tables.find((t) => t.name === n)?.h ?? H;
  const shown = tables.filter((t) => !visible || visible.has(t.name));
  const on = new Set(shown.map((t) => t.name));
  const depthOf = (n: string, seen = 0): number => {
    const p = tables.find((t) => t.name === n)?.parent;
    return p && on.has(p) && seen < tables.length ? 1 + depthOf(p, seen + 1) : 0;
  };
  const deepest = Math.max(0, ...shown.map((t) => depthOf(t.name)));
  const COL = deepest && W + deepest * BOX.COL > fit ? Math.max(MIN_COL, Math.floor((fit - W) / deepest)) : BOX.COL;
  const kidsOf = (n: string) => shown.filter((t) => t.parent === n && t.name !== n).map((t) => t.name);
  const pos: Record<string, { x: number; y: number }> = {};
  let below = 0; // the next leaf's top: each leaf below the last, as tall as its columns need
  const mid = (n: string) => pos[n]!.y + hOf(n) / 2;
  const place = (n: string, depth: number) => {
    const kids = kidsOf(n);
    if (kids.length === 0) {
      pos[n] = { x: depth * COL, y: below };
      below += hOf(n) + ROW - H;
      return;
    }
    kids.forEach((k) => place(k, depth + 1));
    const ys = kids.map(mid);
    pos[n] = { x: depth * COL, y: (Math.min(...ys) + Math.max(...ys)) / 2 - hOf(n) / 2 };
  };
  for (const t of shown) {
    if (t.parent && on.has(t.parent) && t.parent !== t.name) continue;
    place(t.name, 0);
    below += 0.4 * ROW;
  }
  const segs: { left: number; top: number; width: number; height: number }[] = [];
  for (const [n, p] of Object.entries(pos)) {
    const kids = kidsOf(n);
    if (kids.length === 0) continue;
    const spine = p.x + W + (COL - W) / 2;
    const ys = [...kids.map(mid), mid(n)];
    segs.push({ left: p.x + W, top: mid(n) - 1, width: spine - p.x - W, height: 2 });
    segs.push({ left: spine - 1, top: Math.min(...ys) - 1, width: 2, height: Math.max(...ys) - Math.min(...ys) + 2 });
    for (const k of kids) segs.push({ left: spine, top: mid(k) - 1, width: pos[k]!.x - spine, height: 2 });
  }
  const all = Object.values(pos);
  return { pos, segs, width: Math.max(0, ...all.map((p) => p.x + W)), height: Math.max(0, ...Object.entries(pos).map(([n, p]) => p.y + hOf(n))) };
}

// ───────────────────────────── the drawing ─────────────────────────────

/** What is picked: a story by its number, a document or an entity by its name. */
export type Sel = { k: "story"; id: number } | { k: "doc"; id: string } | { k: "ent"; id: string };
/** A mark with a reason behind it: an entity needed by no story, or looked up and never held. */
export type Mark = { kind: "ent"; ent: string };
/** What a person looking has done to the page: what they picked, what they hid, the reason open. */
export type Ui = { sel?: Sel; hideStories: boolean; hideEnts: boolean; pop: Mark | null };

const title = (name: string) => name.charAt(0).toUpperCase() + name.slice(1);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
export const list = (xs: string[]) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);
export const keyOf = (m: Mark) => `ent:${m.ent}`;

const SVG = (body: string, size = 18) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
const EYE = SVG('<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"></path><circle cx="12" cy="12" r="3"></circle>');
const EYE_OFF = SVG('<path d="M3 3l18 18"></path><path d="M10.6 10.6a2 2 0 0 0 2.8 2.8"></path><path d="M9.4 5.2A9.8 9.8 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4.2M6.6 6.6C3.8 8.5 2 12 2 12s3.5 7 10 7a9.6 9.6 0 0 0 5.4-1.6"></path>');
const INFO = SVG('<circle cx="12" cy="12" r="9"></circle><path d="M12 11v5"></path><path d="M12 7.5v.5"></path>');
export const CLOSE = SVG('<path d="M18 6 6 18M6 6l12 12"></path>', 16);

/** What is picked, or the first document while nothing is, or the first story while there is no document; nothing on an empty model. */
export function picked(h: Heart, sel?: Sel): Sel | undefined {
  const there = sel && (sel.k === "story" ? h.stories.some((s) => s.n === sel.id) : sel.k === "doc" ? h.documents.some((d) => d.name === sel.id) : h.entities.some((e) => e.name === sel.id));
  if (there) return sel;
  if (h.documents[0]) return { k: "doc", id: h.documents[0].name };
  return h.stories[0] && { k: "story", id: h.stories[0].n };
}

/** What goes with the subject in the other two columns. */
export function related(h: Heart, sel: Sel) {
  if (sel.k === "doc") {
    const d = h.documents.find((x) => x.name === sel.id)!;
    return { stories: new Set(h.stories.filter((s) => s.born.includes(sel.id)).map((s) => s.n)), docs: new Set([sel.id]), ents: new Set(d.reach) };
  }
  if (sel.k === "ent") {
    return {
      stories: new Set(h.stories.filter((s) => s.touches.includes(sel.id)).map((s) => s.n)),
      docs: new Set(h.documents.filter((d) => d.reach.includes(sel.id)).map((d) => d.name)),
      ents: new Set([sel.id]),
    };
  }
  const s = h.stories.find((x) => x.n === sel.id)!;
  return { stories: new Set([s.n]), docs: new Set(s.born), ents: new Set(s.touches) };
}

/** Why an entity is marked: in a line or two. */
export function reason(h: Heart, m: Mark): { title: string; one: string; two: string; red: boolean } {
  const e = h.entities.find((x) => x.name === m.ent)!;
  const touching = h.stories.filter((s) => s.touches.includes(e.name)).length;
  const touch = touching ? `${plural(touching, "story touches", "stories touch")} it.` : "No story touches it.";
  if (e.red) return { title: `${e.name} · needed by no story`, one: `Held by ${list(e.documents.map(title))}, which serve${e.documents.length === 1 ? "s" : ""} no story told.`, two: touch, red: true };
  return { title: `${e.name} · looked up, never held`, one: "No document holds it, so nobody is told when it changes.", two: touch, red: false };
}

/** The three columns, as the modeller's page draws them, for a column of entities `width` wide. */
export function drawHeart(h: Heart, ui: Ui, width = Infinity): string {
  const sel = picked(h, ui.sel);
  if (!sel) return `<section id="stories"><div class="head"><h2>Stories</h2></div><p class="empty">No stories yet.</p></section><section id="documents"></section><section id="entities"></section>`;
  const r = related(h, sel);
  const isSel = (k: Sel["k"], id: string | number) => sel.k === k && sel.id === id;
  const subject = sel.k === "doc" ? title(sel.id) : sel.k === "ent" ? sel.id : `story ${sel.id}`;
  const infoButton = (m: Mark, label: string, red: boolean) =>
    `<button class="icon info${red ? " red" : ""}" data-mark="${esc(keyOf(m))}" data-key="${esc(keyOf(m))}" aria-label="${esc(label)}" title="${esc(label)}" aria-expanded="${ui.pop?.ent === m.ent}">${INFO}</button>`;
  const eye = (which: string, hidden: boolean, hide: string, show: string) =>
    `<button class="icon eye" data-act="${which}" data-key="${which}" aria-pressed="${hidden}" aria-label="${esc(hidden ? show : hide)}" title="${esc(hidden ? show : hide)}">${hidden ? EYE_OFF : EYE}</button>`;

  // ── Stories ──
  const storiesHead = sel.k === "doc" ? `${r.stories.size} of ${h.stories.length} it was born from` : sel.k === "ent" ? `${r.stories.size} of ${h.stories.length} touch ${subject}` : subject;
  const story = (s: Story) => {
    const cls = ["story", r.stories.has(s.n) && "on", isSel("story", s.n) && "me"].filter(Boolean).join(" ");
    const tag = (s.kind === "cannot" ? `<span class="cannot">cannot · </span>` : "") + (s.post ? `<span class="tag">posts to ${esc(s.post)} · </span>` : s.born.length ? "" : `<span class="tag">no document · </span>`);
    return `<li><button class="${cls}" data-pick="story:${s.n}" data-key="story:${s.n}" aria-pressed="${isSel("story", s.n)}">${tag}${esc(s.name)}</button></li>`;
  };
  const stories = `<section id="stories" aria-labelledby="stories-head"><div class="head"><h2 id="stories-head">Stories · ${esc(storiesHead)}</h2>${eye("stories", ui.hideStories, "Hide the stories that don't go with it", "Show every story")}</div><ol class="stories">${h.stories
    .filter((s) => !ui.hideStories || r.stories.has(s.n))
    .map(story)
    .join("")}</ol></section>`;

  // ── Documents ──
  const docsHead = sel.k === "doc" ? subject : sel.k === "ent" ? `${r.docs.size} reach ${subject}` : `${r.docs.size} it was born into`;
  const docCard = (d: Doc) => {
    const me = isSel("doc", d.name);
    const on = r.docs.has(d.name);
    const cls = ["doc", on && !me && "on", me && "me", d.needless && "needless", sel.k !== "doc" && !on && "dim"].filter(Boolean).join(" ");
    const more = me ? `<div class="doc-more"><div class="shape">${d.shape.map((l) => `<div style="padding-left:${l.pad}px">${esc(l.text)}</div>`).join("")}</div><div class="cost">held by ${d.held}${d.needless ? " · serves no story told" : ""}</div></div>` : "";
    return `<div class="${cls}"><div class="doc-top"><button class="doc-pick" data-pick="doc:${esc(d.name)}" data-key="doc:${esc(d.name)}" aria-pressed="${me}"><span class="doc-name">${esc(title(d.name))}</span><span class="doc-for">${esc(d.for)}</span></button></div>${more}</div>`;
  };
  const documents = `<section id="documents" aria-labelledby="documents-head"><div class="head"><h2 id="documents-head">Documents · ${esc(docsHead)}</h2></div><div class="docs">${h.documents.map(docCard).join("")}</div></section>`;

  // ── Entities ──
  const visible = ui.hideEnts ? new Set(h.entities.filter((e) => r.ents.has(e.name)).map((e) => e.name)) : undefined;
  const tall = (e: (typeof h.entities)[number]) => boxHeight(e.columns, e.red || e.looked ? 17 : 23); // a mark at the right takes its room
  const { pos, segs, width: w, height } = layout(h.entities.map((e) => ({ ...e, h: tall(e) })), visible, width);
  const reached = h.entities.filter((e) => r.ents.has(e.name)).length;
  const entsHead = sel.k === "doc" ? `${reached} of ${h.entities.length} reached` : sel.k === "ent" ? subject : `${reached} it touches`;
  const nodes = Object.entries(pos)
    .map(([name, p]) => {
      const e = h.entities.find((x) => x.name === name)!;
      const cls = ["ent", r.ents.has(name) && "on", e.red && "red", e.looked && "looked", isSel("ent", name) && "me"].filter(Boolean).join(" ");
      const why = e.red || e.looked ? infoButton({ kind: "ent", ent: name }, e.red ? `Why is ${name} marked?` : `Who looks ${name} up?`, e.red) : "";
      return `<div class="node" style="left:${p.x}px;top:${p.y}px;height:${tall(e)}px"><button class="${cls}" data-pick="ent:${esc(name)}" data-key="ent:${esc(name)}" aria-pressed="${isSel("ent", name)}" title="${esc(e.columns.join(" · "))}"><span class="name">${esc(name)}</span><span class="sub">${esc(e.columns.join(" · "))}</span></button>${why}</div>`;
    })
    .join("");
  const entities = `<section id="entities" aria-labelledby="entities-head"><div class="head"><h2 id="entities-head">Entities · ${esc(entsHead)}</h2>${eye("ents", ui.hideEnts, "Show only the entities that go with it", "Show every entity")}</div>${
    nodes
      ? `<div class="erd-wrap"><div class="erd" style="width:${w}px;height:${height}px">${segs.map((g) => `<div class="seg" style="left:${g.left}px;top:${g.top}px;width:${g.width}px;height:${g.height}px"></div>`).join("")}${nodes}</div></div>`
      : `<p class="empty">No entity goes with ${esc(subject)}.</p>`
  }<div class="legend"><span><i class="key me"></i>what you clicked</span><span><i class="key on"></i>goes with it</span><span><i class="key red"></i>needed by no story</span><span><i class="key looked"></i>looked up, never held</span></div></section>`;

  return stories + documents + entities;
}

// ───────────────────────────── the model, in plain text ─────────────────────────────

/**
 * The model as the page shows it, in plain text, for the CLI's `show`: each story by its number,
 * who tells it, whether they do it or cannot, and its words; then each document by its number,
 * whether it is each person's own, who holds it and the stories it serves, and below it its root
 * and what it holds, each entity under the one it hangs from, with its fields (a type, where not text).
 */
export function plain(raw: Raw): string {
  const h = heartOf(raw);
  const told = new Set(h.stories.map((s) => String(s.n)));
  const said = (n: number) => {
    const s = raw.stories?.[String(n)];
    const w = (s?.writes ?? []).map(saidWrite);
    const r = (s?.requires ?? []).map((q) => `${q.entity}.${q.path}=${q.value}`);
    return `${w.length ? `; writes ${w.join(", ")}` : ""}${r.length ? `; requires ${r.join(", ")}` : ""}`;
  };
  const stories = h.stories.map((s) => `${s.n}. ${s.as} ${s.kind}${s.post ? `, posts to ${s.post}` : s.born.length ? "" : ", no document"}: ${s.name}${said(s.n)}`);
  const documents = Object.values(raw.documents ?? {})
    .sort(byId)
    .flatMap((d) => {
      const holds = d.holds ?? {};
      const serves = (d.stories ?? []).map(String).filter((id) => told.has(id));
      const head = `${d.id}. ${d.name}${d.own ? ", each person's own" : ""}, held by ${list(d.held_by ?? []) || "nobody yet"}; ${serves.length ? `serves ${list(serves)}` : "serves no story told"}`;
      const fields = (e: string) => (holds[e]?.fields ?? []).map((f) => (f.type === "text" ? f.name : `${f.name}:${f.type}`)).join(", ");
      return [head, ...shape(head, d.root, holds).slice(1).map((l) => `${" ".repeat(1 + l.pad / 7)}${l.text}${fields(l.text) && `: ${fields(l.text)}`}`)];
    });
  return [raw.models.name, "", "Stories", ...(stories.length ? stories : ["None yet."]), "", "Documents", ...(documents.length ? documents : ["None yet."])].join("\n");
}
