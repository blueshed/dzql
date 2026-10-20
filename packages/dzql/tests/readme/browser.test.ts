// The README's rendering section by hand, in a real browser: two windows on the page, a save typed
// into one shows in both. (readme.test.ts runs the same over sockets.) On dzql's own test kit
// (src/rendering/webview.ts), as every browser test of dzql's is: Chrome, a host per window.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "dzql/rendering/server";
import { press, urlFor, waitFor, webview } from "dzql/rendering/webview";

const data = mkdtempSync(join(tmpdir(), "dzql-readme-page-"));
process.env.DATA_PATH = data;
process.env.NODE_ENV = "production"; // no file watcher: the suite's dev servers use up the system's
let server: Awaited<ReturnType<typeof createServer>>;
beforeAll(async () => {
  server = await createServer((await import("./rendering/routes")).app, 0);
});
afterAll(() => {
  server.stop(true);
  rmSync(data, { recursive: true, force: true });
});

const says = (view: Bun.WebView, text: string) => waitFor(view, `document.querySelector("h1")?.textContent`, (v) => v === text);

test("a save typed into one window shows in both", async () => {
  await using one = webview();
  await using other = webview();
  for (const view of [one, other]) await view.navigate(urlFor(view, server.url));
  await says(one, "Hello");
  await says(other, "Hello");
  await one.click("input[name=text]");
  await one.type("Typed in the first window");
  await press(one, "button");
  await says(one, "Typed in the first window");
  await says(other, "Typed in the first window");
  expect(await other.evaluate<string>(`document.title`)).toBe("Message");
}, 60_000);
