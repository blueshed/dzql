import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import fixture from "./island.test.html";
import { waitFor } from "./webview";

let server: ReturnType<typeof Bun.serve>;

beforeAll(() => {
  server = Bun.serve({ port: 0, routes: { "/": fixture } });
});

afterAll(() => {
  server.stop(true);
});

/** Runs `script` in a fresh browser with the fixture's `#root` as `el` and its islands on `window`. */
async function run(script: string): Promise<unknown> {
  await using view = new Bun.WebView();
  await view.navigate(server.url.toString());
  await waitFor(view, `typeof window.counter`, (v) => v === "object");
  return await view.evaluate(`(() => { const el = document.querySelector('#root'); ${script} })()`);
}

describe("an island: a railroad component as an applet", () => {
  test("mounts over what the server drew inside it, having read it; its props, its update and its document's ops redraw it; its cleanup takes it away", async () => {
    const result = await run(`
      const sent = [];
      const cleanup = window.counter.mount(el, { props: { n: 1 }, send: (doc, ops) => sent.push({ doc, ops }) });
      const text = () => el.querySelector('.n')?.textContent ?? null;
      const mounted = [text(), el.querySelector('i').textContent, el.childNodes.length];
      el.querySelector('button').click();
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
