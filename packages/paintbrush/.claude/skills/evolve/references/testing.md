# Testing a document

Test what a person sees and clicks: a change in one window reaching another, and a change the server refuses. The notes of [document.md](document.md), in a test file of their own, as `tests/message.test.ts` has the message's.

```ts
// tests/notes.test.ts
import { test, expect, afterAll, setDefaultTimeout } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { startServer } from "../src/routes";
import { browser } from "./browser";

setDefaultTimeout(30_000); // first browser start can be slow

const dataDir = mkdtempSync(`${tmpdir()}/notes-`);
const server = await startServer({ port: 0, dev: false, dataDir });
const { view, open, waitFor, refuseWrites, withOtherWindow, close } = browser(() => server.url);

afterAll(async () => {
  close();
  await server.stop(true);
  rmSync(dataDir, { recursive: true, force: true });
});

const shown = `[...document.querySelectorAll(".notes li")].map((li) => li.textContent).join(", ")`;
const onNotes = `document.querySelector("h1")?.textContent === "Notes"`;

test("a note added in one window shows in another, and so does its removal", async () => {
  await open();
  await view.evaluate(`location.hash = "#/notes"`);
  await waitFor(onNotes);
  await withOtherWindow(async (other, waitForOther) => {
    await other.evaluate(`location.hash = "#/notes"`);
    await waitForOther(onNotes);

    await view.click("input");
    await view.type("first");
    await view.click("button.primary");
    await waitForOther(`${shown} === "first"`);
    await waitFor(`document.querySelector("input").value === ""`); // the box empties once it is saved

    await other.click(".notes li button");
    await waitFor(`${shown} === ""`);
  });
});

test("a note is kept: it is there after a reload", async () => {
  await open();
  await view.evaluate(`location.hash = "#/notes"`);
  await waitFor(onNotes);
  await view.click("input");
  await view.type("kept");
  await view.click("button.primary");
  await waitFor(`${shown} === "kept"`);

  await open();
  await view.evaluate(`location.hash = "#/notes"`);
  await waitFor(`${shown} === "kept"`);
});

test("a note the server refuses says Not saved, and stays in the box", async () => {
  await open();
  await view.evaluate(`location.hash = "#/notes"`);
  await waitFor(onNotes);
  await refuseWrites();
  await view.click("input");
  await view.type("refused");
  await view.click("button.primary");
  await waitFor(`document.querySelector(".toast.show.alert")?.textContent === "Not saved"`);
  expect(await view.evaluate<string>(`document.querySelector("input").value`)).toBe("refused");
});
```

- The page helpers are railroad's (`@blueshed/railroad/webview`): `open`, `waitFor`, `replaceText`, `failFetch`, `withOtherWindow`; `tests/browser.ts` adds `refuseWrites` (the server refuses what the page sends).
- The Bun.WebView rules are at the top of railroad's `webview.ts` (`node_modules/@blueshed/railroad/webview.ts`): follow them exactly.
- Every server in a test gets a scratch data folder (`mkdtempSync`), never the project's `data/`.
- To test a document without a browser, hold it from a client in the test process: `connectWs` and `openDoc(name, client)`, as `tests/kitchen.test.ts` does in [sqlite.md](sqlite.md).
- delta's case suite (`@blueshed/delta/testing`: `errorCodeCases`, `pathCases` and the rest) is for a backend of one's own, dzql for Postgres, to answer as delta's do. An app tests its own documents, as here.
