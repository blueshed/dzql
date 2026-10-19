# Testing a document

Test what a person sees and clicks: a change in one window reaching another, and a change the server refuses. The notes of [document.md](document.md), in a test file of their own, as `tests/message.test.ts` has the message's.

The stories come first, in `stories.ts`; each test is named from the one it tells:

```ts
// stories.ts: after export const stories = {
  // Notes
  notesFollow: story("A note added in one window shows in every other, and so does its removal."),
  notesKept: story("A note is still there after a reload."),
  notesRefused: story("A note the server refuses says Not saved, and stays in the box."),
```

```ts
// tests/notes.test.ts
import { test, expect, afterAll, setDefaultTimeout } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { startServer } from "../src/routes";
import { stories } from "../stories";
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

test(`${stories.notesFollow.name} -- added in one window, removed in the other`, async () => {
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

test(`${stories.notesKept.name} -- added, then the page reloaded`, async () => {
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

test(`${stories.notesRefused.name} -- the server refuses every write`, async () => {
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

- `tests/stories.test.ts` fails a story no test names (`stories.<key>.name`), so a story cannot be dropped or renamed away from its test.
- The page helpers are railroad's (`@blueshed/railroad/webview`): `open`, `waitFor`, `replaceText`, `failFetch`, `withOtherWindow`; `tests/browser.ts` adds `refuseWrites` (the server refuses what the page sends).
- The Bun.WebView rules are at the top of railroad's `webview.ts` (`node_modules/@blueshed/railroad/webview.ts`): follow them exactly.
- Every server in a test gets a scratch data folder (`mkdtempSync`), never the project's `data/`.
- To test a document without a browser, hold it from a client in the test process: `connectWs` and `openDoc(name, client)`, as the kitchen's test does in [sqlite.md](sqlite.md).
- delta's case suite (`@blueshed/delta/testing`: `errorCodeCases`, `pathCases` and the rest) is for a backend of one's own, dzql for Postgres, to answer as delta's do. An app tests its own documents, as here.
