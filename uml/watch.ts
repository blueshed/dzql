// The live UML session: ASCII UML in src/, SVG in dist/, and a page that shows them as they change.
//
//   docker compose up -d --wait   # PlantUML, on PLANTUML_PORT (8089)
//   bun watch.ts                  # renders src/ at start, watches it, serves the page on PORT (3700)
//   bun watch.ts londons        # the same for a model in its own folder: londons/src, londons/dist
//
// A change to src/<name>.puml is posted to PlantUML and written to dist/<name>.svg; a deleted source
// takes its SVG with it. Every open page is told over a WebSocket and redraws. A diagram PlantUML
// cannot read comes back as an SVG that says why, and is shown like any other.
//
// A model is checked against its vocabulary: types.ts, or, where the folder has a stories.ts, the
// stories themselves -- each agreement's arrows cite the stories that move it (agreements.ts).

import { watch } from "node:fs";
import { readdir, rm } from "node:fs/promises";
import index from "./index.html";
import { resolve } from "node:path";
import { checkAgreement, markAgreement, numbered, uncited, type Story } from "./agreements";
import { asDrawn, check, kindOf, links, linkedTo, readTypes, typesFindings, undrawn, type Kind, type Types } from "./check";

const dir = import.meta.dir + (process.argv[2] ? `/${process.argv[2]}` : "");
const SRC = `${dir}/src`, DIST = `${dir}/dist`;
// A model's stories are read afresh in a child bun whenever their file changes: an import is cached.
const STORIES = `${dir}/stories.ts`;
let stories: Story[] | null = null;
function loadStories() {
  const read = Bun.spawnSync(["bun", "-e", `const { stories } = await import(${JSON.stringify(STORIES)}); console.log(JSON.stringify(stories.stories))`]);
  if (read.exitCode === 0) stories = JSON.parse(read.stdout.toString());
  else console.error(`✗ stories.ts: ${read.stderr.toString().trim()}`);
}
if (await Bun.file(STORIES).exists()) loadStories();

// A model with a canvas.ts draws itself end to end on one canvas (dist/stories.svg): Londons from
// its agreements, chat from a real run of its stories. It is drawn again whenever a diagram, the
// vocabulary, the canvas, or a file the canvas says it is drawn from changes; it also gives the
// diagrams their order.
const CANVAS = `${dir}/canvas.ts`;
let order: string[] = [];
const rank = (name: string) => (order.includes(name) ? order.indexOf(name) : order.length);
let canvasTimer: Timer | undefined;
const watching = new Set<string>(); // what else the canvas is drawn from, as it says
function canvasSoon() {
  clearTimeout(canvasTimer);
  canvasTimer = setTimeout(async () => {
    if (!(await Bun.file(CANVAS).exists())) return;
    const drew = Bun.spawnSync(["bun", CANVAS]);
    // the canvas's report is its last line: a run it makes may log before it
    const last = drew.stdout.toString().trim().split("\n").at(-1) ?? "";
    const out = drew.exitCode === 0 && last.startsWith("{") ? JSON.parse(last) : { ok: false, warnings: [], error: drew.stderr.toString().trim().split("\n").slice(-3).join(" ") };
    order = out.order ?? order;
    for (const f of out.watch ?? []) if (!watching.has(f)) { watching.add(f); watch(f, () => canvasSoon()); }
    const d: Diagram = { name: "stories", ok: out.ok, at: Date.now(), kind: "canvas" as Kind, drift: out.warnings, ...(out.error ? { error: out.error } : {}) };
    diagrams.set("stories", d);
    console.log(`${d.ok ? "✓" : "✗"} stories.svg (the canvas)${d.error ? ` — ${d.error}` : ""}${d.drift?.length ? ` — ${d.drift.join("; ")}` : ""}`);
    tell({ type: "changed", diagram: d });
  }, 250);
}
const cited = new Map<string, Set<number>>();
const PLANTUML = process.env.PLANTUML_URL ?? `http://localhost:${process.env.PLANTUML_PORT ?? 8089}`;
const PORT = Number(process.env.PORT ?? 3700);
const against = stories ? "the stories" : "types.ts";

