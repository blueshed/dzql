// Londons end to end, on one canvas: `bun canvas.ts` writes dist/stories.svg.
//
// The lanes are the roles, top to bottom; left to right is the order the story is told in. A state
// sits in the lane of whoever moves next, so an arrow that crosses lanes hands the turn over; an
// agreement that ends between two parties sits on the line between their lanes. An arrow's colour
// is who makes the move, each state says the page its mover sees it on, and the critical path is
// the thick one. Dashed lines are what one agreement waits on in another, each as a story says it.
//
// The arrows are the agreements in src/*.puml, checked against the stories (agreements.ts); what
// is hand-made here is where each state is placed. A state or agreement with no place is listed in
// red on the canvas, so the layout cannot quietly fall behind the diagrams.

import { readdirSync, readFileSync } from "node:fs";
import { arrows, checkAgreement, ends, told, values, type Arrow, type Story } from "../agreements";
import { stories as all } from "./stories";

const stories = all.stories as Story[];
const dir = import.meta.dir;

/** A place: the lane (a role), the step along the story, and an offset in pixels within the lane. */
type Place = [lane: number, step: number, dy?: number];

const LANES: [role: string, who: string, colour: string][] = [
  ["authority", "Board", "#7b4fa0"],
  ["venueOwner", "The Downs Company", "#2e7d5b"],
  ["promoter", "Festival Promotions", "#c46a00"],
  ["sponsor", "Harrow", "#a33c7a"],
  ["contractor", "Londons", "#2f63bf"],
  ["supplier", "Northgate Signs", "#8a6d1f"],
  ["worker", "Sam", "#1d8a99"],
];
const HEIGHT = [150, 170, 170, 190, 260, 170, 300];

const PHASES: [title: string, from: number, to: number][] = [
  ["I · Hosting", 0.75, 4.95],
  ["II · Permits", 4.95, 7.95],
  ["III · Packages and campaigns", 7.95, 14.35],
  ["IV · The scenario", 14.35, 18.95],
  ["V · The purchase", 18.95, 21.05],
  ["VI · The project and its supply", 21.05, 28.3],
  ["VII · Deployment", 28.3, 31.8],
  ["VIII · Build and strike", 31.8, 39.2],
  ["IX · Close", 39.2, 40.8],
];

/** The agreements in the order the story tells them, and where each state is placed. */
const LAYOUT: [machine: string, states: Record<string, Place>, starts: Record<string, Place>][] = [
  ["hosting", { invited: [1, 2.2], proposed: [0, 2.2], accepted: [0, 3.4, 75], declined: [0, 4.6, 75] }, { authority: [0, 1.3], venueOwner: [1, 1.3] }],
  ["availability", { available: [6, 2.2], unavailable: [6, 4.8] }, { "": [6, 1.3] }],
  ["permit", { granted: [0, 6.1], revoked: [0, 7.5], own: [1, 6.1], ownRevoked: [1, 7.5] }, { authority: [0, 5.3], venueOwner: [1, 5.3] }],
  ["package", { draft: [2, 9.3, -38], offered: [3, 10.6, -20], agreed: [2, 19.6, 85] }, { promoter: [2, 8.4, -38] }],
  ["campaign", { draft: [2, 11.7, 38], offered: [3, 12.9, -20], withdrawn: [2, 14, 85], agreed: [2, 20.7, 85] }, { promoter: [2, 10.8, 38] }],
  ["scenario", { draft: [4, 15.4, -60], proposed: [3, 16.4, -20], approved: [3, 17.9, -20], rejected: [4, 17.3, -60], withdrawn: [4, 18.6, 15] }, { sponsor: [3, 14.6, -20] }],
  ["project", { open: [4, 21.9, -100], closed: [4, 39.9, -100] }, { contractor: [4, 21.2, -100] }],
  ["supply-line", { open: [5, 23.5, -25], accepted: [5, 27.7, -85] }, { contractor: [4, 22.6, 40] }],
  ["supply-offer", { offered: [4, 25.3, 40], withdrawn: [5, 26.5, 50], accepted: [5, 26.5, -85], declined: [4, 26.7, 40] }, { supplier: [5, 24.3, 50] }],
  ["deployment", { proposed: [1, 29.4], rejected: [4, 30.2, 45], accepted: [4, 31.3, -40], blocked: [4, 35.4, 45], built: [6, 37.1, 110], struck: [6, 38.7, 110], cancelled: [4, 38.7, 100] }, { contractor: [4, 28.6, -40] }],
  ["assignment", { assigned: [6, 32.9, -105], declined: [6, 33.6, -150], done: [6, 38.2, -105] }, { contractor: [4, 32.3, 95] }],
  ["task", { todo: [6, 34.6, -20], done: [6, 36.1, -20], skipped: [6, 35.3, 55] }, { contractor: [4, 34.6, 95] }],
];

