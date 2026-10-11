import { test, expect, afterAll, setDefaultTimeout } from "bun:test";
import { connectWs, openDoc } from "@blueshed/delta/client";
import type { DeltaOp } from "@blueshed/delta/core";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { startServer } from "../src/server";
import type { Message } from "../src/resources/message/message-api";
import { browser } from "./browser";

// The message document: held by a client in this process, and by the page in a real browser
// (see browser.ts). There is no HTTP for it: open it and you are subscribed, send to change it.

setDefaultTimeout(30_000); // first browser start can be slow

const dataDir = mkdtempSync(`${tmpdir()}/message-`); // a scratch data folder, never the project's data/
let server = await startServer({ port: 0, dev: false, dataDir }); // random free port, no HMR
const { view, open, waitFor, replaceText, refuseWrites, withOtherWindow, close } = browser(() => server.url);

afterAll(async () => {
  close();
  await server.stop(true);
  rmSync(dataDir, { recursive: true, force: true });
});

// A client of the document from this process, as a page holds it; closed in a finally
async function holding(run: (doc: ReturnType<typeof openDoc<Message>>) => Promise<void>) {
  const client = connectWs(new URL("/ws", server.url).href);
  try {
    const doc = openDoc<Message>("message", client);
    await doc.ready;
    await run(doc);
  } finally {
    client.close();
  }
}

// --- The document ---
// Tests run in file order: the first one needs a data folder nothing has been saved to.

test("the message is Hello until someone changes it, and a change that is not a message is refused", async () => {
  await holding(async (doc) => {
    expect(doc.data.peek()).toEqual({ text: "Hello" });
    const refused: unknown[] = [
      [{ op: "replace", path: "/text", value: 1 }],
      [{ op: "remove", path: "/text" }],
      [{ op: "add", path: "/other", value: "x" }],
      "not ops",
    ];
    for (const ops of refused) {
      await expect(doc.send(ops as DeltaOp[])).rejects.toMatchObject({ code: 400, message: "a message is a replace of /text with a string" });
    }
    expect(doc.data.peek()).toEqual({ text: "Hello" });
  });
});

// --- The view, in a real browser ---

test("waiting for the page gives up, saying what it waited for", async () => {
  await open();
  await expect(waitFor("false", 100)).rejects.toThrow("Timed out waiting for: false");
});

test("the message is in the box, and a change made anywhere else shows in it", async () => {
  await open();
  await waitFor(`document.querySelector("textarea")?.value === "Hello"`);
  await holding((doc) => doc.send([{ op: "replace", path: "/text", value: "changed elsewhere" }]));
  await waitFor(`document.querySelector("textarea")?.value === "changed elsewhere"`);
});

test("saving says Saved once the server has it, and the message survives a reload", async () => {
  await open();
  await waitFor(`document.querySelector("textarea")?.value === "changed elsewhere"`);
  await replaceText("textarea", "typed in the browser");
  await view.click("button.primary");
  await waitFor(`document.querySelector(".toast.show.notify")?.textContent === "Saved"`);

  await open();
  await waitFor(`document.querySelector("textarea")?.value === "typed in the browser"`);
});

test("a save the server refuses says Not saved", async () => {
  await open();
  await waitFor(`document.querySelector("textarea")?.value === "typed in the browser"`);
  await refuseWrites();
  await view.click("button.primary");
  await waitFor(`document.querySelector(".toast.show.alert")?.textContent === "Not saved"`);
});

test("Cmd+Enter, or Ctrl+Enter, in the box saves", async () => {
  for (const key of ["Meta", "Control"] as const) {
    await open();
    await waitFor(`document.querySelector("textarea")?.value`);
    await replaceText("textarea", `saved with ${key}+Enter`);
    await view.press("Enter", { modifiers: [key] });
    await waitFor(`document.querySelector(".toast.show.notify")?.textContent === "Saved"`);
  }
  await open();
  await waitFor(`document.querySelector("textarea")?.value === "saved with Control+Enter"`);
});

test("a save shows in another window, and so does that window's save afterwards", async () => {
  await open();
  await waitFor(`document.querySelector("textarea")?.value === "saved with Control+Enter"`);
  await withOtherWindow(async (other, waitForOther) => {
    await waitForOther(`document.querySelector("textarea")?.value === "saved with Control+Enter"`);

    await replaceText("textarea", "from the first");
    await view.click("button.primary");
    await waitForOther(`document.querySelector("textarea")?.value === "from the first"`);

    await other.click("textarea");
    await other.type("!");
    await other.click("button.primary");
    await waitFor(`document.querySelector("textarea")?.value === "from the first!"`);
  });
});

test("typing that is not saved is not overwritten by another window's save", async () => {
  await open();
  await waitFor(`document.querySelector("textarea")?.value === "from the first!"`);
  await replaceText("textarea", "half-typed");
  await withOtherWindow(async (other, waitForOther) => {
    await waitForOther(`document.querySelector("textarea")?.value === "from the first!"`);
    await other.click("textarea");
    await other.type("?");
    await other.click("button.primary");
    await waitForOther(`document.querySelector(".toast.show.notify")?.textContent === "Saved"`);
  });
  await Bun.sleep(300); // time for the change to arrive, had it been taken
  expect(await view.evaluate<string>(`document.querySelector("textarea").value`)).toBe("half-typed");
});

test("after the server restarts, the page has what changed meanwhile and follows again", async () => {
  await open();
  await waitFor(`document.querySelector("textarea")?.value === "from the first!?"`);

  const port = server.port;
  await server.stop(true); // closes the page's socket
  await Bun.write(`${dataDir}/message.json`, JSON.stringify({ text: "changed while down" }));
  server = await startServer({ port, dev: false, dataDir });
  await waitFor(`document.querySelector("textarea")?.value === "changed while down"`, 10_000); // the page reconnects by itself

  await withOtherWindow(async (other, waitForOther) => {
    await waitForOther(`document.querySelector("textarea")?.value === "changed while down"`);
    await other.click("textarea");
    await other.type("!");
    await other.click("button.primary");
  });
  await waitFor(`document.querySelector("textarea")?.value === "changed while down!"`);
});
