import { test, expect, afterAll, setDefaultTimeout } from "bun:test";
import type { Holding } from "dzql/rendering/test-socket";
import type { DeltaOp } from "@blueshed/delta/core";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { startServer } from "../src/routes";
import type { MessageDoc } from "../src/resources/message/message-api";
import { browser } from "./browser";
import { documents } from "./documents";
import { stories } from "../stories";

// The message document: held by a client in this process (documents.ts), and by the page in a
// real browser (browser.ts). There is no HTTP for it: open it and you are subscribed, send to
// change it. What is here is what any page of it does, light or drawn on the server, so it stays
// as it is when the page moves to the server; what the light page alone does is message-view.test.ts.

setDefaultTimeout(30_000); // first browser start can be slow

const dataDir = mkdtempSync(`${tmpdir()}/message-`); // a scratch data folder, never the project's data/
let server = await startServer({ port: 0, dev: false, dataDir }); // random free port, no HMR
const { view, open, waitFor, replaceText, withOtherWindow, refuseWrites, close } = browser(() => server.url);

afterAll(async () => {
  close();
  await server.stop(true);
  rmSync(dataDir, { recursive: true, force: true });
});

// The document from this process, as a page holds it (documents.ts); let go in a finally
async function holding(run: (doc: Holding<MessageDoc>) => Promise<void>) {
  const client = await documents(server);
  try {
    await run(await client.open<MessageDoc>("message:1"));
  } finally {
    client.close();
  }
}

// --- The document ---
// Tests run in file order: the first one needs a data folder nothing has been saved to.

test("the message is Hello until someone changes it, and a change the schema does not take is refused", async () => {
  await holding(async (doc) => {
    expect(doc.value()).toEqual({ messages: { id: 1, text: "Hello" } });
    // what each says, in the words every store says it (one on SQLite also names the path)
    const refused: [unknown[], RegExp][] = [
      [[{ op: "replace", path: "/messages/1/text", value: 1 }], /text must be a string/],
      [[{ op: "remove", path: "/messages/1/text" }], /invalid op: remove \/messages\/1\/text/i],
      [[{ op: "replace", path: "/messages/1/other", value: "x" }], /Unknown field: other/],
      [[{ op: "add", path: "/other", value: "x" }], /unknown collection: other/i],
      [[null], /^An op is an object: \{ op, path, value \}$/],
      ["not ops" as unknown as unknown[], /^ops must be an array$/],
    ];
    for (const [ops, message] of refused) {
      await expect(doc.send(ops as DeltaOp[])).rejects.toMatchObject({ code: 400, message: expect.stringMatching(message) });
    }
    expect(doc.value()).toEqual({ messages: { id: 1, text: "Hello" } });
  });
});

test("an empty change is taken, and nothing is written", async () => {
  await holding(async (doc) => {
    expect(await doc.send([])).toMatchObject({ ack: true });
    await Bun.sleep(100); // time for a write, had there been one
    expect(doc.value()).toEqual({ messages: { id: 1, text: "Hello" } });
    expect(await Bun.file(`${dataDir}/message.json`).exists()).toBe(false);
  });
});

// --- The view, in a real browser ---
// The message is a cell on the box; its ✎ opens its drawer, where the box it is typed in and Save are.

const CELL = `.cell[data-key="message"] .cell-name`;
const SAVE = ".drawer .tool.add";
/** Saved, said where a person hears it: a line that is a status. */
const SAID = (words: string) => `[...document.querySelectorAll('[role="status"]')].some((s) => s.textContent.trim() === "${words}")`;
/** Not saved, said where a person hears it at once: a line that is an alert. */
const ALERT = (words: string) => `[...document.querySelectorAll('[role="alert"]')].some((s) => s.textContent.trim() === "${words}")`;

/** The page, with the message's drawer opened as a person opens it: a tap on the cell. */
async function openMessage(on: Bun.WebView = view, waitIn: (expr: string) => Promise<void> = waitFor) {
  if (on === view) await open();
  await waitIn(`document.querySelector(${JSON.stringify(CELL)})`);
  await on.click(CELL);
  await waitIn(`document.querySelector("textarea")`);
}

test("waiting for the page gives up, saying what it waited for", async () => {
  await open();
  await expect(waitFor("false", 100)).rejects.toThrow("Timed out waiting for: false");
});

test(`${stories.stories.follows.name} -- the message is on the box and in its drawer, and a change made anywhere else shows in both`, async () => {
  await open();
  await waitFor(`document.querySelector(".cell[data-key=message] .cell-summary")?.textContent === "Hello"`);
  await openMessage();
  await waitFor(`document.querySelector("textarea")?.value === "Hello"`);
  await holding((doc) => doc.send([{ op: "replace", path: "/messages/1/text", value: "changed elsewhere" }]));
  await waitFor(`document.querySelector("textarea")?.value === "changed elsewhere"`);
  await waitFor(`document.querySelector(".cell[data-key=message] .cell-summary")?.textContent === "changed elsewhere"`);
});