/** Moves routed along a channel (lane, offset) so they pass beneath what stands between. */
const VIA: Record<string, [number, number]> = {
  "package:offered>agreed": [3, 62],
  "campaign:offered>agreed": [3, 78],
  "deployment:rejected>cancelled": [4, 122],
  "deployment:accepted>cancelled": [4, -76],
  "deployment:accepted>built": [5, 12],
  "deployment:built>accepted": [5, -16],
};

/** A loop's label goes above it, unless placed beside it here. */
const LOOP_LABEL: Record<string, "left" | "right"> = { "deployment:accepted>accepted": "left" };

/** The critical path: the moves the story cannot finish without. */
const CRITICAL = new Set([
  "hosting:[*]>invited", "hosting:invited>accepted", "permit:[*]>granted",
  "package:[*]>draft", "package:draft>offered", "package:offered>agreed",
  "scenario:[*]>draft", "scenario:draft>proposed", "scenario:proposed>approved",
  "project:[*]>open", "project:open>closed",
  "supply-line:[*]>open", "supply-line:open>accepted", "supply-offer:[*]>offered", "supply-offer:offered>accepted",
  "deployment:[*]>proposed", "deployment:proposed>accepted", "deployment:accepted>built", "deployment:built>struck",
  "assignment:[*]>assigned", "assignment:assigned>done", "task:[*]>todo", "task:todo>done",
]);

/** What one agreement waits on in another, each as a story says it: found by the story's words, so it follows renumbering. A long one runs along a channel. */
const WAITS: [from: string, to: string, words: string, story: string, via?: [number, number]][] = [
  ["package:draft", "campaign:[*]:promoter", "from a package", "assembles a campaign from a package"],
  ["scenario:approved", "package:agreed", "with its approved scenario", "buys an offered package"],
  ["scenario:approved", "supply-line:[*]:contractor", "from the buy requirement", "lists a supply line from the buy requirement", [4, -52]],
  ["permit:granted", "deployment:accepted", "stands on a permit", "revokes the Paddock permit", [0, -64]],
  ["deployment:accepted", "assignment:[*]:contractor", "only once accepted", "has not accepted takes no worker"],
  ["deployment:accepted", "task:[*]:contractor", "on an accepted deployment", "opens a task on an accepted deployment"],
];

const ORDER = ["stories", ...LAYOUT.map(([m]) => m)];

// ── geometry ──
const LEFT = 220, STEP = 120, TOP = 118, W = 108, H = 42;
const laneTop = HEIGHT.map((_, i) => TOP + HEIGHT.slice(0, i).reduce((a, b) => a + b, 0));
const width = LEFT + 41 * STEP, height = laneTop[6]! + HEIGHT[6]! + 40;
const X = (step: number) => LEFT + step * STEP;
const Y = (lane: number, dy = 0) => laneTop[lane]! + HEIGHT[lane]! / 2 + dy;
const colour = (role: string) => LANES.find(([r]) => r === role)?.[2] ?? "#444";
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const cite = (ns: number[]) => ns.map((n) => stories[n - 1]?.name ?? `(${n}) is not a story`).map((s, i) => `(${ns[i]}) ${s}`).join("\n");

type Pt = { x: number; y: number; box: boolean };
const at = ([lane, step, dy]: Place, box = true): Pt => ({ x: X(step), y: Y(lane, dy), box });

