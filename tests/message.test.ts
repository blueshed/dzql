import { test, expect, afterAll, setDefaultTimeout } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { startServer } from "../src/server";
import { browser } from "./browser";

// The message resource: its routes with fetch, its view in a real browser (see browser.ts).

setDefaultTimeout(30_000); // first browser start can be slow

const dataDir = mkdtempSync(`${tmpdir()}/message-`); // a scratch data folder, never the project's data/
let server = await startServer({ port: 0, dev: false, dataDir }); // random free port, no HMR
const { view, open, waitFor, replaceText, failFetch, withOtherWindow, close } = browser(() => server.url);

afterAll(async () => {
  close();
  await server.stop(true);
  rmSync(dataDir, { recursive: true, force: true });
});

const api = (path: string, init?: RequestInit) => fetch(new URL(path, server.url), init);
const putMessage = (body: string) => api("/api/message", { method: "PUT", body });

// --- The routes ---
// Tests run in file order: the first one needs a data folder nothing has been saved to.

test("GET /api/message answers the default before anything is saved", async () => {
  const res = await api("/api/message");
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ message: "Hello" });
});

test("PUT /api/message stores the message and GET answers it", async () => {
  const put = await putMessage(JSON.stringify({ message: "saved" }));
  expect(put.status).toBe(200);
  expect(await put.json()).toEqual({ message: "saved" });
  expect(await (await api("/api/message")).json()).toEqual({ message: "saved" });
  expect(await Bun.file(`${dataDir}/message.json`).json()).toEqual({ message: "saved" });
});

test("PUT /api/message refuses a body that is not a message, and keeps the old one", async () => {
  for (const body of ["not json", "{}", JSON.stringify({ message: 1 })]) {
    const res = await putMessage(body);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "message must be a string" });
  }
  expect(await (await api("/api/message")).json()).toEqual({ message: "saved" });
});

test("a BunFile keeps the size it first saw, which is why message-api makes a new one per read", async () => {
  const path = `${dataDir}/stale.json`;
  const stale = Bun.file(path);
  expect(await stale.exists()).toBe(false);
  await Bun.write(path, JSON.stringify({ message: "written" }));
  expect(await stale.exists()).toBe(true);
  expect(await stale.text()).toBe(""); // the size it saw: none
  expect(await Bun.file(path).json()).toEqual({ message: "written" });
});

test("/ws upgrades, and a socket is told every saved message", async () => {
  expect((await api("/ws")).status).toBe(426); // plain HTTP

  const ws = new WebSocket(new URL("/ws", server.url.href.replace("http", "ws")));
  await new Promise((open) => (ws.onopen = open));
  ws.send("ignored"); // the page only listens; the server takes no notice
  const told = new Promise<string>((done) => (ws.onmessage = (e) => done(String(e.data))));
  await putMessage(JSON.stringify({ message: "pushed" }));
  expect(JSON.parse(await told)).toEqual({ message: "pushed" });
  ws.close();
});

// --- The view, in a real browser ---

test("waiting for the page gives up, saying what it waited for", async () => {
  await open();
  await expect(waitFor("false", 100)).rejects.toThrow("Timed out waiting for: false");
});

test("the saved message is in the box", async () => {
  await putMessage(JSON.stringify({ message: "in the box" }));
  await open();
  await waitFor(`document.querySelector("textarea")?.value === "in the box"`);
});

test("saving says Saved once the server has it, and the message survives a reload", async () => {
  await open();
  await waitFor(`document.querySelector("textarea")?.value === "in the box"`);
  await replaceText("textarea", "typed in the browser");
  await view.click("button.primary");
  await waitFor(`document.querySelector(".toast.show.notify")?.textContent === "Saved"`);

  expect(await (await api("/api/message")).json()).toEqual({ message: "typed in the browser" });
  await open();
  await waitFor(`document.querySelector("textarea")?.value === "typed in the browser"`);
});

test("a save the server did not take says Not saved", async () => {
  await open();
  await waitFor(`document.querySelector("textarea")?.value === "typed in the browser"`);
  await failFetch();
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
    expect(await (await api("/api/message")).json()).toEqual({ message: `saved with ${key}+Enter` });
  }
});

test("a message that cannot be loaded says so", async () => {
  await open();
  await waitFor(`document.querySelector("textarea")`);
  await failFetch();
  // leave the page and come back: the view loads again, into a failing fetch
  await view.evaluate(`location.hash = "#/elsewhere"`);
  await waitFor(`document.body.textContent.includes("Page not found!")`);
  await view.evaluate(`location.hash = "#/"`);
  await waitFor(`document.body.textContent.includes("The message could not be loaded.")`);
});

test("a save shows in another window, and so does that window's save afterwards", async () => {
  await putMessage(JSON.stringify({ message: "two windows" }));
  await open();
  await waitFor(`document.querySelector("textarea")?.value === "two windows"`);
  await withOtherWindow(async (other, waitForOther) => {
    await waitForOther(`document.querySelector("textarea")?.value === "two windows"`);

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
  expect(await (await api("/api/message")).json()).toEqual({ message: "from the first!?" });
  await Bun.sleep(300); // time for the push to arrive, had it been taken
  expect(await view.evaluate<string>(`document.querySelector("textarea").value`)).toBe("half-typed");
});

test("after the server restarts, the page loads what changed meanwhile and follows again", async () => {
  await open();
  await waitFor(`document.querySelector("textarea")?.value === "from the first!?"`);

  const port = server.port;
  await server.stop(true); // closes the page's socket
  await Bun.write(`${dataDir}/message.json`, JSON.stringify({ message: "changed while down" }));
  server = await startServer({ port, dev: false, dataDir });
  await waitFor(`document.querySelector("textarea")?.value === "changed while down"`);

  await putMessage(JSON.stringify({ message: "after the restart" }));
  await waitFor(`document.querySelector("textarea")?.value === "after the restart"`);
});
