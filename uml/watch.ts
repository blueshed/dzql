// The live UML session: ASCII UML in src/, SVG in dist/, and a page that shows them as they change.
//
//   docker compose up -d --wait   # PlantUML, on PLANTUML_PORT (8089)
//   bun watch.ts                  # renders src/ at start, watches it, serves the page on PORT (3700)
//
// A change to src/<name>.puml is posted to PlantUML and written to dist/<name>.svg; a deleted source
// takes its SVG with it. Every open page is told over a WebSocket and redraws. A diagram PlantUML
// cannot read comes back as an SVG that says why, and is shown like any other.

import { watch } from "node:fs";
import { readdir, rm } from "node:fs/promises";
import index from "./index.html";
import { check, kindOf, links, linkedTo, readTypes, undrawn, withLinks, type Kind, type Types } from "./check";

const dir = import.meta.dir;
const SRC = `${dir}/src`, DIST = `${dir}/dist`;
const PLANTUML = process.env.PLANTUML_URL ?? `http://localhost:${process.env.PLANTUML_PORT ?? 8089}`;
const PORT = Number(process.env.PORT ?? 3700);

type Diagram = { name: string; ok: boolean; at: number; error?: string; kind?: Kind; drift?: string[] };
const diagrams = new Map<string, Diagram>();

// types.ts: every name the diagrams use. Each diagram is checked against it; a change to it
// re-checks them all.
const TYPES = `${dir}/types.ts`;
let types: Types = { interfaces: new Map(), unions: new Map(), documents: [], writes: [] };
const checked = new Map<string, ReturnType<typeof check>>();
async function loadTypes() {
  const f = Bun.file(TYPES);
  types = readTypes((await f.exists()) ? await f.text() : "");
}
async function checkOne(name: string, file: string) {
  const c = check(name, await Bun.file(`${SRC}/${file}`).text(), types);
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
  const drifting = [...checked.values()].filter((c) => c.drift.length);
  console.log(drifting.length ? `≠ types.ts: ${drifting.map((c) => `${c.name} (${c.drift.length})`).join(", ")}` : "= types.ts: every diagram agrees");
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
    await rm(`${DIST}/${name}.svg`, { force: true });
    return tell({ type: "removed", name });
  }
  const text = await source.text();
  const kind = kindOf(text);
  // A use case links to its write's sequence, a document class to its example: worked out as drawn.
  const drawn = links(kind) ? withLinks(text, types, await everyChecked()) : text;
  try {
    const res = await fetch(`${PLANTUML}/svg`, { method: "POST", headers: { "Content-Type": "text/plain; charset=utf-8" }, body: drawn });
    const svg = await res.text();
    if (!svg.includes("<svg")) throw new Error(`PlantUML answered ${res.status} without an SVG`);
    await Bun.write(`${DIST}/${name}.svg`, svg);
    // PlantUML answers a diagram it cannot read with 400 and an SVG that says why.
    const d: Diagram = { name, ok: res.ok, at: Date.now(), ...(res.ok ? {} : { error: res.headers.get("x-plantuml-diagram-error") ?? "PlantUML could not read it" }) };
    diagrams.set(name, d);
    await checkOne(name, file);
    console.log(`${res.ok ? "✓" : "✗"} ${name}.svg${d.error ? ` — ${d.error}` : ""}${d.drift?.length ? ` — drifts from types.ts: ${d.drift.join("; ")}` : ""}`);
    tell({ type: "changed", diagram: d });
    if (linkedTo(kind)) await redrawLinking();
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
    "/list": () => Response.json([...diagrams.values()].sort((a, b) => a.name.localeCompare(b.name))),
    "/svg/:name": async (req) => {
      const f = Bun.file(`${DIST}/${req.params.name}.svg`);
      return (await f.exists()) ? new Response(f, { headers: { "Content-Type": "image/svg+xml", "Cache-Control": "no-store" } }) : new Response("no such diagram", { status: 404 });
    },
    "/src/:name": async (req) => {
      const files = (await readdir(SRC)).filter((f) => isSource(f) && nameOf(f) === req.params.name);
      return files[0] ? new Response(Bun.file(`${SRC}/${files[0]}`), { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } }) : new Response("no such source", { status: 404 });
    },
    "/types": async () => {
      const f = Bun.file(TYPES);
      return Response.json({ source: (await f.exists()) ? await f.text() : "", undrawn: undrawn(types, [...checked.values()]) });
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
    await redrawLinking();
  }, 120);
});

console.log(`UML session on ${server.url} — watching ${SRC}, PlantUML at ${PLANTUML}`);
