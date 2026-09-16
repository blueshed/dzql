import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import fixture from "./app.test.html";

let server: ReturnType<typeof Bun.serve>;

beforeAll(() => {
  // No eta server: app.ts connects a real WebSocket on load, so `/ws` just has to accept the
  // upgrade and go quiet -- every test drives the client itself by overriding that socket's
  // `send` and dispatching synthetic "message" events on it (see `stubSend`/`pushRender` below).
  server = Bun.serve({
    port: 0,
    routes: {
      "/": fixture,
      "/ws": (req, server) =>
        server.upgrade(req, { data: {} }) ? undefined : new Response("Upgrade failed", { status: 400 }),
    },
    websocket: { open() {}, message() {}, close() {} },
  });
});

afterAll(() => {
  server.stop(true);
});

async function waitFor(
  view: Bun.WebView,
  script: string,
  predicate: (value: unknown) => boolean,
  timeout = 5000,
): Promise<unknown> {
  const start = Date.now();
  let last: unknown;
  while (Date.now() - start < timeout) {
    last = await view.evaluate(script);
    if (predicate(last)) return last;
    await Bun.sleep(20);
  }
  throw new Error(`Timed out waiting for \`${script}\`; last value: ${JSON.stringify(last)}`);
}

/** Opens a fresh view on the fixture and waits for app.ts's socket to be open. */
async function open(): Promise<Bun.WebView> {
  const view = new Bun.WebView();
  await view.navigate(server.url.toString());
  await waitFor(view, `window.eta?.socket()?.readyState === 1`, (v) => v === true);
  return view;
}

/** Replaces the live socket's `send` with one that records to `window.__sent` instead of
 * putting anything on the wire -- the fixture's `/ws` route has nothing to say back anyway. */
async function stubSend(view: Bun.WebView): Promise<void> {
  await view.evaluate(`(() => {
    window.__sent = [];
    window.eta.socket().send = (data) => { window.__sent.push(JSON.parse(data)); };
  })()`);
}

/** Simulates the server pushing a full render, the way `src/compartments/render.ts`'s
 * `renderMessage` does -- a real "message" event on app.ts's own socket. */
async function pushRender(view: Bun.WebView, html: string): Promise<void> {
  const payload = JSON.stringify({ type: "render", html });
  await view.evaluate(
    `window.eta.socket().dispatchEvent(new MessageEvent("message", { data: ${JSON.stringify(payload)} }))`,
  );
}

describe("app.ts in a real browser, with a stubbed socket", () => {
  test("a full render with a matching data-moving element transitions in place and clears its name after", async () => {
    await using view = await open();
    await stubSend(view);

    await pushRender(view, `<div id="c-box" data-moving="box"><p>small</p></div>`);
    await waitFor(view, `document.querySelector('#c-box')?.textContent`, (v) => v === "small");

    // Tag the live node (a JS property, not an attribute the server's HTML could overwrite) and
    // watch its `style` attribute: proof the element itself survives the render, and proof K1
    // actually named it for a transition rather than the name coincidentally starting empty.
    await view.evaluate(`(() => {
      window.__seenNames = [];
      const el = document.querySelector('#c-box');
      el._probe = true;
      new MutationObserver((muts) => {
        for (const m of muts) window.__seenNames.push(el.style.viewTransitionName);
      }).observe(el, { attributes: true, attributeFilter: ["style"] });
    })()`);

    await pushRender(view, `<div id="c-box" data-moving="box"><p>big</p></div>`);
    await waitFor(view, `document.querySelector('#c-box')?.textContent`, (v) => v === "big");

    await waitFor(view, `window.__seenNames.includes("moving")`, (v) => v === true);
    const clearedAfter = await waitFor(
      view,
      `document.querySelector('#c-box')?.style.viewTransitionName ?? ""`,
      (v) => v === "",
    );
    expect(clearedAfter).toBe("");

    const keptIdentity = await view.evaluate(`document.querySelector('#c-box')._probe === true`);
    expect(keptIdentity).toBe(true);
  });

  test("a full render that newly marks an element data-reveal scrolls it into view", async () => {
    await using view = await open();
    await stubSend(view);

    const items = Array.from({ length: 20 }, (_, i) => `<div class="item" id="item-${i}">Item ${i}</div>`).join("");
    await pushRender(view, `<div class="list" id="list">${items}</div>`);
    await waitFor(view, `document.querySelectorAll('.item').length`, (v) => v === 20);

    // the list has to actually overflow for scrolling to be a real, observable distinction
    const overflows = await view.evaluate(
      `document.getElementById('list').scrollHeight > document.getElementById('list').clientHeight`,
    );
    expect(overflows).toBe(true);
    expect(await view.evaluate(`document.getElementById('list').scrollTop`)).toBe(0);

    const revealed = items.replace('id="item-19"', 'id="item-19" data-reveal="item-19"');
    await pushRender(view, `<div class="list" id="list">${revealed}</div>`);
    await waitFor(view, `document.getElementById('item-19')?.hasAttribute('data-reveal')`, (v) => v === true);

    const scrolled = await waitFor(view, `document.getElementById('list').scrollTop`, (v) => typeof v === "number" && v > 0);
    expect(scrolled as number).toBeGreaterThan(0);
  });

  test("a data-write-on=\"input\" form sends once after several keystrokes, debounced, and never repeats an unchanged value", async () => {
    await using view = await open();
    await stubSend(view);

    await pushRender(
      view,
      `<form data-write-on="input" id="f">
        <input name="q" id="q" value="" data-write='{"doc":"session","op":"replace","path":"/filter/guests"}'>
      </form>`,
    );
    await waitFor(view, `document.getElementById('q') !== null`, (v) => v === true);

    // Focused programmatically, not via view.click(): a real click on a `[data-write]` field is
    // also a `[data-write]` *click*, which app.ts's generic click handler (meant for buttons and
    // list items) would fire in its own right -- unrelated to K3, and not what this test is about.
    await view.evaluate(`document.getElementById('q').focus()`);
    await view.type("abc");

    // one message for the whole burst of keystrokes, not one per key -- debounced, so it may not
    // have landed the instant typing stops, but it never grows past the one commit
    await waitFor(view, `window.__sent.length`, (v) => v === 1, 1000);
    await Bun.sleep(300); // settle well past the debounce window; still just the one message
    expect(await view.evaluate(`window.__sent.length`)).toBe(1);
    expect(await view.evaluate(`window.__sent[0]`)).toEqual({
      doc: "session",
      ops: [{ op: "replace", path: "/filter/guests", value: "abc" }],
    });

    // clearing and retyping the same value recomputes the same ops -- nothing new to say, so
    // nothing new is sent, even once the debounce has had plenty of time to fire
    await view.evaluate(`document.getElementById('q').value = ""`);
    await view.evaluate(`document.getElementById('q').focus()`);
    await view.type("abc");
    await Bun.sleep(400);
    expect(await view.evaluate(`window.__sent.length`)).toBe(1);

    // a genuinely new value, then losing focus before the debounce would fire, flushes it at once
    await view.evaluate(`document.getElementById('q').value = ""`);
    await view.evaluate(`document.getElementById('q').focus()`);
    await view.type("xyz");
    await view.evaluate(`document.getElementById('q').blur()`);
    await waitFor(view, `window.__sent.length`, (v) => v === 2, 300);
    expect(await view.evaluate(`window.__sent[1]`)).toEqual({
      doc: "session",
      ops: [{ op: "replace", path: "/filter/guests", value: "xyz" }],
    });
  });
});
