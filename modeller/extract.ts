// DB_PATH=:memory: bun modeller/extract.ts wedding wedding.json
//
// The facts a modeller page shows, read from an example as it stands: its stories, its delta.ts
// (tables, and documents as root + include), its compartments' permit rules, and what the harness
// says when it runs the stories. Nothing here is proposed; everything is read.

import type { Stories, Story } from "../src/stories";
import { parsePointer } from "../src/json-pointer";
import { run, type Heard, type Trace } from "../src/harness";

const name = process.argv[2] ?? "wedding";
const dir = `${import.meta.dir}/../examples/${name}`;
const { stories } = (await import(`${dir}/stories.ts`)) as { stories: Stories };
const deltaMod = await import(`${dir}/delta.ts`);
const deltaSrc = await Bun.file(`${dir}/delta.ts`).text();

// ── tables: delta.ts's schema ──
type Column = { type: string; nullable?: boolean };
// Where each table is touched outside delta.ts and the documents delta composes: the seed that
// makes its rows, and any code that reads or writes it with its own SQL. A table the stories never
// reach but code does is how a concept arrives without a story.
const glob = new Bun.Glob("**/*.{ts,sql}");
const files: { path: string; lines: string[] }[] = [];
for await (const f of glob.scan(dir)) {
  if (f.includes(".test.") || f === "delta.ts") continue;
  files.push({ path: f, lines: (await Bun.file(`${dir}/${f}`).text()).split("\n") });
}
const touches = (sqlName: string) =>
  files.flatMap(({ path, lines }) =>
    lines.flatMap((line, i) => (new RegExp(`\\b${sqlName}\\b`).test(line) ? [{ at: `${path}:${i + 1}`, seed: path.endsWith(".sql"), line: line.trim().slice(0, 140) }] : [])),
  );
const tables = Object.entries(deltaMod.schema.tables as Record<string, { name: string; parent?: { collection: string }; columns: Record<string, Column> }>).map(([key, t]) => ({
  name: key,
  parent: t.parent?.collection ?? null,
  columns: Object.entries(t.columns).map(([c, def]) => ({ name: c, type: def.type + (def.nullable ? "?" : "") })),
  code: touches(t.name),
}));

