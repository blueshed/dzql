// Chat end to end, on one canvas, from a real run: `bun canvas.ts` writes dist/stories.svg.
//
// Chat has one role and a cast, so the lanes are the people, each as the cast starts them. Every
// story starts from that cast, so a column is not a moment in one day but one story told against
// the same room: the move in the teller's lane, and in every other lane what that person heard, on
// which document, as the wire carried it (the harness's trace). Green: the story says they see it.
// A grey ✗: the story says they must not, and they do not. Amber: they heard it and the story does
// not say so. Red: the story and the run disagree. Each move says whether the model (types.ts) has
// that write, so the drawn intent and the built app can be read side by side.
//
// Nothing here is placed by hand but the grammar: the cast, the stories and the run fill it.

process.env.DB_PATH ??= ":memory:";
process.env.LOG_LEVEL ??= "warn";

import { readFileSync } from "node:fs";
import { readTypes, type WriteDef } from "./check";
import type { Trace } from "../src/harness";
import { writeOf } from "../src/stories";

const dir = import.meta.dir;
const STORIES = `${dir}/../examples/chat/stories.ts`;
const { run } = await import("../src/harness");
const { example } = await import("../examples/chat");
const { stories } = await import("../examples/chat/stories");
type Op = { op: string; path: string; value?: unknown };

const traces: Trace[] = [];
const report = await run(example, stories, (t) => traces.push(t));
const types = readTypes(readFileSync(`${dir}/types.ts`, "utf8"));

// ── what the stories say ──
const cast = Object.keys(stories.cast);
const COLOUR = ["#2f63bf", "#2e7d5b", "#c46a00", "#a33c7a", "#1d8a99", "#7b4fa0"];
const colour = (who: string) => COLOUR[cast.indexOf(who) % COLOUR.length]!;
const list = (x: unknown): string[] => (Array.isArray(x) ? x : x ? Object.keys(x as object) : []);

