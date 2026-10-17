// @blueshed/railroad/webview: the kit page tests share, in a real browser.
import { afterAll, expect, setDefaultTimeout, setSystemTime, test } from "bun:test";
import { browser, waitIn } from "../webview";
import kit from "./fixtures/kit.html";

setDefaultTimeout(30_000); // the first browser start can be slow

// happy-dom (this package's preload) takes the global Response, so the page is an HTML import
const server = Bun.serve({ port: 0, development: false, routes: { "/": kit } });
const { view, open, waitFor, replaceText, failFetch, withOtherWindow, close } = browser(() => server.url);

afterAll(async () => {
  close();
  await server.stop(true);
});

test("open loads the page afresh, and waitFor waits on what it shows", async () => {
  await open();
  await waitFor(`document.querySelector("#seen").textContent === "200"`);
  expect(await view.evaluate<string>("document.title")).toBe("kit");
});

test("replaceText clears a field, telling the page, then types", async () => {
  await open();
  await replaceText("#f", "typed");
  await waitFor(`document.querySelector("h1").textContent === "typed"`);
  expect(await view.evaluate<string>(`document.querySelector("#f").value`)).toBe("typed");
});

test("failFetch makes the page's next fetch answer 500", async () => {
  await open();
  await waitFor(`document.querySelector("#seen").textContent === "200"`);
  await failFetch();
  await view.evaluate(`fetch("/").then((r) => (document.querySelector("#seen").textContent = r.status))`);
  await waitFor(`document.querySelector("#seen").textContent === "500"`);
});

test("withOtherWindow is a second view at the page, closed after", async () => {
  await withOtherWindow(async (other, waitForOther) => {
    await waitForOther(`document.querySelector("h1")`);
    expect(await other.evaluate<string>("document.title")).toBe("kit");
  });
});

test("waitIn throws, naming the expression, once its time is up", async () => {
  await expect(waitIn(view, "false", 100)).rejects.toThrow("Timed out waiting for: false");
});

// waitIn timed itself by Date.now, so under setSystemTime it never timed out
test("waitIn times out by a clock that runs, though a test has fixed the date", async () => {
  setSystemTime(new Date("2026-01-01T00:00:00Z"));
  try {
    await expect(waitIn(view, "false", 100)).rejects.toThrow("Timed out waiting for: false");
  } finally {
    setSystemTime();
  }
}, 5_000);
