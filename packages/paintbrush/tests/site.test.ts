import { test, expect, afterAll, setDefaultTimeout } from "bun:test";
import { $ } from "bun";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { startServer } from "../src/server";
import { browser } from "./browser";
import iconPage from "./icon-page.html";

// Routes are tested with fetch, the page in a real browser with Bun.WebView, entry points by
// spawning them. Every route and everything a person sees or clicks has a test: the app's shell
// and status here, each resource in its own file (message.test.ts).
//
// Bun.WebView (experimental; follow these exactly):
// - evaluate() takes a string expression, not a function: view.evaluate("document.title").
//   Wrap statements in an IIFE string. Results come back as JSON; give them a type: evaluate<string>(...).
// - await every call. A view takes one navigate, evaluate, screenshot or input at a time, or throws ERR_INVALID_STATE.
// - click(selector) waits until the element is visible, stable and not covered. It does not scroll.
// - type() appends. To replace a field's text, use replaceText (browser.ts).
// - view.title is empty after the first navigate on macOS WebKit: read document.title with evaluate.
// - One WebView per file: browser() in browser.ts. A test that needs a second window uses withOtherWindow.
//   browser() makes the first navigation before the file's tests, and open() waits for the last to settle.
// - macOS uses the system WebKit. Linux needs Chrome, found through BUN_CHROME_PATH: CI and, in the
//   Claude Code web sandbox, .claude/hooks/session-start.sh set that up (see CLAUDE.md).

setDefaultTimeout(30_000); // first browser start can be slow

// The data folder is a scratch one, never the project's real data/
const dataDir = mkdtempSync(`${tmpdir()}/site-`);
// Spawned servers use this pid file, away from a running dev server's
const pidFile = `${import.meta.dir}/out/.server.pid`;
// The real `stop` script from package.json, run where that pid file lives
const pkg = await Bun.file(`${import.meta.dir}/../package.json`).json();
const stop = () => $`${{ raw: pkg.scripts.stop }}`.cwd(`${import.meta.dir}/out`).text();

const server = await startServer({ port: 0, dev: false, dataDir }); // random free port, no HMR
const { view, open, waitFor, failFetch, close } = browser(() => server.url);

afterAll(async () => {
  close();
  await server.stop(true);
  rmSync(dataDir, { recursive: true, force: true });
});

const api = (path: string, init?: RequestInit) => fetch(new URL(path, server.url), init);

// Read a spawned server's output until a line matches
async function readUntil(proc: Bun.Subprocess<"ignore", "pipe">, pattern: RegExp) {
  const reader = proc.stdout.getReader();
  let out = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) throw new Error(`Server exited before saying ${pattern}:\n${out}`);
      out += new TextDecoder().decode(value);
      const match = out.match(pattern);
      if (match) return match;
    }
  } finally {
    reader.releaseLock();
  }
}

// Run a server process on a random port; resolve once it prints its URL
async function spawnServer(cmd: string[], env: Record<string, string> = {}) {
  const proc = Bun.spawn(cmd, {
    cwd: `${import.meta.dir}/..`,
    env: { ...process.env, PORT: "0", PID_FILE: pidFile, DATA_PATH: dataDir, ...env },
    stdout: "pipe",
  });
  const url = (await readUntil(proc, /Listening on (\S+)/))[1]!;
  return { proc, url };
}

// --- The routes (each resource's are in its own test file) ---

test("GET /api/status answers what the server knows, but not where its data is", async () => {
  const status = await (await api("/api/status")).json();
  expect(status).toEqual({ persistent: false, uptime: expect.any(Number), bun: Bun.version });

  process.env.DATA_PATH = dataDir; // what a Railway volume sets
  try {
    expect(((await (await api("/api/status")).json()) as { persistent: boolean }).persistent).toBe(true);
  } finally {
    delete process.env.DATA_PATH;
  }
});

test("healthcheck answers ok", async () => {
  expect(await (await api("/health")).text()).toBe("ok");
});

test("unknown paths return 404", async () => {
  expect((await api("/nope")).status).toBe(404);
});

// --- The page, in a real browser ---

test("home page loads", async () => {
  await open();
  expect(await view.evaluate<string>("document.title")).toBe("Paintbrush");
  await waitFor(`document.querySelector("h1")?.textContent === "Message"`);
});

test("the Save button has its lucide icon, hidden from screen readers", async () => {
  await open();
  await waitFor(`document.querySelector("button.primary svg.icon")`);
  expect(await view.evaluate<string | null>(`document.querySelector("button.primary svg").getAttribute("aria-hidden")`)).toBe("true");
  expect(await view.evaluate<string>(`document.querySelector("button.primary").textContent.trim()`)).toBe("Save");
});

test("an Icon with a label is read out as an image, and one without is hidden", async () => {
  const fixture = Bun.serve({ port: 0, development: false, routes: { "/": iconPage } });
  try {
    await view.navigate(fixture.url.href);
    await waitFor(`document.querySelector("#alone svg.icon")`);
    const alone = await view.evaluate<[string | null, string | null, string | null]>(
      `(() => { const svg = document.querySelector("#alone svg"); return [svg.getAttribute("role"), svg.getAttribute("aria-label"), svg.getAttribute("aria-hidden")]; })()`,
    );
    expect(alone).toEqual(["img", "Close", null]);
    const beside = await view.evaluate<[string | null, string | null]>(
      `(() => { const svg = document.querySelector("#beside svg"); return [svg.getAttribute("role"), svg.getAttribute("aria-hidden")]; })()`,
    );
    expect(beside).toEqual([null, "true"]);
  } finally {
    await fixture.stop(true);
  }
});