/** The sections the stories are told in, from their `// ── … ──` comments. */
const sections: { title: string; from: number; to: number }[] = [];
{
  let n = 0;
  for (const line of readFileSync(STORIES, "utf8").split("\n")) {
    const head = line.match(/^\s*\/\/\s*──\s*(.+?)\s*──/);
    if (head) sections.push({ title: head[1]!, from: n, to: n });
    if (/^\s*story\(/.test(line)) { n++; if (sections.length) sections.at(-1)!.to = n; }
  }
}

/** A person's session as the cast leaves it, and after a write. */
type Session = { name: string | null; room: string | null };
function after(s: Session, ops: Op[]): Session {
  const next = { ...s };
  for (const o of ops) {
    if (o.path === "/name") next.name = o.op === "remove" ? null : String(o.value);
    if (o.path === "/room") next.room = o.op === "remove" ? null : String(o.value);
  }
  return next;
}
const state = (s: Session) => (!s.name ? "nameless" : !s.room ? `${s.name}, in no room` : `${s.name}, in ${s.room}`);
const start = new Map(cast.map((who) => [who, (stories.cast as Record<string, { ops: Op[] }[]>)[who]!.reduce((s, w) => after(s, w.ops), { name: null, room: null } as Session)]));

/** A write in plain words. */
function words(doc: string, ops: Op[]): string {
  return ops.map((o) => {
    if (doc === "session" && o.path === "/name") return o.op === "remove" ? "logs out" : `name “${o.value}”`;
    if (doc === "session" && o.path === "/room") return o.op === "remove" ? "leaves the room" : `room “${String(o.value).trim() || " "}”`;
    if (o.path === "/messages/-") return `says “${o.value}”`;
    return `${o.op} ${doc} ${o.path}`;
  }).join(", ");
}

/** The model's write for this one, if the model has it: the same document, path and op. */
const base = (doc: string) => doc.split(":")[0];
function inModel(doc: string, ops: Op[]): WriteDef | undefined {
  return types.writes.find((w) => base(w.doc) === base(doc) && ops.every((o) => w.path === o.path && w.ops.includes(o.op)));
}

// ── geometry ──
const LEFT = 250, COL = 204, TOP = 168, LANE = 132, NW = 176, NH = 50;
const n = stories.stories.length;
const width = LEFT + n * COL + 30, height = TOP + cast.length * LANE + 70;
const X = (i: number) => LEFT + i * COL + COL / 2;
const Y = (who: string) => TOP + cast.indexOf(who) * LANE + LANE / 2;
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
function wrap(text: string, max: number): string[] {
  const out: string[] = [];
  let line = "";
  for (const w of text.split(" ")) {
    if ((line + " " + w).trim().length > max) { out.push(line.trim()); line = w; } else line += " " + w;
  }
  return [...out, line.trim()].filter(Boolean);
}
const chip = (x: number, y: number, text: string, stroke: string, fill: string, ink: string, dash = false) => {
  const w = Math.min(NW, text.length * 5.6 + 16);
  return `<rect x="${x - w / 2}" y="${y - 11}" width="${w}" height="22" rx="11" fill="${fill}" stroke="${stroke}" stroke-width="1.3"${dash ? ` stroke-dasharray="3 2"` : ""}/><text x="${x}" y="${y + 4}" text-anchor="middle" font-size="10.5" fill="${ink}">${esc(text)}</text>`;
};

// ── draw ──
const warnings: string[] = [];
const heardAll = new Map(cast.map((w) => [w, new Set<string>(["session"])]));
const parts: string[] = [], lines: string[] = [], checks: string[] = [];

stories.stories.forEach((s, i) => {
  const t = traces.find((x) => x.story === s.name && x.phase !== "undo" && x.phase !== "redo");
  const x = X(i), ay = Y(s.as);
  const write = writeOf(s); // none when a tab closes, or for a post
  const doc = write?.doc ?? "", ops = (write?.ops ?? []) as Op[];
  const seen = list(s.seen), untold = list(s.untold);
  const outcome = report.outcomes.find((o) => o.name === s.name);
  const findings: string[] = [...(outcome?.failures ?? [])];

  // the move
  const before = start.get(s.as)!, now = after(before, ops);
  const model = write && inModel(doc, ops);
  const refused = !!s.cannot;
  const move = write ? words(doc, ops) : "closes their tab";
  const changed = refused ? "refused: nothing changes" : write ? `→ ${state(now)}` : "→ gone";
  const c = colour(s.as);
  // a move: the model's write it is, or none; a refusal: the model's reason, or the model has no such write at all
  // a tab closing: the model's disconnect, if it has one
  const modelSays = !write
    ? types.unions.get("ConnectionEvent")?.includes("disconnect") ? "model: disconnect" : "⚠ not in the model (disconnect)"
    : refused
      ? (model ? `model: refused (${model.refused.join(" / ")})` : "model: no such write")
      : model ? `model: ${model.does}` : `⚠ not in the model (${doc} ${ops.map((o) => `${o.op} ${o.path}`).join(", ")})`;
  const heardBy = (who: string) => {
    const msgs = t?.heard.find((h) => h.member === who)?.messages ?? [];
    const docs = [...new Set(msgs.filter((m) => m.doc).map((m) => m.doc!))];
    for (const d of docs) heardAll.get(who)?.add(d);
    return { docs, page: msgs.some((m) => m.type === "render") };
  };
  const own = heardBy(s.as);
  parts.push(`<g><title>${esc(`(${i + 1}) ${s.name}\n${s.as}: ${move}${write ? ` on ${doc}` : ""}\n${state(before)} ${changed}\nhears: ${own.docs.join(", ") || (own.page ? "the page, redrawn" : "nothing")}`)}</title>`
    + `<rect x="${x - NW / 2}" y="${ay - NH / 2}" width="${NW}" height="${NH}" rx="10" fill="${refused ? "#f6f3ec" : "#fff"}" stroke="${refused ? "#9a978f" : c}" stroke-width="${refused ? 1.3 : 2}"${refused ? ` stroke-dasharray="4 2"` : ""}/>`
    + `<text x="${x}" y="${ay - 6}" text-anchor="middle" font-size="12.5" font-weight="700" fill="${refused ? "#6b6b74" : "#1e2430"}">${esc((refused ? "✗ " : "") + move)}</text>`
    + `<text x="${x}" y="${ay + 10}" text-anchor="middle" font-size="10" fill="#6b6b74">${esc(changed)}</text>`
    + `<text x="${x}" y="${ay + NH / 2 + 12}" text-anchor="middle" font-size="9.5" fill="${modelSays.startsWith("⚠") ? "#a86b00" : "#2e7d5b"}"><title>${esc(modelSays)}</title>${esc(modelSays.length > 40 ? modelSays.slice(0, 39) + "…" : modelSays)}</text>`
    + `<text x="${x}" y="${ay - NH / 2 - 5}" text-anchor="middle" font-size="9" fill="#9a978f">${esc(own.docs.length ? `hears on ${own.docs.join(" · ")}` : own.page ? "hears: the page, redrawn" : "")}</text>`
    + `</g>`);
  if (write && !model && !refused) findings.push(`the model has no ${doc} ${ops.map((o) => `${o.op} ${o.path}`).join(", ")}`);

  // everyone else: what they heard
  for (const who of cast) {
    if (who === s.as) continue;
    const y = Y(who), h = heardBy(who), heard = h.docs.length > 0 || h.page;
    const inSeen = seen.includes(who), inUntold = untold.includes(who);
    const label = h.docs.length ? h.docs.join(" · ") : "the page";
    let drawn = "";
    if (inSeen && heard) drawn = chip(x, y, `sees it on ${label}`, colour(who), "#fff", "#1e2430");
    else if (inUntold && !heard) drawn = chip(x, y, "✗ does not see it", "#c9c5bb", "#f6f3ec", "#8a8a8a", true);
    else if (heard && !inSeen && !inUntold) { drawn = chip(x, y, `hears on ${label}`, "#a86b00", "#fdf5e6", "#7a5200"); findings.push(`${who} hears it on ${label}, and the story does not say so`); }
    else if (inSeen && !heard) { drawn = chip(x, y, "⚠ not told", "#c0392b", "#fdeceb", "#c0392b"); }
    else if (inUntold && heard) { drawn = chip(x, y, `⚠ hears on ${label}`, "#c0392b", "#fdeceb", "#c0392b"); }
    if (!drawn) continue;
    parts.push(`<g><title>${esc(`${who} (${state(start.get(who)!)}): ${inSeen ? "the story says they see it" : inUntold ? "the story says they must not see it" : "the story does not mention them"}; ${heard ? `the run: heard on ${label}` : "the run: heard nothing"}`)}</title>${drawn}</g>`);
    if (heard) {
      const down = y > ay, sy = down ? ay + NH / 2 + 16 : ay - NH / 2 - 14, ey = down ? y - 11 : y + 11;
      lines.push(`<path d="M${x},${sy} C${x},${(sy + ey) / 2} ${x},${(sy + ey) / 2} ${x},${ey}" fill="none" stroke="${inSeen ? c : "#a86b00"}" stroke-width="1.4" marker-end="url(#h${cast.indexOf(s.as)})" opacity=".85"/>`);
    }
  }

  // the two checks, per story
  const ok = !findings.length;
  checks.push(`<g><title>${esc(ok ? "the teller hears their own move, everyone the story names hears it, and nobody the story says must not" : findings.join("\n"))}</title><text x="${x}" y="${height - 36}" text-anchor="middle" font-size="11" fill="${ok ? "#2e7d5b" : "#a86b00"}">${esc(ok ? "✓ as told" : `⚠ ${findings.length} not as told`)}</text></g>`);
  if (!ok) warnings.push(`(${i + 1}) ${findings.join("; ")}`);
});

// ── the frame: story heads, sections, lanes ──
const heads = stories.stories.map((s, i) => {
  const x = X(i), name = wrap(s.name, 34);
  return `<g><title>${esc(s.name)}</title><text x="${x - COL / 2 + 10}" y="${TOP - 42}" font-size="10" font-weight="700" fill="#9a978f">${i + 1}</text>`
    + name.slice(0, 3).map((l, j) => `<text x="${x - COL / 2 + 26}" y="${TOP - 42 + j * 12}" font-size="10" fill="#1e2430">${esc(l)}${j === 2 && name.length > 3 ? "…" : ""}</text>`).join("")
    + `<line x1="${x - COL / 2}" y1="${TOP - 56}" x2="${x - COL / 2}" y2="${height - 24}" stroke="#e4e1d8" stroke-dasharray="3 5"/></g>`;
}).join("");
const secs = sections.map((sec, k) => `<rect x="${LEFT + sec.from * COL}" y="${TOP - 90}" width="${(sec.to - sec.from) * COL}" height="28" fill="${k % 2 ? "#efece4" : "#f6f3ec"}"/><text x="${LEFT + sec.from * COL + 10}" y="${TOP - 71}" font-size="12.5" font-weight="700" fill="#1e2430">${esc(sec.title)}</text>`).join("");
const lanes = cast.map((who, k) => {
  const y = TOP + k * LANE, c = colour(who);
  return `<rect x="0" y="${y}" width="${width}" height="${LANE}" fill="${k % 2 ? "#faf9f6" : "#fff"}"/><line x1="0" y1="${y}" x2="${width}" y2="${y}" stroke="#e4e1d8"/>`
    + `<rect x="0" y="${y}" width="6" height="${LANE}" fill="${c}"/>`
    + `<text x="18" y="${y + 26}" font-size="15" font-weight="700" fill="${c}">${esc(who[0]!.toUpperCase() + who.slice(1))}</text>`
    + `<text x="18" y="${y + 44}" font-size="11.5" fill="#1e2430">${esc(`starts ${state(start.get(who)!)}`)}</text>`
    + `<text x="18" y="${y + 64}" font-size="9" fill="#9a978f" letter-spacing=".06em">HEARS ON</text>`
    + [...heardAll.get(who)!].map((d, j) => `<text x="18" y="${y + 77 + j * 11.5}" font-size="10" fill="#6b6b74" font-family="ui-monospace, Menlo, monospace">${esc(d)}</text>`).join("");
}).join("");
const markers = cast.map((who, k) => `<marker id="h${k}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="${colour(who)}"/></marker>`).join("");
const title = `<g transform="translate(${LEFT},26)"><text font-size="18" font-weight="700">Chat, end to end, as it runs</text>`
  + `<text y="20" font-size="11" fill="#6b6b74">Each story starts from the same cast · the move is in the teller's lane · every other lane shows what that person heard, on which document · ${report.passed} of ${report.passed + report.failed} stories pass</text>`
  + `<g transform="translate(0,34)" font-size="10.5">${chip(60, 0, "sees it on …", "#2f63bf", "#fff", "#1e2430")}<text x="128" y="4" fill="#6b6b74">the story says so</text>${chip(290, 0, "✗ does not see it", "#c9c5bb", "#f6f3ec", "#8a8a8a", true)}<text x="358" y="4" fill="#6b6b74">the story says not</text>${chip(530, 0, "hears on …", "#a86b00", "#fdf5e6", "#7a5200")}<text x="590" y="4" fill="#6b6b74">heard, and the story does not say so</text></g></g>`;

const svg = `<svg xmlns="http://www.w3.org/2000/svg" data-canvas="true" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="Helvetica Neue, Helvetica, Arial, sans-serif">
<defs>${markers}</defs><rect width="${width}" height="${height}" fill="#fff"/>
${lanes}${secs}${heads}${title}${lines.join("")}${parts.join("")}${checks.join("")}
</svg>`;
await Bun.write(`${dir}/dist/stories.svg`, svg);
console.log(JSON.stringify({ ok: report.failed === 0, warnings, order: ["stories"], watch: [STORIES] }));
process.exit(0);