/** Where a line leaves or meets a thing, facing the other end: a side of a box, the edge of a dot. */
function edge(p: Pt, toward: Pt): { x: number; y: number; dx: number; dy: number } {
  const dx = toward.x - p.x, dy = toward.y - p.y;
  if (!p.box) { const d = Math.hypot(dx, dy) || 1; return { x: p.x + (dx / d) * 6, y: p.y + (dy / d) * 6, dx: Math.sign(dx), dy: 0 }; }
  if (Math.abs(dx) > W / 2 + 14) return { x: p.x + Math.sign(dx) * (W / 2), y: p.y, dx: Math.sign(dx), dy: 0 };
  return { x: p.x, y: p.y + Math.sign(dy || 1) * (H / 2), dx: 0, dy: Math.sign(dy || 1) };
}

type Route = { d: string; at: (w: number) => { x: number; y: number } };
const pw = (text: string) => text.length * 5.5 + 12;

/** A path from a to b, and where a label of width w sits on it: above a short hop, near the end of a long run, along a curve. */
function route(a: Pt, b: Pt, via?: number, bend = 0, side?: "left" | "right"): Route {
  if (a.x === b.x && a.y === b.y) {
    const top = a.y - H / 2, off = (w: number) => 34 + w / 2;
    return { d: `M${a.x - 14},${top} C${a.x - 44},${top - 50} ${a.x + 44},${top - 50} ${a.x + 14},${top}`, at: (w) => (side ? { x: a.x + (side === "left" ? -off(w) : off(w)), y: top - 22 } : { x: a.x, y: top - 48 }) };
  }
  if (via !== undefined) return channel(a, b, via);
  if (b.x < a.x - 10 && Math.abs(b.y - a.y) < 30) {
    // back along a lane: arc over the top
    const s = { x: a.x - 10, y: a.y - H / 2 }, e = { x: b.x + 10, y: b.y - H / 2 }, lift = Math.min(60, 30 + (a.x - b.x) * 0.08);
    return { d: `M${s.x},${s.y} C${s.x},${s.y - lift} ${e.x},${e.y - lift} ${e.x},${e.y}`, at: () => ({ x: (s.x + e.x) / 2, y: Math.min(s.y, e.y) - lift * 0.75 }) };
  }
  const s = edge(a, b), e = edge(b, a);
  const k = (u: number, v: number) => Math.max(36, Math.abs(u - v) * 0.5);
  // a move with one back the other way bows to its own side, so the two stay apart
  const len = Math.hypot(e.x - s.x, e.y - s.y) || 1, nx = (-(e.y - s.y) / len) * bend, ny = ((e.x - s.x) / len) * bend;
  const c1 = { x: s.x + s.dx * k(s.x, e.x) + nx, y: s.y + s.dy * k(s.y, e.y) + ny };
  const c2 = { x: e.x + e.dx * k(s.x, e.x) + nx, y: e.y + e.dy * k(s.y, e.y) + ny };
  const d = `M${s.x},${s.y} C${c1.x},${c1.y} ${c2.x},${c2.y} ${e.x},${e.y}`;
  if (Math.abs(e.y - s.y) < 12 && !bend) {
    const gap = Math.abs(e.x - s.x), dir = Math.sign(e.x - s.x) || 1;
    return { d, at: (w) => (gap >= w + 8 ? (gap < 400 ? { x: (s.x + e.x) / 2, y: s.y } : { x: e.x - dir * (30 + w / 2), y: e.y }) : { x: (s.x + e.x) / 2, y: s.y - 34 }) };
  }
  const t = 0.6, u = 1 - t;
  const p = { x: u ** 3 * s.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t ** 3 * e.x, y: u ** 3 * s.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t ** 3 * e.y };
  return { d, at: () => p };
}

