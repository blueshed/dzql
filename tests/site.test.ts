import { test, expect, beforeAll, afterAll, setDefaultTimeout } from "bun:test";
import { $ } from "bun";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { startServer } from "../src/server";

// Routes are tested with fetch, the page in a real browser with Bun.WebView, entry points by
// spawning them. Every route and everything a person sees or clicks has a test.
//
// Bun.WebView (experimental; follow these exactly):
// - evaluate() takes a string expression, not a function: view.evaluate("document.title").
//   Wrap statements in an IIFE string. Results come back as JSON; give them a type: evaluate<string>(...).
// - await every call. A view takes one navigate, evaluate, screenshot or input at a time, or throws ERR_INVALID_STATE.
// - click(selector) waits until the element is visible, stable and not covered. It does not scroll.
// - type() appends. To replace a field's text, use replaceText below.
// - view.title is empty after the first navigate on macOS WebKit: read document.title with evaluate.
// - One WebView per file. A test that needs a second window opens its own and closes it in a finally.
// - macOS uses the system WebKit. Linux needs Chrome, found through BUN_CHROME_PATH: CI and, in the
//   Claude Code web sandbox, .claude/hooks/session-start.sh set that up (see CLAUDE.md).

setDefaultTimeout(30_000); // first browser start can be slow

// The data folder is a scratch one, never the project's real data/
const dataDir = mkdtempSync(`${tmpdir()}/paintbrush-`);
// Spawned servers use this pid file, away from a running dev server's
const pidFile = `${import.meta.dir}/out/.server.pid`;
// The real `stop` script from package.json, run where that pid file lives
const pkg = await Bun.file(`${import.meta.dir}/../package.json`).json();
const stop = () => $`${{ raw: pkg.scripts.stop }}`.cwd(`${import.meta.dir}/out`).text();

let server: ReturnType<typeof startServer>;
let view: Bun.WebView;

beforeAll(() => {
  server = startServer({ port: 0, dev: false, dataDir }); // random free port, no HMR
  view = new Bun.WebView({ width: 1280, height: 800, console: globalThis.console });
});

afterAll(async () => {
  view?.close();
  await server?.stop(true);
  rmSync(dataDir, { recursive: true, force: true });
});

// --- Helpers ---

const api = (path: string, init?: RequestInit) => fetch(new URL(path, server.url), init);
const putMessage = (body: string) => api("/api/message", { method: "PUT", body });

// Load the page afresh. Navigating to the URL the view is already at does not reload it,
// so each visit gets a query of its own (the route ignores it).
let visits = 0;
const open = () => view.navigate(`${server.url.href}?visit=${++visits}`);

// Poll a page-side expression until it is truthy
async function waitFor(expr: string, timeout = 5_000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await view.evaluate(`Boolean(${expr})`)) return;
    await Bun.sleep(50);
  }
  throw new Error(`Timed out waiting for: ${expr}`);
}

// Replace what is in a field the way typing would: clear it (and tell the page), then type
async function replaceText(selector: string, text: string) {
  await view.evaluate(`(() => { const el = document.querySelector("${selector}"); el.value = ""; el.dispatchEvent(new Event("input")); })()`);
  await view.click(selector);
  await view.type(text);
}

// Make every fetch the page makes from now on answer 500, to see what a person sees when the server says no
const failFetch = () => view.evaluate(`window.fetch = async () => new Response(null, { status: 500 })`);

// Run a server process on a random port; resolve once it prints its URL
async function spawnServer(cmd: string[], env: Record<string, string> = {}) {
  const proc = Bun.spawn(cmd, {
    cwd: `${import.meta.dir}/..`,
    env: { ...process.env, PORT: "0", PID_FILE: pidFile, DATA_PATH: dataDir, ...env },
    stdout: "pipe",
  });
  const reader = proc.stdout.getReader();
  let out = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) throw new Error(`Server exited without listening:\n${out}`);
    out += new TextDecoder().decode(value);
    const url = out.match(/Listening on (\S+)/)?.[1];
    if (url) {
      reader.releaseLock();
      return { proc, url };
    }
  }
}

// --- The routes ---
// Tests run in file order: the first one needs a data folder nothing has been saved to.

test("GET /api/message answers the default before anything is saved", async () => {
  const res = await api("/api/message");
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ message: "Hello" });
});

test("PUT /api/message stores the message and GET answers it", async () => {
  const put = await putMessage(JSON.stringify({ message: "saved" }));
  expect(put.status).toBe(200);
  expect(await put.json()).toEqual({ message: "saved" });
  expect(await (await api("/api/message")).json()).toEqual({ message: "saved" });
  expect(await Bun.file(`${dataDir}/message.json`).json()).toEqual({ message: "saved" });
});

test("PUT /api/message refuses a body that is not a message, and keeps the old one", async () => {
  for (const body of ["not json", "{}", JSON.stringify({ message: 1 })]) {
    const res = await putMessage(body);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "message must be a string" });
  }
  expect(await (await api("/api/message")).json()).toEqual({ message: "saved" });
});

test("a BunFile keeps the size it first saw, which is why message-api makes a new one per read", async () => {
  const path = `${dataDir}/stale.json`;
  const stale = Bun.file(path);
  expect(await stale.exists()).toBe(false);
  await Bun.write(path, JSON.stringify({ message: "written" }));
  expect(await stale.exists()).toBe(true);
  expect(await stale.text()).toBe(""); // the size it saw: none
  expect(await Bun.file(path).json()).toEqual({ message: "written" });
});

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

