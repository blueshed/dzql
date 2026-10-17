import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { urlFor, waitFor, webview } from "dzql/rendering/webview";
import { createServer } from "dzql/rendering/server";
import { example } from "../index";

// Chat with an assistant in the page: the tools the kernel registers from chat's own
// controls, used through a model context as the WebMCP draft has it, while the person uses the page.
// A person and an assistant in one browser are one session, so one cursor: each undoes its own.

let server: ReturnType<typeof createServer>;

beforeAll(() => {
  server = createServer(example, 0);
});

afterAll(() => {
  server.stop(true);
});

/** `document.modelContext` as the draft has it, keeping what it is given in `window.__registered`. */
const MODEL_CONTEXT = `(window.__registered = [], Object.defineProperty(document, "modelContext", { configurable: true, value: {
  registerTool(tool, { signal }) { window.__registered.push({ tool, signal }); return Promise.resolve(); },
} }), 1)`;

/** The names of the tools the page has registered and not withdrawn. */
const LIVE = `window.__registered.filter((r) => !r.signal.aborted).map((r) => r.tool.name)`;

/** Runs a registered tool, as the browser does for an assistant, and gives its answer. */
const execute = (view: Bun.WebView, name: string, input: unknown) =>
  view.evaluate<any>(`window.__registered.findLast((r) => r.tool.name === ${JSON.stringify(name)} && !r.signal.aborted).tool.execute(${JSON.stringify(input)}, { signal: new AbortController().signal })`);

const MESSAGES = `document.querySelector('.messages')?.textContent ?? ""`;

describe("chat, with an assistant in the page", () => {
  test("the assistant says something through the page's own form, the person says something by hand, and the assistant undoes its own change by its handle -- the person's stands", async () => {
    await using view = webview();
    await view.navigate(urlFor(view, server.url));
    await waitFor(view, `window.eta?.socket()?.readyState === 1`, (v) => v === true);
    await view.evaluate(MODEL_CONTEXT);

    // the person signs in and makes a room, by hand
    await waitFor(view, `document.querySelector('#name') !== null`, (v) => v === true);
    await view.click("#name");
    await view.type("Ada");
    await view.click("button[type=submit]");
    await waitFor(view, LIVE, (v) => (v as string[]).includes("go_into_a_new_room"));
    const room = `helpers-${crypto.randomUUID().slice(0, 8)}`;
    await view.click("input[name=room]");
    await view.type(room);
    await view.press("Enter");
    const live = await waitFor(view, LIVE, (v) => (v as string[]).includes("say_something"));
    expect((live as string[]).toSorted()).toEqual(["log_out", "redo", "say_something", "undo"]); // in a room: what chat labels -- say something, log out -- and undo, redo

    // the assistant: one call, the page's own write, answered with the handle that names it
    const said = await execute(view, "say_something", { text: "Booked the 9:40 to Nara" });
    expect(said).toMatchObject({ echoed: true, doc: `room:${room}`, ops: [{ op: "add", value: { text: "Booked the 9:40 to Nara", name: "Ada" } }] });
    expect(said.change).toMatch(/^[0-9a-f]{16}$/);
    await waitFor(view, MESSAGES, (v) => (v as string).includes("Nara"));

    // the person, by hand, after it
    await view.click("input[name=text]");
    await view.type("Thanks!");
    await view.click("button[type=submit]");
    await waitFor(view, MESSAGES, (v) => (v as string).includes("Thanks!"));

    // the session's last change is the person's; the assistant takes back its own, by its handle
    const undone = await execute(view, "undo", { change: said.change });
    expect(undone).toMatchObject({ echoed: true, doc: `room:${room}`, ops: [{ op: "remove" }] });
    const text = await waitFor(view, MESSAGES, (v) => !(v as string).includes("Nara"));
    expect(text).toContain("Thanks!");
    const again = await execute(view, "undo", { change: said.change });
    expect(again).toEqual({ id: again.id, refused: true, reason: "That change is undone already." });

    // and puts it back, as it was
    expect(await execute(view, "redo", { change: said.change })).toMatchObject({ echoed: true, ops: [{ op: "add", value: { text: "Booked the 9:40 to Nara" } }] });
    expect(await waitFor(view, MESSAGES, (v) => (v as string).includes("Nara"))).toContain("Thanks!");
  });
});