/** Along a channel at height vy: out of a's side (or straight up or down to the channel, when it is far), across, and into b the same way. */
function channel(a: Pt, b: Pt, vy: number): Route {
  const dir = Math.sign(b.x - a.x) || 1, r = 22;
  const far = (p: Pt) => Math.abs(p.y - vy) > 70;
  const reach = (p: Pt) => (p.box ? H / 2 : 6);
  let d: string;
  if (far(a)) {
    const sy = Math.sign(vy - a.y), s = { x: a.x, y: a.y + sy * reach(a) };
    d = `M${s.x},${s.y} L${s.x},${vy - sy * r} Q${s.x},${vy} ${s.x + dir * r},${vy}`;
  } else {
    const s = { x: a.x + dir * (a.box ? W / 2 : 6), y: a.y };
    d = `M${s.x},${s.y} C${s.x + dir * 40},${s.y} ${s.x + dir * 20},${vy} ${s.x + dir * 60},${vy}`;
  }
  let endX: number;
  if (far(b)) {
    const sy = Math.sign(b.y - vy), e = { x: b.x, y: b.y - sy * reach(b) };
    d += ` L${e.x - dir * r},${vy} Q${e.x},${vy} ${e.x},${vy + sy * r} L${e.x},${e.y}`;
    endX = e.x - dir * r;
  } else {
    const e = { x: b.x - dir * (b.box ? W / 2 : 6), y: b.y };
    d += ` L${e.x - dir * 60},${vy} C${e.x - dir * 20},${vy} ${e.x - dir * 40},${e.y} ${e.x},${e.y}`;
    endX = e.x - dir * 60;
  }
  return { d, at: (w) => ({ x: endX - dir * (w / 2 + 8), y: vy }) };
}

function pill(x: number, y: number, text: string, stroke: string, fill = "#fff", colourText = stroke): string {
  const w = text.length * 5.5 + 12;
  return `<g><rect x="${x - w / 2}" y="${y - 8}" width="${w}" height="16" rx="8" fill="${fill}" stroke="${stroke}" stroke-width="1"/><text x="${x}" y="${y + 3.5}" text-anchor="middle" font-size="10" fill="${colourText}">${esc(text)}</text></g>`;
}

// ── read the agreements ──
const warnings: string[] = [];
const machines = new Map<string, { puml: string; title: string }>();
for (const f of readdirSync(`${dir}/src`).filter((f) => f.endsWith(".puml"))) {
  const puml = readFileSync(`${dir}/src/${f}`, "utf8");
  machines.set(f.replace(/\.puml$/, ""), { puml, title: puml.match(/^title\s+(.+)$/m)?.[1] ?? f });
}
for (const m of machines.keys()) if (!LAYOUT.some(([n]) => n === m)) warnings.push(`${m} has no place on the canvas`);

const nodes = new Map<string, Pt>(); // "machine:state" and "machine:[*]:role"
const under: string[] = [], lines: string[] = [], over: string[] = [], labels: string[] = [];
const moveOf = new Map<number, string[]>(); // a story's targets across agreements: one move, many things

