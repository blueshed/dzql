# Testing a document

Test what a person sees and clicks: a change in one window reaching another, and a change the server refuses. The notes of [document.md](document.md), in a test file of their own, as `tests/message.test.ts` has the message's.

The stories come first, in `stories.ts`; each test is named from the one it tells:

```ts
// stories.ts: after export const stories = {
  // Notes
  notesFollow: story("A note added in one window shows in every other, and so does its removal."),
  notesKept: story("A note is still there after a reload."),
  notesRefused: story("A note the server refuses says Not saved, and stays in the box it was typed in."),
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

const NOTES = `.cell[data-key="notes"]`;
const shown = `[...document.querySelectorAll('${NOTES} .rows .what')].map((w) => w.textContent).join(", ")`;

/** A note added as a person adds one: the deed beside the page's name, then its modal. */
async function addNote(text: string) {
  await view.click(".heading > .tool");
  await waitFor(`document.querySelector("dialog input[name=text]")`);
  await view.click("dialog input[name=text]");
  await view.type(text);
  await view.click("dialog .tool.add");
}

test(`${stories.notesFollow.name} -- added in one window, removed in the other`, async () => {
  await open();
  await waitFor(`document.querySelector('${NOTES}')`);
  await withOtherWindow(async (other, waitForOther) => {
    await waitForOther(`document.querySelector('${NOTES}')`);

    await addNote("first");
    await waitForOther(`${shown} === "first"`);
    await waitFor(`!document.querySelector("dialog")`); // the modal goes once it is saved

    await other.click(`${NOTES} .row .tool`); // the bin asks first
    await waitForOther(`document.querySelector("dialog .tool.danger")`);
    await other.click("dialog .tool.danger");
    await waitFor(`${shown} === ""`);
  });
});

test(`${stories.notesKept.name} -- added, then the page reloaded`, async () => {
  await open();
  await waitFor(`document.querySelector('${NOTES}')`);
  await addNote("kept");
  await waitFor(`${shown} === "kept"`);

  await open();
  await waitFor(`${shown} === "kept"`);
});

test(`${stories.notesRefused.name} -- the server refuses every write`, async () => {
  await open();
  await waitFor(`document.querySelector('${NOTES}')`);
  await refuseWrites();
  await addNote("refused");
  await waitFor(`document.querySelector(".toast.show.alert")?.textContent === "Not saved"`);
  expect(await view.evaluate<string>(`document.querySelector("dialog input[name=text]").value`)).toBe("refused");
});
```

- `tests/stories.test.ts` fails a story no test names (`stories.<key>.name`), so a story cannot be dropped or renamed away from its test.
- The page helpers are railroad's (`@blueshed/railroad/webview`): `open`, `waitFor`, `replaceText`, `failFetch`, `withOtherWindow`; `tests/browser.ts` adds `refuseWrites` (the server refuses what the page sends).
- The Bun.WebView rules are at the top of railroad's `webview.ts` (`node_modules/@blueshed/railroad/webview.ts`): follow them exactly.
- Every server in a test gets a scratch data folder (`mkdtempSync`), never the project's `data/`.
- To test a document without a browser, hold it from a client in the test process: `connectWs` and `openDoc(name, client)`, as the kitchen's test does in [sqlite.md](sqlite.md).
- delta's case suite (`@blueshed/delta/testing`: `errorCodeCases`, `pathCases` and the rest) is for a backend of one's own, dzql for Postgres, to answer as delta's do. An app tests its own documents, as here.
