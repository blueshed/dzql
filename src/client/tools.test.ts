import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { write, appletWrites } from "../html";
import { waitFor } from "../webview";
import { renderMessage } from "../compartments/render";
import fixture from "./tools.test.html";
import plain from "./app.test.html";

// The page's writes as tools (src/client/tools.ts), and a script's write answered by its id
// (todo n88, n99), in a real browser. As in app.test.ts: no eta server, a socket that goes quiet,
// and each test sends what the server would on app.ts's own socket.

let server: ReturnType<typeof Bun.serve>;

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    routes: {
      "/": fixture,
      "/plain": plain,
      "/ws": (req, server) => (server.upgrade(req, { data: {} }) ? undefined : new Response("Upgrade failed", { status: 400 })),
    },
    websocket: { open() {}, message() {}, close() {} },
  });
});

afterAll(() => {
  server.stop(true);
});

async function open(path = "/"): Promise<Bun.WebView> {
  const view = new Bun.WebView();
  await view.navigate(new URL(path, server.url).toString());
  await waitFor(view, `window.eta?.socket()?.readyState === 1`, (v) => v === true);
  await view.evaluate(`(() => {
    window.__sent = [];
    window.eta.socket().send = (data) => window.__sent.push(JSON.parse(data));
  })()`);
  return view;
}

async function push(view: Bun.WebView, message: unknown): Promise<void> {
  const data = typeof message === "string" ? message : JSON.stringify(message);
  await view.evaluate(`window.eta.socket().dispatchEvent(new MessageEvent("message", { data: ${JSON.stringify(data)} }))`);
}

const render = (view: Bun.WebView, html: string) => push(view, renderMessage(html));

/** Starts a script's write in the page, kept as `window.__answer` once it is answered. */
const start = (view: Bun.WebView, call: string) => view.evaluate(`(window.__answer = undefined, ${call}.then((a) => (window.__answer = a)), 1)`);
const answer = (view: Bun.WebView) => waitFor(view, `window.__answer`, (v) => v !== undefined);
const lastSent = (view: Bun.WebView) => view.evaluate<{ id: number; doc: string; ops: unknown[] }>(`window.__sent.at(-1)`);

const say = write("room", "add", "/messages/-");
const PAGE = [
  `<form${say} aria-label="Say something"><fieldset name="words"><input name="text" required placeholder="Message"></fieldset><input type="hidden" name="to" value="all"><output name="count">0</output><button name="go">Send</button></form>`,
  `<form data-write-on="change"><legend>The trip</legend>`,
  `<input name="title" value="Kyoto" aria-label="Title"${write("trip", "replace", "/stops/4/title")}>`,
  `<label>Day <input name="day" type="date" value=""${write("trip", "replace", "/stops/4/day")}></label>`,
  `<select name="kind"${write("trip", "replace", "/stops/4/kind")}><option>see</option><option>eat</option><option disabled>gone</option></select>`,
  `<input type="checkbox" name="booked" aria-label="Booked"${write("trip", "replace", "/stops/4/booked")}>`,
  `</form>`,
  `<nav><button${write("session", "replace", "/page", "rooms")}>Rooms</button><button${write("session", "replace", "/page", "?profile")}>Profile</button></nav>`,
  `<li aria-label="Take back hi"${write("room", "remove", "/messages/12")}>hi ×</li>`,
  `<div data-applet="cal" aria-label="The calendar"${appletWrites(["leave", "replace", "/requests/*/starts"], ["leave", "remove", "/requests/*"])}></div>`,
  `<button${write("ledger", "remove", "/latest")}>Undo</button>`,
  `<div inert><button${write("x", "remove", "/behind")}>Behind</button></div>`,
  `<button hidden${write("x", "remove", "/hidden")}>Hidden</button>`,
  `<button disabled${write("x", "remove", "/off")}>Off</button>`,
  `<fieldset disabled><button${write("x", "remove", "/fenced")}>Fenced</button></fieldset>`,
].join("");

