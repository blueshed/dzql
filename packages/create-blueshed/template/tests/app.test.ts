import { test, expect, afterAll, setDefaultTimeout } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { startServer } from "../src/routes";
import { browser } from "./browser";
import { stories } from "../stories";

// What this page alone does, drawn in the browser by app.tsx: where you are is the URL's hash, so
// the server serves the page at "/" and nothing else, and the status is fetched. What any page of
// the app does, light or drawn on the server, is site.test.ts.

setDefaultTimeout(30_000); // first browser start can be slow

const dataDir = mkdtempSync(`${tmpdir()}/app-`); // a scratch data folder, never the project's data/
const server = await startServer({ port: 0, dev: false, dataDir }); // random free port, no HMR
const { view, open, waitFor, failFetch, close } = browser(() => server.url);

afterAll(async () => {
  close();
  await server.stop(true);
  rmSync(dataDir, { recursive: true, force: true });
});

test("unknown paths return 404: a place on the page is the hash", async () => {
  expect((await fetch(new URL("/nope", server.url))).status).toBe(404);
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

test(`${stories.stories.health.name} -- a page that is not found links home`, async () => {
  await open();
  await view.evaluate(`location.hash = "#/nowhere"`);
  await waitFor(`document.body.textContent.includes("Page not found!")`);
  await view.click("#app a");
  await waitFor(`document.querySelector("h1")?.textContent === "Paintbrush"`);
});