test("the drawer goes as it came: its ×, Escape, or Back, and the box behind is as it was", async () => {
  for (const away of [`document.querySelector(".drawer-close").click()`, `document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }))`, `history.back()`]) {
    await openMessage();
    await view.evaluate(away);
    await waitFor(`!document.querySelector(".drawer")`);
    expect(await view.evaluate<string>(`document.querySelector(${JSON.stringify(CELL)}).getAttribute("aria-expanded")`)).toBe("false");
  }
});

test("where you are is the URL: the drawer open, it ends ?message, so a reload opens it again", async () => {
  await openMessage();
  await waitFor(`location.href.endsWith("?message")`);
  await view.evaluate(`(window.before = true, location.reload())`);
  await waitFor(`!window.before && document.querySelector("textarea")`);
});

test(`${stories.stories.saves.name} -- saving says Saved once the server has it, and the message survives a reload`, async () => {
  await openMessage();
  await waitFor(`document.querySelector("textarea")?.value === "changed elsewhere"`);
  await replaceText("textarea", "typed in the browser");
  await view.click(SAVE);
  await waitFor(SAID("Saved"));

  await openMessage();
  await waitFor(`document.querySelector("textarea")?.value === "typed in the browser"`);
});

test(`${stories.stories.follows.name} -- a save shows in another window, and so does that window's save afterwards`, async () => {
  await openMessage();
  await waitFor(`document.querySelector("textarea")?.value === "typed in the browser"`);
  await withOtherWindow(async (other, waitForOther) => {
    await openMessage(other, waitForOther);
    await waitForOther(`document.querySelector("textarea")?.value === "typed in the browser"`);

    await replaceText("textarea", "from the first");
    await view.click(SAVE);
    await waitForOther(`document.querySelector("textarea")?.value === "from the first"`);

    await other.click("textarea");
    await other.type("!");
    await other.click(SAVE);
    await waitFor(`document.querySelector("textarea")?.value === "from the first!"`);
  });
});

test(`${stories.stories.refused.name} -- typing that is not saved is not overwritten by another window's save`, async () => {
  await openMessage();
  await waitFor(`document.querySelector("textarea")?.value === "from the first!"`);
  await replaceText("textarea", "half-typed");
  await withOtherWindow(async (other, waitForOther) => {
    await openMessage(other, waitForOther);
    await waitForOther(`document.querySelector("textarea")?.value === "from the first!"`);
    await other.click("textarea");
    await other.type("?");
    await other.click(SAVE);
    await waitForOther(SAID("Saved"));
  });
  await Bun.sleep(300); // time for the change to arrive, had it been taken
  expect(await view.evaluate<string>(`document.querySelector("textarea").value`)).toBe("half-typed");
});

test(`${stories.stories.refused.name} -- a save the server refuses says Not saved, and what was typed stays in the box`, async () => {
  await openMessage();
  await waitFor(`document.querySelector("textarea")?.value === "from the first!?"`);
  await replaceText("textarea", "not to be kept");
  await refuseWrites();
  await view.click(SAVE);
  await waitFor(ALERT("Not saved"));
  await waitFor(`document.querySelector("textarea")?.value === "not to be kept"`);
  await holding(async (doc) => expect(doc.value().messages.text).toBe("from the first!?"));
});

test(`${stories.stories.restarts.name} -- after the server restarts, the page has what changed meanwhile and follows again`, async () => {
  await openMessage();
  await waitFor(`document.querySelector("textarea")?.value === "from the first!?"`);

  const port = server.port;
  await server.stop(true); // closes the page's socket
  // meanwhile, another server on the data folder changes it
  const meanwhile = await startServer({ port: 0, dev: false, dataDir });
  server = meanwhile;
  await holding((doc) => doc.send([{ op: "replace", path: "/messages/1/text", value: "changed while down" }]));
  await meanwhile.stop(true);
  server = await startServer({ port, dev: false, dataDir });
  await waitFor(`document.querySelector("textarea")?.value === "changed while down"`, 10_000); // the page reconnects by itself

  await withOtherWindow(async (other, waitForOther) => {
    await openMessage(other, waitForOther);
    await waitForOther(`document.querySelector("textarea")?.value === "changed while down"`);
    await other.click("textarea");
    await other.type("!");
    await other.click(SAVE);
  });
  await waitFor(`document.querySelector("textarea")?.value === "changed while down!"`);
});