type Diagram = { name: string; ok: boolean; at: number; error?: string; kind?: Kind; drift?: string[] };
const diagrams = new Map<string, Diagram>();

// types.ts: every name the diagrams use. Each diagram is checked against it; a change to it
// re-checks them all.
const TYPES = `${dir}/types.ts`;
let types = readTypes("");
const checked = new Map<string, ReturnType<typeof check>>();
async function loadTypes() {
  const f = Bun.file(TYPES);
  types = readTypes((await f.exists()) ? await f.text() : "");
}
async function checkOne(name: string, file: string) {
  const text = await Bun.file(`${SRC}/${file}`).text();
  if (stories) {
    const a = checkAgreement(text, stories);
    cited.set(name, a.cited);
    const d = diagrams.get(name);
    if (d) Object.assign(d, { kind: kindOf(text), drift: a.drift });
    return;
  }
  const c = check(name, text, types);
  checked.set(name, c);
  const d = diagrams.get(name);
  if (d) Object.assign(d, { kind: c.kind, drift: c.drift });
}
async function everyChecked() {
  const all = [];
  for (const f of await readdir(SRC)) if (isSource(f)) all.push(check(nameOf(f), await Bun.file(`${SRC}/${f}`).text(), types));
  return all;
}
/** Draw again every diagram that links to others. */
async function redrawLinking() {
  for (const f of await readdir(SRC)) if (isSource(f) && links(kindOf(await Bun.file(`${SRC}/${f}`).text()))) soon(f);
}
async function checkAll() {
  for (const f of await readdir(SRC)) if (isSource(f)) await checkOne(nameOf(f), f);
  const drifting = [...diagrams.values()].filter((c) => c.drift?.length);
  console.log(drifting.length ? `≠ ${against}: ${drifting.map((c) => `${c.name} (${c.drift!.length})`).join(", ")}` : `= ${against}: every diagram agrees`);
  tell({ type: "checked" });
}

const isSource = (f: string) => /\.(puml|plantuml|pu|uml)$/.test(f);
const nameOf = (f: string) => f.replace(/\.[^.]+$/, "");

async function render(file: string): Promise<void> {
  const name = nameOf(file);
  const source = Bun.file(`${SRC}/${file}`);
  if (!(await source.exists())) {
    diagrams.delete(name);
    checked.delete(name);
    cited.delete(name);
    await rm(`${DIST}/${name}.svg`, { force: true });
    return tell({ type: "removed", name });
  }
  const text = await source.text();
  const kind = kindOf(text);
  // A use case links to its write's sequence, a document class to its example: worked out as drawn.
  const drawn = stories ? markAgreement(text, name, stories) : asDrawn(text, name, types, links(kind) ? await everyChecked() : []);
  try {
    const res = await fetch(`${PLANTUML}/svg`, { method: "POST", headers: { "Content-Type": "text/plain; charset=utf-8" }, body: drawn });
    const svg = await res.text();
    if (!svg.includes("<svg")) throw new Error(`PlantUML answered ${res.status} without an SVG`);
    await Bun.write(`${DIST}/${name}.svg`, svg);
    // PlantUML answers a diagram it cannot read with 400 and an SVG that says why.
    const d: Diagram = { name, ok: res.ok, at: Date.now(), ...(res.ok ? {} : { error: res.headers.get("x-plantuml-diagram-error") ?? "PlantUML could not read it" }) };
    diagrams.set(name, d);
    await checkOne(name, file);
    console.log(`${res.ok ? "✓" : "✗"} ${name}.svg${d.error ? ` — ${d.error}` : ""}${d.drift?.length ? ` — drifts from ${against}: ${d.drift.join("; ")}` : ""}`);
    tell({ type: "changed", diagram: d });
    if (!stories && linkedTo(kind)) await redrawLinking();
    canvasSoon();
  } catch (e) {
    const d: Diagram = { name, ok: false, at: Date.now(), error: `PlantUML is not answering at ${PLANTUML} (${(e as Error).message}). Is it up? docker compose up -d --wait` };
    diagrams.set(name, d);
    console.error(`✗ ${name}: ${d.error}`);
    tell({ type: "changed", diagram: d });
  }
}