test("the status line is shown", async () => {
  await open();
  await waitFor(`document.querySelector("#status .meta")?.textContent.includes("Bun ${Bun.version}")`);
  expect(await view.evaluate<string>(`document.querySelector("#status .help").textContent`)).toContain("ephemeral");
});

test("with DATA_PATH set, the status line says the data is on a mounted volume", async () => {
  process.env.DATA_PATH = dataDir; // what a Railway volume sets
  try {
    await open();
    await waitFor(`document.querySelector("#status .help")?.textContent.includes("mounted volume")`);
  } finally {
    delete process.env.DATA_PATH;
  }
});

test("a status that cannot be loaded says so", async () => {
  await open();
  await waitFor(`document.querySelector("#status .meta")`);
  await failFetch();
  // leave the page and come back: the view loads again, into a failing fetch
  await view.evaluate(`location.hash = "#/elsewhere"`);
  await waitFor(`document.body.textContent.includes("Page not found!")`);
  await view.evaluate(`location.hash = "#/"`);
  await waitFor(`document.body.textContent.includes("The status could not be loaded.")`);
});

test("a page that is not found links home", async () => {
  await open();
  await view.evaluate(`location.hash = "#/nowhere"`);
  await waitFor(`document.body.textContent.includes("Page not found!")`);
  await view.click("#app a");
  await waitFor(`document.querySelector("h1")?.textContent === "Message"`);
});

// --- The entry point and the sandbox hook ---

test("main.ts starts the server on $PORT", async () => {
  const { proc, url } = await spawnServer([process.execPath, "src/main.ts"]);
  try {
    expect((await fetch(new URL("/health", url))).status).toBe(200);
  } finally {
    proc.kill();
    await proc.exited;
  }
});

test("pid file: a second start is refused, stop stops the server", async () => {
  const { proc } = await spawnServer([process.execPath, "src/main.ts"]);
  expect(Number(await Bun.file(pidFile).text())).toBe(proc.pid);

  const second = Bun.spawn([process.execPath, "src/main.ts"], {
    cwd: `${import.meta.dir}/..`,
    env: { ...process.env, PORT: "0", PID_FILE: pidFile, DATA_PATH: dataDir },
    stderr: "pipe",
  });
  expect(await second.exited).toBe(1);
  expect(await new Response(second.stderr).text()).toContain("Already running");

  expect(await stop()).toContain(`stopped ${proc.pid}`);
  await proc.exited;
  expect(await Bun.file(pidFile).exists()).toBe(false);
  expect(await stop()).toContain("not running");
});

test("pid file: an empty file doesn't block start, and stop removes it", async () => {
  await Bun.write(pidFile, "");
  const { proc } = await spawnServer([process.execPath, "src/main.ts"]);
  proc.kill();
  await proc.exited;
  expect(await Bun.file(pidFile).exists()).toBe(false); // removed on shutdown

  await Bun.write(pidFile, "");
  expect(await stop()).toContain("removed stale pid file");
});

test("the web sandbox hook does nothing anywhere else", async () => {
  const { CLAUDE_CODE_REMOTE: _, ...env } = process.env;
  const hook = Bun.spawn(["bash", `${import.meta.dir}/../.claude/hooks/session-start.sh`], {
    env: { ...env, CLAUDE_PROJECT_DIR: `${import.meta.dir}/..` },
    stdout: "pipe",
    stderr: "pipe",
  });
  expect(await hook.exited).toBe(0);
  expect(await new Response(hook.stdout).text()).toBe("");
});

test("in production the page is served from source, without HMR", async () => {
  const { proc, url } = await spawnServer([process.execPath, "src/main.ts"], { NODE_ENV: "production" });
  try {
    const html = await (await fetch(url)).text();
    expect(html).toContain("<title>Paintbrush</title>");
    expect(html).not.toContain("data-bun-dev-server-script");
  } finally {
    proc.kill();
    await proc.exited;
  }
});

test("bun dev serves with hot reload, and a reload does not take its own pid file for another server", async () => {
  const { proc, url } = await spawnServer([process.execPath, "--hot", "src/main.ts"]);
  try {
    expect(await (await fetch(url)).text()).toContain("data-bun-dev-server-script"); // hot reload in the page
    expect(Number(await Bun.file(pidFile).text())).toBe(proc.pid);

    // A save: the same text written again (a touch, which changes only the time, is not one to --hot)
    const source = Bun.file(`${import.meta.dir}/../src/server.ts`);
    await Bun.write(source, await source.text());
    expect((await readUntil(proc, /Listening on (\S+)/))[1]).toBe(url); // main.ts ran again, in the same process

    expect((await fetch(url)).status).toBe(200);
    expect(Number(await Bun.file(pidFile).text())).toBe(proc.pid);
  } finally {
    proc.kill();
    await proc.exited;
  }
});
