/**
 * The skill's recipe runs as written: each of reference/recipe.md's blocks under a file's
 * heading (`routes.ts`, `resources/room/room-api.ts`, ..., `tsconfig.json`), saved at that path
 * in a folder inside the package (so `@blueshed/delta/...` resolves to this source, as from
 * node_modules).
 * The server runs on a free port; each browser is a Bun process with
 * happy-dom for the page and Bun's own WebSocket. One types a message and
 * submits the form, and the other's `#log` shows it.
 */
import { expect, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { until, type Proc } from "./helpers/examples";
import { blockAfter as blockOf } from "./helpers/markdown";
import { waitFor } from "../src/testing";

const skill = await Bun.file(new URL("../.claude/skills/delta-doc/reference/recipe.md", import.meta.url)).text();

const blockAfter = (marker: string) => blockOf(skill, marker, "reference/recipe.md");

/** One browser: the recipe's page in happy-dom, its app.tsx, then (if asked) a message typed and sent; it exits once `#log` shows `HEAR`, or fails after 5 s. */
const BROWSER = `
import { GlobalRegistrator } from "@happy-dom/global-registrator";
const Native = globalThis.WebSocket;
GlobalRegistrator.register({ url: "http://localhost:" + process.env.PORT + "/" });
globalThis.WebSocket = Native;
const html = await Bun.file(new URL("./index.html", import.meta.url)).text();
document.body.innerHTML = html.replace(/<!doctype html>/i, "").replace(/<script[^>]*><\\/script>/, "");
await import("./app.tsx");
if (process.env.SAY) {
  const form = document.getElementById("say");
  form.elements.namedItem("text").value = process.env.SAY;
  form.dispatchEvent(new Event("submit", { cancelable: true }));
}
console.log("ready");
const log = document.getElementById("log");
for (let i = 0; i < 500 && !log.textContent.includes(process.env.HEAR); i++) await Bun.sleep(10);
if (!log.textContent.includes(process.env.HEAR)) { console.log("never heard; #log is " + JSON.stringify(log.textContent)); process.exit(1); }
console.log("heard " + log.textContent);
process.exit(0);
`;

test("the recipe (reference/recipe.md), as written: one browser sends a message, the other's page shows it", async () => {
  const dir = new URL(`./.recipe-${process.pid}/`, import.meta.url).pathname;
  mkdirSync(dir, { recursive: true });
  const procs: Proc[] = [];
  const spawn = (file: string, env: Record<string, string> = {}) => {
    const p = Bun.spawn(["bun", file], { cwd: dir, env: { ...process.env, ...env }, stdout: "pipe", stderr: "pipe" });
    procs.push(p);
    return p;
  };
  try {
    const files = [...skill.matchAll(/^### `([^`]+)`$/gm)].map((m) => m[1]!);
    expect(files).toEqual(["routes.ts", "resources/room/room-api.ts", "resources/room/room.ts", "resources/room/room-view.tsx", "app.tsx", "index.html", "tsconfig.json"]);
    for (const file of files) await Bun.write(join(dir, file), blockAfter(`### \`${file}\``));   // Bun.write makes the folders
    const routes = blockAfter("### `routes.ts`");
    expect(routes).toContain("{ port: 3100 }");   // the one change: a free port, which run says on stdout
    await Bun.write(join(dir, "routes.ts"), routes.replace("{ port: 3100 }", "{ port: 0 }"));
    await Bun.write(join(dir, "browser.ts"), BROWSER);

    const [, port] = await until(spawn("routes.ts"), /Listening on http:\/\/[^/]*:(\d+)/);
    const reader = spawn("browser.ts", { PORT: port!, HEAR: "hello from ada" });
    await until(reader, /ready/);
    const writer = spawn("browser.ts", { PORT: port!, HEAR: "hello from ada", SAY: "hello from ada" });
    expect((await until(writer, /heard (.*)/))[1]).toBe("me hello from ada");
    expect((await until(reader, /heard (.*)/))[1]).toBe("me hello from ada");   // author, then text
    // the room is kept in the JSON file (saved after the change is told)
    await waitFor(async () => (await Bun.file(join(dir, "chat.json")).text()).includes("hello from ada"));
  } finally {
    for (const p of procs) p.kill();
    await Promise.all(procs.map((p) => p.exited));
    rmSync(dir, { recursive: true, force: true });
  }
}, 20_000);
