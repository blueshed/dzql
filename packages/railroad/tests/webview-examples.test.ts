// The examples, run as their READMEs say, in a real browser (railroad's kit, src/webview.ts).
//
//   jobs -- examples/jobs: `bun examples/jobs/routes.ts` serves a live list of build jobs fed by
//           a WebSocket. Each test starts the server afresh (TICK_MS=0: no simulated runners, the
//           test reports for them as a runner would, POST /api/jobs/:id) and asserts what a rule of
//           the railroad skill is about: a row changed in place re-renders that row's nodes and no
//           other, a disposed scope's effects stop, a keyed route runs again, and so on.
//
// Servers run in child processes, and happy-dom (preloaded here) replaces fetch, so the test
// talks to them with Bun.fetch.

import { afterAll, beforeAll, beforeEach, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { browser } from "../src/webview";

setDefaultTimeout(30_000); // the first browser start can be slow

const railroad = `${import.meta.dir}/..`;

type App = { url: URL; proc: Bun.Subprocess<"ignore", "pipe", "pipe"> };
let app: App;
let output = ""; // every server's output, for the last test

/** Runs `bun examples/jobs/routes.ts`, as the README does, and waits for its Listening line. */
async function start(env: Record<string, string> = {}): Promise<App> {
  const proc = Bun.spawn([process.execPath, "examples/jobs/routes.ts"], {
    cwd: railroad,
    env: { ...process.env, PORT: "0", TICK_MS: "0", NO_COLOR: "1", ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  let mine = "";
  const read = async (stream: ReadableStream<Uint8Array>) => {
    const decoder = new TextDecoder();
    for await (const bytes of stream) {
      const chunk = decoder.decode(bytes, { stream: true });
      mine += chunk;
      output += chunk;
    }
  };
  void read(proc.stdout);
  void read(proc.stderr);
  const end = performance.now() + 10_000;
  while (!/Listening on (\S+)/.test(mine)) {
    if (proc.exitCode !== null || performance.now() > end) throw new Error(`no server:\n${mine}`);
    await Bun.sleep(25);
  }
  return { url: new URL(/Listening on (\S+)/.exec(mine)![1]!), proc };
}

async function stop(a: App | undefined) {
  a?.proc.kill();
  await a?.proc.exited;
}

/** What a runner says about job `id`. */
const report = (id: number, body: object) =>
  Bun.fetch(new URL(`/api/jobs/${id}`, app.url), { method: "POST", body: JSON.stringify(body) });
const onServer = async (id: number) => (await (await Bun.fetch(new URL(`/api/jobs/${id}`, app.url))).json()) as { name: string; status: string };

beforeAll(async () => {
  app = await start();
});
const { view, open, waitFor, replaceText, withOtherWindow, close } = browser(() => app.url);
// a fresh server for each test: its six seeded jobs, all queued
beforeEach(async () => {
  await stop(app);
  app = await start();
});
afterAll(async () => {
  close();
  await stop(app);
});

const text = (selector: string) => view.evaluate<string | null>(`document.querySelector(${JSON.stringify(selector)})?.textContent ?? null`);
const ids = () => view.evaluate<string>(`[...document.querySelectorAll(".rows li")].map((li) => li.dataset.id).join(",")`);
const row = (id: number, part: string) => `.rows li[data-id="${id}"] ${part}`;
const go = (hash: string) => view.evaluate(`location.hash = ${JSON.stringify(hash)}`);

/** Opens the list and waits for its six rows. */
async function list() {
  await open();
  await waitFor(`document.querySelectorAll(".rows li").length === 6`);
}

test("the README's server: the page, a runner's report, and the logger's line for each", async () => {
  expect((await Bun.fetch(app.url)).status).toBe(200);
  expect((await report(2, { status: "running", progress: 40 })).status).toBe(200);
  expect(await onServer(2)).toMatchObject({ status: "running" });
  expect(output).toMatch(/INFO {2}\[jobs\] Listening on http/);
  expect(output).toMatch(/INFO {2}\[api\] POST \/api\/jobs\/2 → 200/);
});

test("realtime: a job changed in place re-renders that row's nodes and no other, in one pass", async () => {
  await list();
  // Every DOM write the list and the summary take from here on, by the row it is in
  await view.evaluate(`(() => {
    window.__row2 = document.querySelector('.rows li[data-id="2"]');
    window.__writes = [];
    const by = (n) => (n.nodeType === 1 ? n : n.parentElement).closest("li")?.dataset.id ?? "summary";
    new MutationObserver((rs) => rs.forEach((r) => __writes.push(by(r.target))))
      .observe(document.querySelector(".jobs"), { subtree: true, childList: true, characterData: true, attributes: true });
  })()`);
  await report(2, { status: "running", progress: 40 });
  await waitFor(`document.querySelector('${row(2, ".status")}').textContent === "running"`);
  await Bun.sleep(100); // anything else the patch would write has been written
  const writes = await view.evaluate<string[]>("__writes");
  expect(writes.length).toBeGreaterThan(0);
  // row 2's class, style, status, progress and retry; the summary once (it reads the list twice:
  // directly and through `shown`, a diamond, settled in one pass); nothing in any other row
  expect([...new Set(writes)].sort()).toEqual(["2", "summary"]);
  expect(writes.filter((w) => w === "summary").length).toBe(1);
  expect(await view.evaluate<boolean>(`__row2 === document.querySelector('.rows li[data-id="2"]')`)).toBe(true);
  expect(await text(row(2, ".progress"))).toBe("40%");
  expect(await view.evaluate<string>(`document.querySelector('.rows li[data-id="2"]').style.getPropertyValue("--progress")`)).toBe("40%");
  expect(await text(row(1, ".progress"))).toBe(""); // null renders nothing
});

test("jsx: a rename goes to the server on commit (onchange), not per keystroke", async () => {
  await list();
  await replaceText(row(3, ".name"), "test units");
  await Bun.sleep(100);
  expect((await onServer(3)).name).toBe("test unit");
  await view.press("Enter");
  await waitFor(`document.querySelector('${row(3, ".name")}').value === "test units"`);
  const end = performance.now() + 3000;
  while ((await onServer(3)).name !== "test units" && performance.now() < end) await Bun.sleep(50);
  expect((await onServer(3)).name).toBe("test units");
});

test("list(): a reorder moves the other rows, so the row being typed in keeps its focus and text", async () => {
  await list();
  await view.evaluate(`(() => { const s = document.querySelector(".sort"); s.value = "progress"; s.dispatchEvent(new Event("change")); })()`);
  await view.click(row(3, ".name"));
  await view.type("!");
  await view.evaluate(`window.__row3 = document.querySelector('.rows li[data-id="3"]')`);
  await report(1, { status: "running", progress: 50 }); // 1 sorts last now
  await waitFor(`[...document.querySelectorAll(".rows li")].map((li) => li.dataset.id).join() === "2,3,4,5,6,1"`);
  expect(await view.evaluate<boolean>(`document.activeElement === document.querySelector('${row(3, ".name")}')`)).toBe(true);
  expect(await view.evaluate<string>(`document.activeElement.value`)).toBe("test unit!");
  expect(await view.evaluate<boolean>(`__row3 === document.querySelector('.rows li[data-id="3"]')`)).toBe(true);
});

test("signals: the search filters per keystroke, and clear's two writes are one batch", async () => {
  await list();
  await view.click(`input[type="search"]`);
  await view.type("e2e");
  await waitFor(`document.querySelectorAll(".rows li").length === 1`);
  await view.evaluate(`(() => { const s = document.querySelector(".status"); s.value = "failed"; s.dispatchEvent(new Event("change")); })()`);
  await waitFor(`document.querySelector(".empty")`); // when() over a function: no job matches
  expect(await text(".summary")).toBe("0 of 6 jobs");
  await view.evaluate(`(() => {
    window.__summary = 0;
    new MutationObserver((rs) => (__summary += rs.length)).observe(document.querySelector(".summary"), { subtree: true, characterData: true });
  })()`);
  await view.click(".clear");
  await waitFor(`document.querySelectorAll(".rows li").length === 6`);
  expect(await text(".summary")).toBe("6 of 6 jobs");
  expect(await view.evaluate<number>("__summary")).toBe(1); // not twice: once for each write
  expect(await view.evaluate<string>(`document.querySelector(".status").value`)).toBe("all");
  expect(await text(".empty")).toBeNull();
  await view.click(".direction"); // .mutate(): a clone of the small sort object, changed, notified
  await waitFor(`document.querySelector(".direction").textContent === "↓"`);
  expect(await ids()).toBe("6,5,4,3,2,1");
});

test("when(): the banner is built when the first job fails, then follows the count without a rebuild", async () => {
  await list();
  expect(await text(".banner")).toBeNull();
  expect(await view.evaluate<boolean>(`document.querySelector('${row(4, ".retry")}').disabled`)).toBe(true);
  await report(4, { status: "failed", progress: 60 });
  await waitFor(`document.querySelector(".banner")?.textContent === "1 failed"`);
  expect(await view.evaluate<boolean>(`document.querySelector('${row(4, ".retry")}').disabled`)).toBe(false);
  await view.evaluate(`window.__banner = document.querySelector(".banner")`);
  await report(1, { status: "failed" });
  await waitFor(`document.querySelector(".banner")?.textContent === "2 failed"`);
  expect(await view.evaluate<boolean>(`__banner === document.querySelector(".banner")`)).toBe(true);
  expect(await view.evaluate<string>("document.title")).toBe("(2 failed) jobs");
});

test("scopes: a toast is a root of its own, live until dismissed; then its effects stop", async () => {
  await list();
  await report(4, { status: "failed", progress: 60 });
  await waitFor(`document.querySelector(".toast .what")?.textContent === "#4 test e2e (flaky): failed"`);
  await view.click(".toast .retry");
  await waitFor(`document.querySelector(".toast .what")?.textContent === "#4 test e2e (flaky): queued"`);
  // held across the dismissal, which takes it out of the page with the when() it is in
  await view.evaluate(`window.__what = document.querySelector(".toast .what")`);
  await view.click(".toast .dismiss");
  await waitFor(`!document.querySelector(".toast")`);
  expect(await view.evaluate<boolean>(`__what.isConnected`)).toBe(false);
  await report(4, { status: "running", progress: 20 });
  await waitFor(`document.querySelector('${row(4, ".status")}').textContent === "running"`);
  expect(await view.evaluate<string>(`__what.textContent`)).toBe("#4 test e2e (flaky): queued");
});

test("async and routes: #/jobs/:id is keyed and async; what it bound stops when it is left", async () => {
  await list();
  await go("#/jobs/2");
  await waitFor(`document.querySelector('.detail[data-id="2"] .live .status')?.textContent === "queued"`);
  expect(await view.evaluate<boolean>(`document.querySelector(".command").readOnly`)).toBe(true);
  await report(2, { status: "running", progress: 40 });
  await waitFor(`document.querySelector(".detail .live .status").textContent === "running"`);
  // SVG: the circles are made in SVG's namespace; <title>, shared with HTML, is adopted
  expect(await view.evaluate<string>(`document.querySelector(".ring .done").getAttribute("stroke-dasharray")`)).toBe("40 100");
  expect(await view.evaluate<string>(`document.querySelector(".ring title").namespaceURI`)).toBe("http://www.w3.org/2000/svg");
  expect(await view.evaluate<string>(`document.querySelector(".ring title").textContent`)).toBe("40% done");
  expect(await view.evaluate<string>(`document.querySelector(".detail .live").style.getPropertyValue("--accent")`)).toBe("var(--running)");

  await view.evaluate(`window.__ring = document.querySelector(".ring .done")`);
  await go("#/jobs/3"); // the same pattern, another id: keyed, so the handler runs again
  await waitFor(`document.querySelector('.detail[data-id="3"]')`);
  await report(2, { progress: 80 });
  await go("#/");
  await waitFor(`document.querySelector('${row(2, ".progress")}')?.textContent === "80%"`);
  expect(await view.evaluate<string>(`__ring.getAttribute("stroke-dasharray")`)).toBe("40 100");
});

test("async: a component shows its fallback until it settles; disposed first, its thunk never runs", async () => {
  await list();
  await go("#/jobs/3?log"); // segments only: the handler splits the query off
  await waitFor(`document.querySelector(".waiting")`);
  await report(3, { status: "passed", progress: 100 });
  await waitFor(`document.querySelector(".log")?.textContent.includes("passed at 100%")`);
  expect(await text(".waiting")).toBeNull();

  await go("#/jobs/5?log");
  await waitFor(`document.querySelector('.detail[data-id="5"] .waiting')`);
  await view.evaluate(`window.__detail = document.querySelector(".detail")`);
  await go("#/");
  await report(5, { status: "passed", progress: 100 });
  await waitFor(`document.querySelector('${row(5, ".status")}')?.textContent === "passed"`);
  await Bun.sleep(100);
  expect(await view.evaluate<boolean>(`__detail.querySelector(".log") === null`)).toBe(true);
});

test("routes: /jobs/new comes before /jobs/:id; its select takes its value after its options", async () => {
  await list();
  await go("#/jobs/new");
  await waitFor(`document.querySelector("form.new")`);
  expect(await view.evaluate<string>(`document.querySelector("form.new select").value`)).toBe("linux");
  await replaceText(`form.new input`, "ship it");
  await view.click(`form.new button`);
  // navigate() is synchronous: the list is there as the submit returns, and the feed adds the job
  expect(await view.evaluate<string>("location.hash")).toBe("#/");
  await waitFor(`document.querySelector('${row(7, ".name")}')?.value === "ship it"`);
});

test("routes: onError draws a job that is not there; a path no route has is read through params$", async () => {
  await list();
  await go("#/jobs/999");
  await waitFor(`document.querySelector(".error")?.textContent === "There is no such job."`);
  await go("#/nope");
  await waitFor(`document.querySelector(".missing")?.textContent.startsWith("There is no page at /nope.")`);
  await view.evaluate(`window.__missing = document.querySelector(".missing")`);
  await go("#/jobs/1/"); // a trailing slash is a segment: not /jobs/:id
  await waitFor(`document.querySelector(".missing")?.textContent.startsWith("There is no page at /jobs/1/.")`);
  expect(await view.evaluate<boolean>(`__missing === document.querySelector(".missing")`)).toBe(true);
});

test("routes: the runners layout stays mounted while route() picks the runner inside it", async () => {
  await list();
  await go("#/runners");
  await waitFor(`document.querySelector(".runners .pick")`);
  await view.click(`.runners nav a[href="#/runners/linux"]`); // a hash link: the next hashchange
  await waitFor(`document.querySelector(".runner .host")?.textContent === "ci-linux.local · 2 slots"`);
  expect(await view.evaluate<number>(`document.querySelectorAll(".runner li").length`)).toBe(2);
  await view.evaluate(`(() => { window.__layout = document.querySelector(".runners"); window.__panel = document.querySelector(".runner"); })()`);
  await view.click(`.runners nav a[href="#/runners/mac"]`);
  await waitFor(`document.querySelector(".runner .host")?.textContent === "ci-mac.local · 1 slots"`);
  expect(await text(".runner h2")).toBe("mac");
  expect(await view.evaluate<string>(`[...document.querySelectorAll(".runner li")].map((li) => li.textContent).join()`))
    .toBe("#1 build api: queued,#4 test e2e (flaky): queued");
  expect(await view.evaluate<boolean>(`__layout === document.querySelector(".runners") && __panel === document.querySelector(".runner")`)).toBe(true);
});

test("realtime: two windows on one feed: a retry and a removal in one are seen in the other", async () => {
  await list();
  await report(4, { status: "failed", progress: 60 });
  await waitFor(`document.querySelector('${row(4, ".status")}').textContent === "failed"`);
  await view.evaluate(`window.__row5 = document.querySelector('.rows li[data-id="5"]')`);
  await withOtherWindow(async (other, waitForOther) => {
    await waitForOther(`!document.querySelector('${row(4, ".retry")}')?.disabled`);
    await other.click(row(4, ".retry"));
    await waitFor(`document.querySelector('${row(4, ".status")}').textContent === "queued"`);
    await other.click(row(6, ".remove"));
    await waitFor(`document.querySelectorAll(".rows li").length === 5`);
  });
  expect(await ids()).toBe("1,2,3,4,5");
  expect(await view.evaluate<boolean>(`__row5 === document.querySelector('.rows li[data-id="5"]')`)).toBe(true);
});

test("the README's simulated runners: a long list, patched in place as they report", async () => {
  await stop(app);
  app = await start({ JOBS: "2000", TICK_MS: "30" });
  await open();
  await waitFor(`document.querySelectorAll(".rows li").length === 2000`, 15_000);
  await waitFor(`document.querySelector(".rows li.passed")`, 15_000);
  await waitFor(`document.querySelector(".banner")`, 15_000); // the flaky ones fail
});

test("the README's production build drops railroad's development warnings", async () => {
  const dir = mkdtempSync(`${tmpdir()}/railroad-jobs-`);
  try {
    const bundle = (production: boolean) => {
      rmSync(`${dir}/dist`, { recursive: true, force: true });
      const args = ["build", "./examples/jobs/index.html", ...(production ? ["--production"] : []), `--outdir=${dir}/dist`];
      // as from a shell: bun test sets NODE_ENV=test, and a NODE_ENV in the environment overrides
      // --production's (railroad's todo.jsonl has it)
      const { NODE_ENV: _, ...env } = process.env;
      expect(Bun.spawnSync([process.execPath, ...args], { cwd: railroad, env }).exitCode).toBe(0);
      return readdirSync(`${dir}/dist`).filter((f) => f.endsWith(".js")).map((f) => readFileSync(`${dir}/dist/${f}`, "utf8")).join("");
    };
    expect(bundle(false)).toContain("in a render body");
    expect(bundle(true)).not.toContain("in a render body");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// Last: every page above was served in development, where railroad warns of a mistake (a .get()
// in a render body, a when() outside a scope, a handler that is not a function, duplicate keys,
// a second copy) and Bun.serve's console mirrors the page's console here
test("no page above gave a railroad warning or error", () => {
  expect(output).toContain("Listening on");
  expect(output).not.toContain("[railroad");
});
