// The client's unit tests, on happy-dom (railroad's bunfig.toml preloads it): the handle and its
// views with no server. tests/webview-examples.test.ts runs the whole app in a real browser.
//
//   bun test examples/jobs        # from packages/railroad
import { afterEach, expect, test } from "bun:test";
import { clearProviders, mount, navigate, provide } from "@blueshed/railroad";
import type { Command, Job } from "../resources/jobs/jobs-api";
import { apply, FAILED, FEED, jobs, watchTitle } from "../resources/jobs/jobs";
import { JobsPage } from "../resources/jobs/jobs-view";
import { RunnersPage } from "../resources/runners/runners-view";

const job = (id: number, fields: Partial<Job> = {}): Job =>
  ({ id, name: `job ${id}`, runner: "linux", status: "queued", progress: 0, ...fields });

const sent: Command[] = [];
const realFetch = globalThis.fetch;

afterEach(() => {
  clearProviders(); // provide/inject is one registry: each test starts with none
  apply({ snapshot: [] });
  sent.length = 0;
  globalThis.fetch = realFetch;
  location.hash = "";
});

// Each test mounts the page under a scope of its own and disposes it
function page(render: () => Node) {
  provide(FEED, { send: (cmd) => void sent.push(cmd) });
  const root = document.createElement("div");
  return { root, dispose: mount(root, render) };
}

test("a job changed in place updates its own row, which stays the same node", () => {
  apply({ snapshot: [job(1), job(2)] });
  const { root, dispose } = page(() => <JobsPage />);
  const row = root.querySelector('[data-id="2"]')!;

  apply({ job: job(2, { status: "running", progress: 40 }) }); // writes notify at once: no tick
  expect(row.querySelector(".status")!.textContent).toBe("running");
  expect(row.querySelector(".progress")!.textContent).toBe("40%");
  expect(root.querySelector('[data-id="2"]')).toBe(row);
  expect(jobs.peek()[1]!.status).toBe("running"); // the same array, changed where it is
  dispose();
});

test("retry is enabled once a job fails, and a click sends it to the feed", () => {
  apply({ snapshot: [job(1)] });
  const { root, dispose } = page(() => <JobsPage />);
  const retry = root.querySelector<HTMLButtonElement>(".retry")!;
  expect(retry.disabled).toBe(true);

  apply({ job: job(1, { status: "failed" }) });
  expect(retry.disabled).toBe(false);
  retry.click();
  expect(sent).toEqual([{ op: "retry", id: 1 }]);
  dispose();
});

test("a failure is told to whoever provided FAILED, and with no one there, to no one", () => {
  apply({ snapshot: [job(1), job(2)] });
  apply({ job: job(1, { status: "failed" }) }); // nothing provided: tryInject finds nothing
  const told: number[] = [];
  provide(FAILED, (id) => void told.push(id));
  apply({ job: job(2, { status: "failed" }) });
  apply({ job: job(2, { status: "failed", progress: 60 }) }); // already failed: told once
  expect(told).toEqual([2]);
});

test("the title follows the failures until its effect is disposed", () => {
  const stop = watchTitle(); // a module-level effect: its disposer is kept, here to end it
  apply({ snapshot: [job(1, { status: "failed" })] });
  expect(document.title).toBe("(1 failed) jobs");
  stop();
  apply({ job: job(1, { status: "queued" }) });
  expect(document.title).toBe("(1 failed) jobs");
});

test("navigate() needs no tick; a hash set by hand lands on the next hashchange", async () => {
  globalThis.fetch = (async (url: string) =>
    Response.json({ name: url.split("/").pop(), host: "ci.local", slots: 1 })) as unknown as typeof fetch;
  apply({ snapshot: [job(1, { runner: "mac" }), job(2, { runner: "linux" })] });
  const { root, dispose } = page(() => <RunnersPage />);
  expect(root.querySelector(".pick")).not.toBeNull();

  navigate("/runners/mac");
  expect(root.querySelector(".runner h2")!.textContent).toBe("mac");

  location.hash = "#/runners/linux";
  expect(root.querySelector(".runner h2")!.textContent).toBe("mac");
  await new Promise((r) => setTimeout(r, 0));
  expect(root.querySelector(".runner h2")!.textContent).toBe("linux");
  dispose();
});
