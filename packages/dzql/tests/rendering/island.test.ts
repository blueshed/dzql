import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import fixture from "./island.test.html";
import { press, waitFor, webview } from "../../src/rendering/webview";

let server: ReturnType<typeof Bun.serve>;

beforeAll(() => {
  server = Bun.serve({ port: 0, routes: { "/": fixture } });
});

afterAll(() => {
  server.stop(true);
});

/** A fresh browser on the fixture, its islands on `window`. */
async function open(): Promise<Bun.WebView> {
  const view = webview();
  await view.navigate(server.url.toString());
  await waitFor(view, `typeof window.counter`, (v) => v === "object");
  return view;
}

/** Runs `script` in `view` with the fixture's `#root` as `el`. */
const inRoot = (view: Bun.WebView, script: string): Promise<unknown> => view.evaluate(`(() => { const el = document.querySelector('#root'); ${script} })()`);

/** Runs `script` in a fresh browser, as `inRoot`. */
async function run(script: string): Promise<unknown> {
  await using view = await open();
  return await inRoot(view, script);
}

describe("an island: a railroad component as an applet", () => {
  test("mounts over what the server drew inside it, having read it; its props, its update and its document's ops redraw it; its cleanup takes it away", async () => {
    await using view = await open();
    await inRoot(view, `
      window.sent = [];
      window.cleanup = window.counter.mount(el, { props: { n: 1 }, send: (doc, ops) => sent.push({ doc, ops }) });
      window.mounted = [el.querySelector('.n').textContent, el.querySelector('i').textContent, el.childNodes.length];
    `);
    await press(view, "#root button");
    const result = await inRoot(view, `
      const text = () => el.querySelector('.n')?.textContent ?? null;
      window.counter.update(el, { n: 5 });
      const updated = text();
      window.counter.patch(el, [{ op: "replace", path: "/n", value: 7 }, { op: "replace", path: "/other", value: 0 }]);
      const patched = text();
      cleanup();
      window.counter.update(el, { n: 9 }); // gone: nothing to set
      window.counter.patch(el, [{ op: "replace", path: "/n", value: 9 }]);
      return { mounted, sent, updated, patched, after: el.childNodes.length };
    `);
    expect(result).toEqual({
      mounted: ["1", "what the server drew", 1],
      sent: [{ doc: "count", ops: [{ op: "replace", path: "/n", value: 2 }] }],
      updated: "5",
      patched: "7",
      after: 0,
    });
  });

  test("never touches its own element's attributes: those are the page's, the morph's to keep", async () => {
    const result = await run(`
      const before = [...el.attributes].map((a) => a.name + '=' + a.value).join(' ');
      const cleanup = window.counter.mount(el, { props: { n: 1 }, send: () => {} });
      window.counter.update(el, { n: 2 });
      const after = [...el.attributes].map((a) => a.name + '=' + a.value).join(' ');
      cleanup();
      return before === after;
    `);
    expect(result).toBe(true);
  });

  test("one given no reduce takes no ops: its props come from renders alone", async () => {
    const result = await run(`
      const cleanup = window.still.mount(el, { props: { n: 3 }, send: () => {} });
      window.still.update(el, { n: 4 });
      const text = el.textContent;
      cleanup();
      return { text, patch: typeof window.still.patch };
    `);
    expect(result).toEqual({ text: "4", patch: "undefined" });
  });
});