describe("the page's writes, as tools", () => {
  test("each control a person could press now is a tool, named by its write: a form, an editing form (one for all its fields), buttons that make one write, an applet's declared writes; then undo and redo", async () => {
    await using view = await open();
    await render(view, PAGE);
    const tools = await view.evaluate<{ name: string; title: string; description: string; inputSchema: unknown }[]>(`window.eta.tools()`);
    expect(tools.map((t) => t.name)).toEqual([
      "add.room.messages.-",
      "edit.trip.stops.4",
      "replace.session.page",
      "remove.room.messages.12",
      "replace.leave.requests._.starts",
      "remove.leave.requests._",
      "undo",
      "redo",
    ]);
    expect(tools[0]).toEqual({
      name: "add.room.messages.-",
      title: "Say something",
      description: "Say something: the form that add /messages/- on room.",
      inputSchema: { type: "object", properties: { text: { type: "string", description: "Message" } }, required: ["text"] },
    });
    expect(tools[1]).toMatchObject({
      title: "The trip",
      description: "The trip: sets any of title, day, kind, booked on trip, in one write.",
      inputSchema: {
        type: "object",
        properties: {
          title: { type: "string", description: "Title" },
          day: { type: "string", format: "date", description: "Day" },
          kind: { enum: ["see", "eat"], description: "kind" },
          booked: { type: "boolean", description: "Booked" },
        },
      },
    });
    expect(tools[2]).toMatchObject({
      title: "replace /page on session",
      description: "replace /page on session: replace /page on session, with the value of the one pressed.",
      inputSchema: { type: "object", properties: { value: { enum: ["rooms", "?profile"] } } },
    });
    expect(tools[3]).toMatchObject({ title: "Take back hi", description: "Take back hi: remove /messages/12 on room.", inputSchema: { type: "object", properties: {} } });
    expect(tools[4]).toMatchObject({
      title: "The calendar",
      inputSchema: { type: "object", properties: { path: { type: "string", pattern: "^/requests/(?!-/|-$)[^/]+/starts$" }, value: {} }, required: ["path", "value"] },
    });
    expect(tools[5]!.inputSchema).toEqual({ type: "object", properties: { path: { type: "string", pattern: "^/requests/(?!-/|-$)[^/]+$", description: "/requests/*, each * an id" } }, required: ["path"] });
    expect(tools[6]).toMatchObject({ title: "Undo", inputSchema: { type: "object", properties: { change: { type: "string" } } } });
  });

  test("a tool makes its control's write and nothing else, with an id, and answers what came of it: its echo, with the handle that names the change, or its refusal and why", async () => {
    await using view = await open();
    await render(view, PAGE);

    await start(view, `window.eta.use("add.room.messages.-", { text: "hi", to: "someone" })`);
    const sent = await lastSent(view);
    expect(sent).toEqual({ id: sent.id, doc: "room", ops: [{ op: "add", path: "/messages/-", value: { text: "hi", to: "all" } }] }); // the hidden field is the page's
    await push(view, { type: "patch", doc: "room:general", version: 7, ops: [{ op: "add", path: "/messages/13", value: { text: "hi" } }], id: sent.id, change: "0a1b2c3d4e5f6a7b" });
    expect(await answer(view)).toEqual({ id: sent.id, echoed: true, doc: "room:general", version: 7, ops: [{ op: "add", path: "/messages/13", value: { text: "hi" } }], change: "0a1b2c3d4e5f6a7b" });

    // several fields in one write, as the form commits them; the others left as they are
    await start(view, `window.eta.use("edit.trip.stops.4", { title: "Nara", kind: "eat", booked: true })`);
    const edit = await lastSent(view);
    expect(edit.ops).toEqual([
      { op: "replace", path: "/stops/4/title", value: "Nara" },
      { op: "replace", path: "/stops/4/kind", value: "eat" },
      { op: "replace", path: "/stops/4/booked", value: true },
    ]);
    await push(view, { type: "refused", id: edit.id, reason: "Nara is not on this journey." });
    expect(await answer(view)).toEqual({ id: edit.id, refused: true, reason: "Nara is not on this journey." });

    await start(view, `window.eta.use("replace.session.page", { value: "?profile" })`);
    expect((await lastSent(view)).ops).toEqual([{ op: "replace", path: "/page", value: "?profile" }]);
    await push(view, { type: "refused", id: (await lastSent(view)).id });
    expect(await answer(view)).toEqual({ id: (await lastSent(view)).id, refused: true });

    await start(view, `window.eta.use("remove.room.messages.12")`);
    expect((await lastSent(view)).ops).toEqual([{ op: "remove", path: "/messages/12" }]);
    const moved = (await view.evaluate<{ name: string }[]>(`window.eta.tools()`))[4]!.name;
    await start(view, `window.eta.use(${JSON.stringify(moved)}, { path: "/requests/9/starts", value: "2026-10-01" })`);
    expect((await lastSent(view)).ops).toEqual([{ op: "replace", path: "/requests/9/starts", value: "2026-10-01" }]);

    // a write that is not the tool's is not sent, and says why: a field the form needs, an applet's
    // path, a control the page does not offer now. What a
    // control offers is the schema's to say, and the server's to permit, as it is for a person
    const count = await view.evaluate<number>(`window.__sent.length`);
    for (const [name, input, why] of [
      ["add.room.messages.-", {}, "Give text."],
      ["edit.trip.stops.4", {}, "Give one or more of title, day, kind, booked."],
      [moved, { path: "/requests/-/starts", value: "x" }, "path is /requests/*/starts, each * an id"],
      [moved, { path: "/requests/9/ends", value: "x" }, "path is /requests/*/starts, each * an id"],
      ["remove.x.behind", {}, "This page offers no remove.x.behind now: ask for its tools again."],
    ] as const) {
      await start(view, `window.eta.use(${JSON.stringify(name)}, ${JSON.stringify(input)})`);
      expect({ name, input, answer: await answer(view) }).toEqual({ name, input, answer: { unsent: why } });
    }
    expect(await view.evaluate<number>(`window.__sent.length`)).toBe(count);
  });

  test("where buttons and a form make one write -- the rooms there are, and a new one -- the later is told apart by its kind", async () => {
    await using view = await open();
    await render(view, `<button${write("session", "replace", "/room", "general")}>#general</button><form${write("session", "replace", "/room")}><input name="room" required><button>Go in</button></form>`);
    expect((await view.evaluate<{ name: string }[]>(`window.eta.tools()`)).map((t) => t.name)).toEqual(["replace.session.room", "replace.session.room.form", "undo", "redo"]);
    await start(view, `window.eta.use("replace.session.room.form", { room: "attic" })`);
    expect((await lastSent(view)).ops).toEqual([{ op: "replace", path: "/room", value: "attic" }]);
    await start(view, `window.eta.use("replace.session.room")`);
    expect((await lastSent(view)).ops).toEqual([{ op: "replace", path: "/room", value: "general" }]);
  });

  test("undo and redo walk the session's last change, or the one a handle names: eta.undo(), eta.undo(handle), the undo tool", async () => {
    await using view = await open();
    await render(view, PAGE);
    const walks: unknown[] = [];
    for (const call of [`window.eta.undo()`, `window.eta.undo("0a1b2c3d4e5f6a7b")`, `window.eta.redo("0a1b2c3d4e5f6a7b")`, `window.eta.redo()`, `window.eta.use("undo", { change: "0a1b2c3d4e5f6a7b" })`, `window.eta.use("redo")`]) {
      await start(view, call);
      const { doc, ops } = await lastSent(view);
      walks.push({ doc, ops });
    }
    expect(walks).toEqual([
      { doc: "ledger", ops: [{ op: "remove", path: "/latest" }] },
      { doc: "ledger", ops: [{ op: "remove", path: "/0a1b2c3d4e5f6a7b" }] },
      { doc: "ledger", ops: [{ op: "add", path: "/0a1b2c3d4e5f6a7b" }] },
      { doc: "ledger", ops: [{ op: "add", path: "/latest" }] },
      { doc: "ledger", ops: [{ op: "remove", path: "/0a1b2c3d4e5f6a7b" }] },
      { doc: "ledger", ops: [{ op: "add", path: "/latest" }] },
    ]);
  });

  test("a script's write answers by its own id, never another's echo; one on its way when the socket goes is unanswered; one that cannot go is unsent", async () => {
    await using view = await open();
    await render(view, PAGE);
    await start(view, `window.eta.send("room", [{ op: "add", path: "/messages/-", value: "mine" }])`);
    const mine = await lastSent(view);
    await push(view, { type: "patch", doc: "room:general", version: 8, ops: [{ op: "add", path: "/messages/14", value: "theirs" }] }); // someone else's
    await push(view, { type: "refused", id: mine.id - 1 }); // an earlier write's
    expect(await view.evaluate(`window.__answer`)).toBeUndefined();
    await view.evaluate(`window.eta.socket().close()`);
    expect(await answer(view)).toEqual({ id: mine.id, unanswered: true });
    await start(view, `window.eta.send("room", [{ op: "add", path: "/messages/-", value: "while down" }])`);
    expect(await answer(view)).toEqual({ unsent: "The page is not connected just now: try again in a moment." });
    await start(view, `window.eta.use("undo")`);
    expect(await answer(view)).toEqual({ unsent: "The page is not connected just now: try again in a moment." });
  });
});