// ── documents: the defineDoc / registerMemory calls in delta.ts ──
const consts = new Map<string, string[]>();
for (const m of deltaSrc.matchAll(/const (\w+) = \[([^\]]*)\]/g)) consts.set(m[1]!, [...m[2]!.matchAll(/"(\w+)"/g)].map((x) => x[1]!));
const documents: { name: string; root: string | null; include: string[]; kind: string; note: string }[] = [];
for (const m of deltaSrc.matchAll(/defineDoc\("(\w+):", \{ root: "(\w+)", include: (\[[^\]]*\]|\w+)(, implied: true)? \}\)/g)) {
  const raw = m[3]!;
  const include = raw.startsWith("[")
    ? raw.slice(1, -1).split(",").map((s) => s.trim()).filter(Boolean).flatMap((s) => (s.startsWith("...") ? consts.get(s.slice(3)) ?? [] : [s.replace(/"/g, "")]))
    : consts.get(raw) ?? [];
  const isVisit = !!m[4];
  documents.push({ name: m[1]!, root: m[2]!, include, kind: isVisit ? "written, no ledger" : "written", note: isVisit ? "the tray: where a visit is" : "" });
}
for (const m of deltaSrc.matchAll(/registerMemory\(delta\.server, \{ prefix: "(\w+):"/g)) documents.push({ name: m[1]!, root: null, include: [], kind: "live", note: "kept by the server, in memory" });

// ── permits: each compartment's RULES, as written ──
const permits: { doc: string; path: string; ops: string[]; dated: boolean }[] = [];
for (const doc of documents.map((d) => d.name)) {
  const file = Bun.file(`${dir}/compartments/${doc}.ts`);
  if (!(await file.exists())) continue;
  const src = await file.text();
  const body = src.match(/const RULES: Rule\[\] = (\[[\s\S]*?\n\]);/)?.[1];
  if (!body) continue;
  const pre = [...src.matchAll(/^const (LIST|CHILD) = "[^"]*";$/gm)].map((m) => m[0]).join("\n");
  const rules = new Function(`${pre}\nreturn ${body};`)() as { path: RegExp; ops: string[]; dated?: boolean }[];
  for (const r of rules) permits.push({ doc, path: r.path.source, ops: r.ops, dated: !!r.dated });
}

// ── stories, with each write placed on its document's tables ──
const docByName = new Map(documents.map((d) => [d.name, d]));
function place(doc: string, path: string): { table: string | null; field: string | null } {
  const d = docByName.get(doc);
  if (!d?.root) return { table: null, field: parsePointer(path)[0] ?? null };
  const known = new Set([d.root, ...d.include]);
  let table = d.root;
  let field: string | null = null;
  for (const seg of parsePointer(path)) {
    if (seg === "-" || /^\d+$/.test(seg)) continue;
    if (known.has(seg)) table = seg;
    else {
      field = seg;
      break;
    }
  }
  return { table, field };
}
const tray = stories.at?.("").doc ?? null;
const permitted = (doc: string, op: string, path: string) => permits.some((p) => p.doc === doc && p.ops.includes(op) && new RegExp(p.path).test(path));

// Every write the run makes, as the wire carried it: for a sequence drawn from a real run.
const traces = new Map<string, Trace[]>();
const report = await run((await import(`${dir}/index.ts`)).example, stories, (t) => traces.set(t.story, [...(traces.get(t.story) ?? []), t]));
const partKey = (target: string) => target.match(/data-eta-part="([^"]+)"/)?.[1] ?? target;
const heardAs = (m: Heard) =>
  m.type === "render"
    ? m.html !== undefined
      ? { kind: "page", bytes: JSON.stringify(m).length }
      : { kind: "parts", parts: (m.ops ?? []).map((o) => `${o.op} ${partKey(o.target)}`), bytes: JSON.stringify(m).length }
    : m.type === "patch"
      ? { kind: "patch", doc: m.doc, ops: (m.ops ?? []).length, bytes: JSON.stringify(m).length }
      : { kind: m.type, bytes: JSON.stringify(m).length };
const outcome = new Map(report.outcomes.map((o) => [o.name, o.failures]));

const storyRows = stories.stories.map((s: Story, i) => {
  const w = "does" in s ? s.does : s.cannot;
  const seen = "does" in s ? (Array.isArray(s.seen) ? Object.fromEntries(s.seen.map((m) => [m, null])) : s.seen) : {};
  return {
    n: i + 1,
    name: s.name,
    as: s.as,
    kind: "does" in s ? "does" : "cannot",
    doc: w.doc,
    tray: w.doc === tray,
    ops: w.ops.map((op) => ({ op: op.op, path: op.path, ...place(w.doc, op.path), permitted: permitted(w.doc, op.op, op.path) })),
    seen,
    unseen: "does" in s ? s.unseen ?? [] : [],
    failures: outcome.get(s.name) ?? ["not run"],
    sequence: (traces.get(s.name) ?? []).map((t) => ({
      phase: t.phase,
      as: t.as,
      write: t.write,
      ledger: t.ledger,
      heard: t.heard.map((h) => ({ member: h.member, messages: h.messages.map(heardAs) })),
    })),
  };
});

const cast = Object.keys(stories.cast);
const castSetup = Object.fromEntries(cast.map((m) => [m, stories.cast[m]!.flatMap((w) => w.ops.map((o) => `${w.doc} ${o.path} = ${"value" in o ? JSON.stringify(o.value) : ""}`))]));
for (const s of storyRows) if (!cast.includes(s.as)) cast.push(s.as);

let tasks: { n: number; status: string; summary: string; area: string }[] = [];
const todo = Bun.file(`${import.meta.dir}/../todo.jsonl`);
if (await todo.exists()) tasks = (await todo.text()).split("\n").filter(Boolean).map((l) => JSON.parse(l)).map((t) => ({ n: t.n, status: t.status, summary: t.summary, area: t.area }));

// Written to a file, not stdout: an example may log while its stories run.
await Bun.write(process.argv[3] ?? `${name}.json`, JSON.stringify({ example: name, tray, cast, castSetup, tables, documents, permits, stories: storyRows, harness: { passed: report.passed, failed: report.failed }, tasks }));
process.exit(0);