for (const [machine, places, starts] of LAYOUT) {
  const m = machines.get(machine);
  if (!m) { warnings.push(`${machine} is placed, but src/${machine}.puml is gone`); continue; }
  const drawn = arrows(m.puml), value = values(m.puml), ended = ends(m.puml);
  const problems = new Map(checkAgreement(m.puml, stories).marks.map((k) => [k.arrow, k.problems]));
  const states = new Set(drawn.flatMap((a) => [a.from, a.to]).filter((s) => s !== "[*]"));
  for (const s of states) if (!places[s]) warnings.push(`${machine}: ${s} has no place`);
  const movers = new Map<string, Set<string>>(), refused = new Map<string, Arrow[]>(), pages = new Map<string, Set<string>>();
  for (const a of drawn) {
    if (a.refusal) { const k = a.from === "[*]" ? a.to : a.from; refused.set(k, [...(refused.get(k) ?? []), a]); continue; }
    (movers.get(a.from) ?? movers.set(a.from, new Set()).get(a.from)!).add(a.role);
    for (const n of a.cites) for (const [r, p] of told(stories[n - 1] ?? { name: "", as: "" })) {
      const k = `${a.to}|${r}`;
      (pages.get(k) ?? pages.set(k, new Set()).get(k)!).add(p);
    }
  }
  for (const [s, p] of Object.entries(places)) if (states.has(s)) nodes.set(`${machine}:${s}`, at(p));
  // starts: a dot in the lane of whoever makes the thing
  for (const a of drawn.filter((a) => a.from === "[*]" && !a.refusal)) {
    const p = starts[a.role];
    if (!p) { warnings.push(`${machine}: no start placed for ${a.role}`); continue; }
    nodes.set(`${machine}:[*]:${a.role}`, at(p, false));
  }
  const plain = m.puml.match(/^\s*\[\*\]\s*-+>\s*(\w+)\s*$/m);
  if (plain && starts[""]) {
    const s = at(starts[""], false), t = nodes.get(`${machine}:${plain[1]}`);
    nodes.set(`${machine}:[*]:`, s);
    if (t) lines.push(`<path d="${route(s, t).d}" fill="none" stroke="#555" stroke-width="1.3" marker-end="url(#head)"/>`);
  }

  for (const a of drawn.filter((a) => !a.refusal)) {
    const key = `${machine}:${a.from}>${a.to}`;
    const s = nodes.get(a.from === "[*]" ? `${machine}:[*]:${a.role}` : `${machine}:${a.from}`), t = nodes.get(`${machine}:${a.to}`);
    if (!s || !t) continue;
    const via = VIA[key];
    const text = `${problems.get(a)?.length ? "⚠ " : ""}${a.words} ${a.cites.join(",")}`;
    const back = a.from !== a.to && drawn.some((x) => !x.refusal && x.from === a.to && x.to === a.from && x.from !== "[*]");
    const { d, at: place } = route(s, t, via && Y(via[0], via[1]), back && Math.abs(t.y - s.y) >= 30 ? 26 : 0, LOOP_LABEL[key]);
    const mid = place(pw(text));
    const bad = problems.get(a)?.length;
    const c = colour(a.role);
    if (CRITICAL.has(key)) under.push(`<path d="${d}" fill="none" stroke="#f2c94c" stroke-width="10" stroke-linecap="round" opacity=".55"/>`);
    lines.push(`<g><title>${esc(`${a.role} ${a.words}\n${cite(a.cites)}${bad ? `\n⚠ ${problems.get(a)!.join("\n⚠ ")}` : ""}`)}</title><path d="${d}" fill="none" stroke="${bad ? "#c0392b" : c}" stroke-width="${CRITICAL.has(key) ? 2.4 : 1.4}"${bad ? ` stroke-dasharray="6 3"` : ""} marker-end="url(#h-${a.role})"/></g>`);
    labels.push(`<g><title>${esc(cite(a.cites))}</title>${pill(mid.x, mid.y, text, bad ? "#c0392b" : c)}</g>`);
    if (a.from !== a.to) for (const n of a.cites) moveOf.set(n, [...(moveOf.get(n) ?? []), `${machine}:${a.to}`]);
  }

  for (const s of states) {
    const p = nodes.get(`${machine}:${s}`);
    if (!p) continue;
    const who = [...(movers.get(s) ?? [])];
    const lane = LANES[LAYOUT.find(([n]) => n === machine)![1][s]![0]]![0];
    const end = !who.length;
    const main = who.includes(lane) ? lane : who[0];
    const seenOn = main ? [...(pages.get(`${s}|${main}`) ?? [])].join(" · ") : "";
    const sub = end ? (ended.has(s) ? "ends" : "⚠ no move, not an end") : seenOn ? `on ${seenOn}` : `⚠ ${main} not told`;
    const tip = `${m.title}\n${value(s)}: ${end ? "it ends here; to go again, a new one is made" : `the move is ${who.join(", ")}'s`}${seenOn ? `\nseen on ${seenOn}` : ""}`;
    const stroke = end ? "#9a978f" : colour(main!);
    over.push(`<g><title>${esc(tip)}</title>`
      + `<rect x="${p.x - W / 2}" y="${p.y - H / 2}" width="${W}" height="${H}" rx="9" fill="${end ? "#f1efe9" : "#fff"}" stroke="${stroke}" stroke-width="${end ? 1.2 : 1.8}"${end ? ` stroke-dasharray="4 2"` : ""}/>`
      + `<text x="${p.x}" y="${p.y - 3}" text-anchor="middle" font-size="12" font-weight="600" fill="${end ? "#6b6b74" : "#1e2430"}">${esc(value(s))}</text>`
      + `<text x="${p.x}" y="${p.y + 12}" text-anchor="middle" font-size="9" fill="${sub.startsWith("⚠") ? "#c0392b" : "#6b6b74"}">${esc(sub.length > 22 ? sub.slice(0, 21) + "…" : sub)}</text>`
      + `<text x="${p.x - W / 2 + 4}" y="${p.y - H / 2 - 4}" font-size="8.5" fill="#9a978f">${esc(machine)}</text>`
      + who.map((r, i) => `<circle cx="${p.x + W / 2 - 7 - i * 9}" cy="${p.y - H / 2 + 7}" r="3.5" fill="${colour(r)}"><title>${esc(r)}'s move</title></circle>`).join("")
      + (refused.get(s) ?? []).map((a, i) => `<g><title>${esc(cite(a.cites))}</title><text x="${p.x}" y="${p.y + H / 2 + 11 + i * 10}" text-anchor="middle" font-size="8.5" fill="#8a8a8a">✗ ${esc(a.role)} ${esc(a.words.replace(/^cannot\s+/, ""))} ${a.cites.join(",")}</text></g>`).join("")
      + `</g>`);
  }
  for (const [role, p] of Object.entries(starts)) {
    const d = nodes.get(`${machine}:[*]:${role}`);
    if (d) over.push(`<circle cx="${d.x}" cy="${d.y}" r="6" fill="#1e2430" stroke="${colour(role) }" stroke-width="2.5"><title>${esc(`${role} makes a ${machine}`)}</title></circle>`);
    void p;
  }
}