/** A model context as the WebMCP draft has it -- `document.modelContext.registerTool(tool, { signal })`, a promise -- kept in `window.__registered`. */
const DRAFT = `Object.defineProperty(document, "modelContext", { configurable: true, value: {
  registerTool(tool, { signal }) { window.__registered.push({ tool, signal }); return Promise.resolve(); },
} })`;

const registered = (view: Bun.WebView) =>
  view.evaluate<{ name: string; live: boolean }[]>(`window.__registered.map(({ tool, signal }) => ({ name: tool.name, live: !signal.aborted }))`);

describe("WebMCP: the page's tools registered with the browser's model context", () => {
  test("at each drawing: a tool once while the page offers it as it was; withdrawn (its signal aborted) when it goes or changes, and registered anew; execute runs it against the page as it is", async () => {
    await using view = await open();
    await view.evaluate(`(window.__registered = [], ${DRAFT}, 1)`);
    await render(view, PAGE);
    const first = await registered(view);
    expect(first.map((r) => r.name)).toEqual((await view.evaluate<{ name: string }[]>(`window.eta.tools()`)).map((t) => t.name));
    expect(first.every((r) => r.live)).toBe(true);

    await render(view, PAGE); // the same page drawn again: nothing registered again
    expect(await registered(view)).toEqual(first);

    // the rooms button gone, so the page's buttons make one write; the message taken back gone
    await render(view, PAGE.replace(`<button${write("session", "replace", "/page", "rooms")}>Rooms</button>`, "").replace(/<li[^]*?<\/li>/, ""));
    const now = await registered(view);
    expect(now.filter((r) => !r.live).map((r) => r.name)).toEqual(["replace.session.page", "remove.room.messages.12"]);
    expect(now.slice(first.length)).toEqual([{ name: "replace.session.page", live: true }]);

    await start(view, `window.__registered.at(-1).tool.execute({})`);
    expect((await lastSent(view)).ops).toEqual([{ op: "replace", path: "/page", value: "?profile" }]);
  });

  test("a registration refused, by a throw or a rejection, is tried again at the next drawing; with no model context nothing is registered, and nothing fails", async () => {
    await using view = await open();
    await render(view, PAGE); // no model context: the page is drawn, its tools are listed
    expect((await view.evaluate<unknown[]>(`window.eta.tools()`)).length).toBe(8);

    await view.evaluate(`(window.__registered = [], Object.defineProperty(document, "modelContext", { configurable: true, value: {
      registerTool(tool, { signal }) {
        if (tool.name === "undo" && !window.__refusedOnce) { window.__refusedOnce = true; throw new DOMException("not now", "NotAllowedError"); }
        if (tool.name === "redo" && !window.__rejectedOnce) { window.__rejectedOnce = true; return Promise.reject(new DOMException("not now", "InvalidStateError")); }
        window.__registered.push({ tool, signal });
        return Promise.resolve();
      },
    } }), 1)`);
    await render(view, PAGE);
    expect((await registered(view)).map((r) => r.name)).not.toContain("undo");
    await render(view, PAGE);
    expect((await registered(view)).map((r) => r.name).filter((n) => n === "undo" || n === "redo")).toEqual(["undo", "redo"]); // tried again
  });

  test("a page whose app does not import the tools offers none: nothing registered, no eta.tools", async () => {
    await using view = await open("/plain");
    await view.evaluate(`(window.__registered = [], ${DRAFT}, 1)`);
    await render(view, PAGE);
    expect(await view.evaluate<unknown[]>(`[typeof window.eta.tools, typeof window.eta.use, typeof window.eta.send, window.__registered.length]`)).toEqual(["undefined", "undefined", "function", 0]);
  });
});
