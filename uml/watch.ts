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

const dir = import.meta.dir;
const SRC = `${dir}/src`, DIST = `${dir}/dist`;
const PLANTUML = process.env.PLANTUML_URL ?? `http://localhost:${process.env.PLANTUML_PORT ?? 8089}`;
const PORT = Number(process.env.PORT ?? 3700);

type Diagram = { name: string; ok: boolean; at: number; error?: string };
const diagrams = new Map<string, Diagram>();

const isSource = (f: string) => /\.(puml|plantuml|pu|uml)$/.test(f);
const nameOf = (f: string) => f.replace(/\.[^.]+$/, "");

async function render(file: string): Promise<void> {
  const name = nameOf(file);
  const source = Bun.file(`${SRC}/${file}`);
  if (!(await source.exists())) {
    diagrams.delete(name);
    await rm(`${DIST}/${name}.svg`, { force: true });
    return tell({ type: "removed", name });
  }
  const text = await source.text();
  try {
    const res = await fetch(`${PLANTUML}/svg`, { method: "POST", headers: { "Content-Type": "text/plain; charset=utf-8" }, body: text });
    const svg = await res.text();
    if (!svg.includes("<svg")) throw new Error(`PlantUML answered ${res.status} without an SVG`);
    await Bun.write(`${DIST}/${name}.svg`, svg);
    // PlantUML answers a diagram it cannot read with 400 and an SVG that says why.
    const d: Diagram = { name, ok: res.ok, at: Date.now(), ...(res.ok ? {} : { error: res.headers.get("x-plantuml-diagram-error") ?? "PlantUML could not read it" }) };
    diagrams.set(name, d);
    console.log(`${res.ok ? "✓" : "✗"} ${name}.svg${d.error ? ` — ${d.error}` : ""}`);
    tell({ type: "changed", diagram: d });
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
    "/live": (req, srv) => (srv.upgrade(req) ? undefined : new Response("expected a WebSocket", { status: 400 })),
  },
  websocket: {
    open(ws) { ws.subscribe("uml"); },
    message() {},
  },
});
function tell(message: object) { server.publish("uml", JSON.stringify(message)); }

for (const f of await readdir(SRC)) if (isSource(f)) await render(f);
watch(SRC, (_event, file) => { if (file && isSource(file)) soon(file); });

console.log(`UML session on ${server.url} — watching ${SRC}, PlantUML at ${PLANTUML}`);
