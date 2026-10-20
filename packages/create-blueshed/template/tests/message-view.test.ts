import { test, expect, afterAll, setDefaultTimeout } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { startServer } from "../src/routes";
import { browser } from "./browser";
import { stories } from "../stories";

// What this page's message drawer alone does (message-view.tsx, in the browser): a refusal said in
// a toast, and Cmd+Enter or Ctrl+Enter saving from the box. What any page of the message does is
// message.test.ts.

setDefaultTimeout(30_000); // first browser start can be slow

const dataDir = mkdtempSync(`${tmpdir()}/message-view-`); // a scratch data folder, never the project's data/
const server = await startServer({ port: 0, dev: false, dataDir }); // random free port, no HMR
const { view, open, waitFor, replaceText, refuseWrites, close } = browser(() => server.url);

afterAll(async () => {
  close();
  await server.stop(true);
  rmSync(dataDir, { recursive: true, force: true });
});

const CELL = `.cell[data-key="message"] .cell-name`;
const SAVE = ".drawer .tool.add";

/** The page, with the message's drawer opened as a person opens it: a tap on the cell. */
async function openMessage() {
  await open();
  await waitFor(`document.querySelector(${JSON.stringify(CELL)})`);
  await view.click(CELL);
  await waitFor(`document.querySelector("textarea")`);
}

test("where you are is the URL's hash: the drawer open is #/?message, so a reload or a link opens it again", async () => {
  await openMessage();
  expect(await view.evaluate<string>(`location.hash`)).toBe("#/?message");
});

test(`${stories.stories.saves.name} -- Cmd+Enter, or Ctrl+Enter, in the box saves`, async () => {
  for (const key of ["Meta", "Control"] as const) {
    await openMessage();
    await waitFor(`document.querySelector("textarea")?.value`);
    await replaceText("textarea", `saved with ${key}+Enter`);
    await view.press("Enter", { modifiers: [key] });
    await waitFor(`document.querySelector(".toast.show.notify")?.textContent === "Saved"`);
  }
  await openMessage();
  await waitFor(`document.querySelector("textarea")?.value === "saved with Control+Enter"`);
});

test(`${stories.stories.refused.name} -- a save the server refuses says Not saved`, async () => {
  await openMessage();
  await waitFor(`document.querySelector("textarea")?.value === "saved with Control+Enter"`);
  await refuseWrites();
  await view.click(SAVE);
  await waitFor(`document.querySelector(".toast.show.alert")?.textContent === "Not saved"`);
});