// Editors save in bursts (write, rename, touch): wait for the file to settle before rendering.
const pending = new Map<string, Timer>();
function soon(file: string) {
  clearTimeout(pending.get(file));
  pending.set(file, setTimeout(() => (pending.delete(file), render(file)), 120));
}

const server = Bun.serve({
  port: PORT,
  routes: {
    "/": index,
    "/list": () => Response.json([...diagrams.values()].sort((a, b) => rank(a.name) - rank(b.name) || a.name.localeCompare(b.name))),
    "/svg/:name": async (req) => {
      const f = Bun.file(`${DIST}/${req.params.name}.svg`);
      return (await f.exists()) ? new Response(f, { headers: { "Content-Type": "image/svg+xml", "Cache-Control": "no-store" } }) : new Response("no such diagram", { status: 404 });
    },
    "/src/:name": async (req) => {
      if (req.params.name === "stories" && (await Bun.file(CANVAS).exists())) return new Response(Bun.file(CANVAS), { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
      const files = (await readdir(SRC)).filter((f) => isSource(f) && nameOf(f) === req.params.name);
      return files[0] ? new Response(Bun.file(`${SRC}/${files[0]}`), { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } }) : new Response("no such source", { status: 404 });
    },
    "/types": async () => {
      if (stories) {
        const all = new Set([...cited.values()].flatMap((s) => [...s]));
        return Response.json({ label: "stories.ts", about: "every arrow cites the stories that move it", against: "the stories", source: numbered(stories), undrawn: uncited(stories, all), findings: [] });
      }
      const f = Bun.file(TYPES);
      return Response.json({ label: "types.ts", about: "every name the diagrams use", against: "types.ts", source: (await f.exists()) ? await f.text() : "", undrawn: undrawn(types, [...checked.values()]), findings: typesFindings(types) });
    },
    "/live": (req, srv) => (srv.upgrade(req) ? undefined : new Response("expected a WebSocket", { status: 400 })),
  },
  websocket: {
    open(ws) { ws.subscribe("uml"); },
    message() {},
  },
});
function tell(message: object) { server.publish("uml", JSON.stringify(message)); }

await loadTypes();
for (const f of await readdir(SRC)) if (isSource(f)) await render(f);
await checkAll();
watch(SRC, (_event, file) => { if (file && isSource(file)) soon(file); });
let typesTimer: Timer | undefined;
watch(dir, (_event, file) => {
  if (file !== "types.ts") return;
  clearTimeout(typesTimer);
  typesTimer = setTimeout(async () => {
    await loadTypes();
    await checkAll();
    canvasSoon();
    for (const f of await readdir(SRC)) if (isSource(f)) soon(f); // flavours and links follow types.ts
  }, 120);
});

canvasSoon();
watch(dir, (_event, file) => { if (file === "canvas.ts") canvasSoon(); });

// stories.ts re-exports the example's stories: watch the file they are told in.
if (stories) {
  const told = (await Bun.file(STORIES).text()).match(/from\s+"([^"]+)"/)?.[1];
  const file = told ? resolve(dir, told.endsWith(".ts") ? told : `${told}.ts`) : STORIES;
  let storiesTimer: Timer | undefined;
  watch(file, () => {
    clearTimeout(storiesTimer);
    storiesTimer = setTimeout(async () => {
      loadStories();
      await checkAll();
      canvasSoon();
      for (const f of await readdir(SRC)) if (isSource(f)) soon(f);
    }, 120);
  });
}

console.log(`UML session on ${server.url} — watching ${SRC}, PlantUML at ${PLANTUML}`);