// one move, many things: a story whose write lands in two agreements at once
const ties: string[] = [];
for (const [n, targets] of moveOf) {
  const uniq = [...new Set(targets)].filter((t) => !t.includes("[*]"));
  for (let i = 1; i < uniq.length; i++) {
    const a = nodes.get(uniq[0]!), b = nodes.get(uniq[i]!);
    if (a && b && uniq[0]!.split(":")[0] !== uniq[i]!.split(":")[0]) ties.push(`<g><title>${esc(`one move: (${n}) ${stories[n - 1]?.name}`)}</title><line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="#1e2430" stroke-width="1" stroke-dasharray="1 3" opacity=".7"/></g>`);
  }
}

// what one agreement waits on in another
const waits: string[] = [];
for (const [from, to, words, story, via] of WAITS) {
  const a = nodes.get(from), b = nodes.get(to);
  const n = stories.findIndex((s) => s.name.includes(story)) + 1;
  if (!a || !b) { warnings.push(`the wait "${words}" joins ${!a ? from : to}, which has no place`); continue; }
  if (!n) warnings.push(`no story says "${story}" any more, for "${words}"`);
  // a short wait carries only its story's number; the words are on hover
  const text = Math.hypot(b.x - a.x, b.y - a.y) < 450 && !via ? (n ? `${n}` : "⚠") : `${words}${n ? ` ${n}` : " ⚠"}`;
  const { d, at: place } = route(a, b, via && Y(via[0], via[1]));
  const mid = place(pw(text));
  waits.push(`<g><title>${esc(`${words}: ${n ? `(${n}) ${stories[n - 1]!.name}` : "no story says so any more"}`)}</title><path d="${d}" fill="none" stroke="#6b6b74" stroke-width="1.2" stroke-dasharray="5 4" marker-end="url(#wait)"/>${pill(mid.x, mid.y, text, "#9a978f", "#faf9f6", n ? "#6b6b74" : "#c0392b")}</g>`);
}

// the documents each role has open, from the stories' seen
const docs = new Map<string, Set<string>>();
for (const s of stories) for (const [r, p] of told(s)) (docs.get(r) ?? docs.set(r, new Set()).get(r)!).add(p.replace(/\/\d+/g, "/n"));

