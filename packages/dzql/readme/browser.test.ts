// The README's rendering section by hand, in a real browser: two windows on the page, a save typed
// into one shows in both. (readme.test.ts runs the same over sockets, with `dzql serve`.)
import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { browser } from "@blueshed/railroad/webview";
import { createServer } from "dzql/rendering/server";

const data = mkdtempSync(join(tmpdir(), "dzql-readme-page-"));
process.env.DATA_PATH = data;
process.env.NODE_ENV = "production"; // no file watcher: the suite's dev servers use up the system's
let server: ReturnType<typeof createServer>;
beforeAll(async () => {
  server = createServer((await import("./rendering/index")).example, 0);
});
const page = browser(() => server.url);
afterAll(() => {
  page.close();
  server.stop(true);
  rmSync(data, { recursive: true, force: true });
});

test("a save typed into one window shows in both", async () => {
  await page.open();
  await page.withOtherWindow(async (other, waitForOther) => {
    await page.waitFor(`document.querySelector("h1")?.textContent === "Hello"`);
    await waitForOther(`document.querySelector("h1")?.textContent === "Hello"`);
    await page.replaceText("input[name=text]", "Typed in the first window");
    await page.view.click("button");
    await page.waitFor(`document.querySelector("h1")?.textContent === "Typed in the first window"`);
    await waitForOther(`document.querySelector("h1")?.textContent === "Typed in the first window"`);
    expect(await other.evaluate<string>(`document.title`)).toBe("Message");
  });
}, 60_000);