test("/ws upgrades, and a socket is told every saved message", async () => {
  expect((await api("/ws")).status).toBe(426); // plain HTTP

  const ws = new WebSocket(new URL("/ws", server.url.href.replace("http", "ws")));
  await new Promise((open) => (ws.onopen = open));
  ws.send("ignored"); // the page only listens; the server takes no notice
  const told = new Promise<string>((done) => (ws.onmessage = (e) => done(String(e.data))));
  await putMessage(JSON.stringify({ message: "pushed" }));
  expect(JSON.parse(await told)).toEqual({ message: "pushed" });
  ws.close();
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

test("the saved message is in the box", async () => {
  await putMessage(JSON.stringify({ message: "in the box" }));
  await open();
  await waitFor(`document.querySelector("textarea")?.value === "in the box"`);
});

test("saving says Saved once the server has it, and the message survives a reload", async () => {
  await open();
  await waitFor(`document.querySelector("textarea")?.value === "in the box"`);
  await replaceText("textarea", "typed in the browser");
  await view.click("button.primary");
  await waitFor(`document.querySelector(".toast.show.notify")?.textContent === "Saved"`);

  expect(await (await api("/api/message")).json()).toEqual({ message: "typed in the browser" });
  await open();
  await waitFor(`document.querySelector("textarea")?.value === "typed in the browser"`);
});

test("a save the server did not take says Not saved", async () => {
  await open();
  await waitFor(`document.querySelector("textarea")?.value === "typed in the browser"`);
  await failFetch();
  await view.click("button.primary");
  await waitFor(`document.querySelector(".toast.show.alert")?.textContent === "Not saved"`);
});

test("the status line is shown", async () => {
  await open();
  await waitFor(`document.querySelector("#status .meta")?.textContent.includes("Bun ${Bun.version}")`);
  expect(await view.evaluate<string>(`document.querySelector("#status .help").textContent`)).toContain("ephemeral");
});

test("a message and a status that cannot be loaded say so", async () => {
  await open();
  await waitFor(`document.querySelector("textarea")`);
  await failFetch();
  // leave the page and come back: both views load again, into a failing fetch
  await view.evaluate(`location.hash = "#/elsewhere"`);
  await waitFor(`document.body.textContent.includes("Page not found!")`);
  await view.evaluate(`location.hash = "#/"`);
  await waitFor(`document.body.textContent.includes("The message could not be loaded.")`);
  await waitFor(`document.body.textContent.includes("The status could not be loaded.")`);
});

// A second window, for the tests that need two: opened at the page, closed in a finally
async function withOtherWindow(run: (other: Bun.WebView, waitForOther: (expr: string) => Promise<void>) => Promise<void>) {
  const other = new Bun.WebView({ width: 1280, height: 800, console: globalThis.console });
  const waitForOther = async (expr: string, timeout = 5_000) => {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      if (await other.evaluate(`Boolean(${expr})`)) return;
      await Bun.sleep(50);
    }
    throw new Error(`Timed out waiting in the other window for: ${expr}`);
  };
  try {
    await other.navigate(`${server.url.href}?other=${++visits}`);
    await run(other, waitForOther);
  } finally {
    other.close();
  }
}

test("a save shows in another window, and so does that window's save afterwards", async () => {
  await putMessage(JSON.stringify({ message: "two windows" }));
  await open();
  await waitFor(`document.querySelector("textarea")?.value === "two windows"`);
  await withOtherWindow(async (other, waitForOther) => {
    await waitForOther(`document.querySelector("textarea")?.value === "two windows"`);

    await replaceText("textarea", "from the first");
    await view.click("button.primary");
    await waitForOther(`document.querySelector("textarea")?.value === "from the first"`);

    await other.click("textarea");
    await other.type("!");
    await other.click("button.primary");
    await waitFor(`document.querySelector("textarea")?.value === "from the first!"`);
  });
});

test("typing that is not saved is not overwritten by another window's save", async () => {
  await open();
  await waitFor(`document.querySelector("textarea")?.value === "from the first!"`);
  await replaceText("textarea", "half-typed");
  await withOtherWindow(async (other, waitForOther) => {
    await waitForOther(`document.querySelector("textarea")?.value === "from the first!"`);
    await other.click("textarea");
    await other.type("?");
    await other.click("button.primary");
    await waitForOther(`document.querySelector(".toast.show.notify")?.textContent === "Saved"`);
  });
  expect(await (await api("/api/message")).json()).toEqual({ message: "from the first!?" });
  await Bun.sleep(300); // time for the push to arrive, had it been taken
  expect(await view.evaluate<string>(`document.querySelector("textarea").value`)).toBe("half-typed");
});

test("after the server restarts, the page loads what changed meanwhile and follows again", async () => {
  await open();
  await waitFor(`document.querySelector("textarea")?.value === "from the first!?"`);

  const port = server.port;
  await server.stop(true); // closes the page's socket
  await Bun.write(`${dataDir}/message.json`, JSON.stringify({ message: "changed while down" }));
  server = startServer({ port, dev: false, dataDir });
  await waitFor(`document.querySelector("textarea")?.value === "changed while down"`);

  await putMessage(JSON.stringify({ message: "after the restart" }));
  await waitFor(`document.querySelector("textarea")?.value === "after the restart"`);
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