const lanes = LANES.map(([role, who, c], i) => {
  const y = laneTop[i]!, h = HEIGHT[i]!;
  const pages = [...(docs.get(role) ?? [])].sort((a, b) => (a === "home" ? -1 : b === "home" ? 1 : a.localeCompare(b)));
  return `<rect x="0" y="${y}" width="${width}" height="${h}" fill="${i % 2 ? "#faf9f6" : "#fff"}"/>`
    + `<line x1="0" y1="${y}" x2="${width}" y2="${y}" stroke="#e4e1d8"/>`
    + `<rect x="0" y="${y}" width="6" height="${h}" fill="${c}"/>`
    + `<text x="18" y="${y + 24}" font-size="15" font-weight="700" fill="${c}">${esc(role)}</text>`
    + `<text x="18" y="${y + 41}" font-size="11.5" fill="#1e2430">${esc(who)}</text>`
    + `<text x="18" y="${y + 60}" font-size="9" fill="#9a978f" letter-spacing=".06em">DOCUMENTS OPEN</text>`
    + pages.map((p, j) => `<text x="18" y="${y + 73 + j * 11.5}" font-size="10" fill="#6b6b74" font-family="ui-monospace, Menlo, monospace">${esc(p)}</text>`).join("");
}).join("");

const phases = PHASES.map(([t, a, b], i) => `<rect x="${X(a)}" y="${TOP - 34}" width="${X(b) - X(a)}" height="30" fill="${i % 2 ? "#efece4" : "#f6f3ec"}"/>`
  + `<text x="${X(a) + 10}" y="${TOP - 14}" font-size="12.5" font-weight="700" fill="#1e2430">${esc(t)}</text>`
  + `<line x1="${X(a)}" y1="${TOP - 34}" x2="${X(a)}" y2="${height - 30}" stroke="#d9d5ca" stroke-dasharray="3 5"/>`).join("");

const heads = LANES.map(([r, , c]) => `<marker id="h-${r}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="${c}"/></marker>`).join("");

const legend = `<g transform="translate(${LEFT + 10},20)" font-size="11" fill="#1e2430">
  <text font-size="18" font-weight="700" y="4">Londons, end to end</text>
  <text y="24" fill="#6b6b74">A state sits in the lane of whoever moves next · an arrow's colour is who makes the move · "on …" is the page the mover sees it on · ✗ is a refusal</text>
  <g transform="translate(900,-8)"><path d="M0,10 L40,10" stroke="#f2c94c" stroke-width="10" opacity=".55"/><path d="M0,10 L40,10" stroke="#1e2430" stroke-width="2.4"/><text x="48" y="14">the critical path</text>
  <path d="M170,10 L210,10" stroke="#6b6b74" stroke-dasharray="5 4"/><text x="218" y="14">waits on, as a story says</text>
  <path d="M390,10 L430,10" stroke="#1e2430" stroke-dasharray="1 3"/><text x="438" y="14">one move, two things</text>
  <rect x="560" y="1" width="40" height="18" rx="6" fill="#f1efe9" stroke="#9a978f" stroke-dasharray="4 2"/><text x="608" y="14">ends: to go again, a new one is made</text></g>
</g>`;

const warn = warnings.length ? `<g transform="translate(${LEFT + 10},${height - 26})"><text font-size="12" fill="#c0392b">⚠ ${esc(warnings.join(" · "))}</text></g>` : "";

const svg = `<svg xmlns="http://www.w3.org/2000/svg" data-canvas="true" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="Helvetica Neue, Helvetica, Arial, sans-serif">
<defs>${heads}<marker id="head" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="#555"/></marker><marker id="wait" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L10,5 L0,10" fill="none" stroke="#6b6b74" stroke-width="1.5"/></marker></defs>
<rect width="${width}" height="${height}" fill="#fff"/>
${lanes}${phases}${legend}
${under.join("")}${waits.join("")}${ties.join("")}${lines.join("")}${over.join("")}${labels.join("")}${warn}
</svg>`;

await Bun.write(`${dir}/dist/stories.svg`, svg);
console.log(JSON.stringify({ ok: true, warnings, order: [...new Set(ORDER)] }));
