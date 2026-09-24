import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import fixture from "./app.test.html";

let server: ReturnType<typeof Bun.serve>;

/** A write the client sent, as `stubSend` keeps it in `window.__sent`. */
type Sent = { doc: string; ops: { op: string; path: string; value?: unknown }[] };

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

/** Simulates the server sending any message -- a patch, a render in parts -- on app.ts's own socket. */
async function push(view: Bun.WebView, message: unknown): Promise<void> {
  const payload = JSON.stringify(message);
  await view.evaluate(`window.eta.socket().dispatchEvent(new MessageEvent("message", { data: ${JSON.stringify(payload)} }))`);
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

    await pushRender(view, `<div id="c-box" data-moving="box" class="open"><p>big</p></div>`);
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

  test("what changes inside a data-moving element is not a move: no transition, so nobody's typing is swallowed by one", async () => {
    await using view = await open();
    await stubSend(view);
    await pushRender(view, `<div id="win" data-moving="rooms" class="open"><p>one room</p><input id="new"></div>`);
    await waitFor(view, `document.getElementById('new') !== null`, (v) => v === true);
    await view.evaluate(`(() => {
      window.__named = [];
      const el = document.querySelector('#win');
      new MutationObserver(() => window.__named.push(el.style.viewTransitionName)).observe(el, { attributes: true, attributeFilter: ["style"] });
    })()`);

    // someone else's write redraws the page while this person is in the field
    await view.click("#new");
    await pushRender(view, `<div id="win" data-moving="rooms" class="open"><p>two rooms</p><input id="new"></div>`);
    await view.type("attic");
    await waitFor(view, `document.querySelector('#win p')?.textContent`, (v) => v === "two rooms");

    expect(await view.evaluate<string>(`document.getElementById('new').value`)).toBe("attic");
    expect(await view.evaluate<string[]>(`window.__named`)).toEqual([]); // the window itself did not change, only what is in it
  });

  test("with several data-moving candidates on screen at once, only the one that actually changed transitions (W3: a box with more than one openable compartment)", async () => {
    await using view = await open();
    await stubSend(view);

    // three siblings each carry data-moving, the way every navigable cell in a box does before
    // any one of them is known to be the next thing opened
    await pushRender(
      view,
      `<div id="tray">
        <div id="asks" data-moving="asks"><p>Asks</p></div>
        <div id="gifts" data-moving="gifts"><p>Gifts</p></div>
        <div id="day" data-moving="day"><p>The day</p></div>
      </div>`,
    );
    await waitFor(view, `document.querySelector('#gifts')?.textContent`, (v) => v === "Gifts");

    await view.evaluate(`(() => {
      window.__seenNames = { asks: [], gifts: [], day: [] };
      for (const id of ["asks", "gifts", "day"]) {
        const el = document.getElementById(id);
        el._probe = id;
        new MutationObserver((muts) => {
          for (const m of muts) window.__seenNames[id].push(el.style.viewTransitionName);
        }).observe(el, { attributes: true, attributeFilter: ["style"] });
      }
    })()`);

    // only "gifts" actually changes (it grows); "asks" and "day" render byte-for-byte the same,
    // since nothing about them changed just because a sibling opened
    await pushRender(
      view,
      `<div id="tray">
        <div id="asks" data-moving="asks"><p>Asks</p></div>
        <div id="gifts" data-moving="gifts" class="open"><p>Gifts, grown into the window</p></div>
        <div id="day" data-moving="day"><p>The day</p></div>
      </div>`,
    );
    await waitFor(view, `document.querySelector('#gifts')?.textContent`, (v) => v === "Gifts, grown into the window");

    await waitFor(view, `window.__seenNames.gifts.includes("moving")`, (v) => v === true);
    expect(await view.evaluate<boolean>(`window.__seenNames.asks.includes("moving")`)).toBe(false);
    expect(await view.evaluate<boolean>(`window.__seenNames.day.includes("moving")`)).toBe(false);
    expect(await view.evaluate<string>(`document.getElementById('gifts').style.viewTransitionName`)).toBe("");
    // the unrelated siblings' own identity survived the render too, untouched by the transition
    expect(await view.evaluate<string>(`document.getElementById('asks')._probe`)).toBe("asks");
    expect(await view.evaluate<string>(`document.getElementById('day')._probe`)).toBe("day");
    expect(await view.evaluate<string>(`document.getElementById('gifts')._probe`)).toBe("gifts"); // the same element grew, it wasn't replaced
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
    expect(await view.evaluate<number>(`document.getElementById('list').scrollTop`)).toBe(0);

    const revealed = items.replace('id="item-19"', 'id="item-19" data-reveal="item-19"');
    await pushRender(view, `<div class="list" id="list">${revealed}</div>`);
    await waitFor(view, `document.getElementById('item-19')?.hasAttribute('data-reveal')`, (v) => v === true);

    const scrolled = await waitFor(view, `document.getElementById('list').scrollTop`, (v) => typeof v === "number" && v > 0);
    expect(scrolled as number).toBeGreaterThan(0);
  });

  test("a field waiting with autofocus gets the caret when a render brings it in, and never takes it from a field someone is in", async () => {
    await using view = await open();
    // the first page's field takes the one autofocus the browser gives a document
    await pushRender(view, `<form><input id="name" name="name" autofocus></form>`);
    await waitFor(view, `document.activeElement?.id`, (v) => v === "name", 1000);
    await pushRender(view, `<div class="row" id="r" tabindex="0">general</div>`);
    await waitFor(view, `document.getElementById('r') !== null`, (v) => v === true);
    await view.click("#r"); // a row was tapped: the caret is on it, and the render that answers takes it away

    await pushRender(view, `<form><input id="say" name="text" autofocus></form>`);
    await waitFor(view, `document.activeElement?.id`, (v) => v === "say", 1000); // the browser honours autofocus once per document; the client must do it after

    // someone typing in find is left alone when a render arrives with another field waiting
    await pushRender(view, `<form><input id="q" name="q"></form><form><input id="say" name="text" autofocus></form>`);
    await waitFor(view, `document.getElementById('q') !== null`, (v) => v === true);
    await view.click("#q");
    await pushRender(view, `<form><input id="q" name="q"></form><form><input id="say" name="text" autofocus></form><p id="more">more</p>`);
    await waitFor(view, `document.getElementById('more') !== null`, (v) => v === true);
    expect(await view.evaluate<string>(`document.activeElement?.id`)).toBe("q");
  });

  test("a click in a field that carries data-write writes nothing: the attribute names the field's path, it is not a gesture", async () => {
    await using view = await open();
    await stubSend(view);

    await pushRender(
      view,
      `<form data-write-on="input" id="f">
        <input name="q" id="q" value="ge" data-write='{"doc":"session","op":"replace","path":"/filter/rooms"}'>
      </form>
      <button id="b" data-write='{"doc":"session","op":"remove","path":"/filter/rooms"}'>Close</button>`,
    );
    await waitFor(view, `document.getElementById('q') !== null`, (v) => v === true);

    await view.click("#q"); // a real click, as a person putting the caret back in find's field
    await Bun.sleep(300); // well past the input debounce: nothing was typed, so nothing is owed
    expect(await view.evaluate<Sent[]>(`window.__sent`)).toEqual([]); // not a blank replace that would empty the word on the server

    await view.click("#b"); // a button's data-write is still a gesture
    await waitFor(view, `window.__sent.length`, (v) => v === 1, 1000);
    expect(await view.evaluate<Sent>(`window.__sent[0]`)).toEqual({ doc: "session", ops: [{ op: "remove", path: "/filter/rooms" }] });
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

    await view.click("#q"); // as a person would: a click in the field writes nothing of its own
    await view.type("abc");

    // one message for the whole burst of keystrokes, not one per key -- debounced, so it may not
    // have landed the instant typing stops, but it never grows past the one commit
    await waitFor(view, `window.__sent.length`, (v) => v === 1, 1000);
    await Bun.sleep(300); // settle well past the debounce window; still just the one message
    expect(await view.evaluate<number>(`window.__sent.length`)).toBe(1);
    expect(await view.evaluate<Sent>(`window.__sent[0]`)).toEqual({
      doc: "session",
      ops: [{ op: "replace", path: "/filter/guests", value: "abc" }],
    });

    // clearing and retyping the same value recomputes the same ops -- nothing new to say, so
    // nothing new is sent, even once the debounce has had plenty of time to fire
    await view.evaluate(`document.getElementById('q').value = ""`);
    await view.evaluate(`document.getElementById('q').focus()`);
    await view.type("abc");
    await Bun.sleep(400);
    expect(await view.evaluate<number>(`window.__sent.length`)).toBe(1);

    // a genuinely new value, then losing focus before the debounce would fire, flushes it at once
    await view.evaluate(`document.getElementById('q').value = ""`);
    await view.evaluate(`document.getElementById('q').focus()`);
    await view.type("xyz");
    await view.evaluate(`document.getElementById('q').blur()`);
    await waitFor(view, `window.__sent.length`, (v) => v === 2, 300);
    expect(await view.evaluate<Sent>(`window.__sent[1]`)).toEqual({
      doc: "session",
      ops: [{ op: "replace", path: "/filter/guests", value: "xyz" }],
    });
  });
  test("after an undo, a field nobody is in shows the value undone to, and leaving another field sends nothing again", async () => {
    await using view = await open();
    await stubSend(view);
    const form = (message: string, note: string) =>
      `<form data-write-on="blur" id="f">
        <input id="msg" value="${message}" data-write='{"doc":"household","op":"replace","path":"/message"}'>
        <textarea id="note" data-write='{"doc":"household","op":"replace","path":"/note"}'>${note}</textarea>
        <input id="other" value="x" data-write='{"doc":"household","op":"replace","path":"/other"}'>
      </form><button id="elsewhere">elsewhere</button>`;
    await pushRender(view, form("Hello", "Soon"));
    await waitFor(view, `document.getElementById('msg') !== null`, (v) => v === true);

    await view.click("#msg");
    await view.type("Hi");
    await view.click("#note");
    await view.type("er");
    await view.click("#other"); // leaving each field sends it
    await waitFor(view, `window.__sent.length`, (v) => v === 2, 1000);
    await pushRender(view, form("HelloHi", "Sooner")); // the writes, echoed and drawn
    await pushRender(view, form("Hello", "Soon")); // then undone, and drawn again

    expect(await view.evaluate<string>(`document.getElementById('msg').value`)).toBe("Hello");
    expect(await view.evaluate<string>(`document.getElementById('note').value`)).toBe("Soon");
    await view.click("#elsewhere"); // leaving the untouched field
    await Bun.sleep(50);
    expect(await view.evaluate<number>(`window.__sent.length`)).toBe(2); // the undone values are not sent again

    // a field someone is in keeps what they are typing, whatever the render says
    await view.click("#msg");
    await view.type("!");
    await pushRender(view, form("Hola", "Soon"));
    expect(await view.evaluate<string>(`document.getElementById('msg').value`)).toBe("Hello!");
  });

  test("a render in parts never reaches inside an applet; the applet's own element may still be a part", async () => {
    await using view = await open();
    await pushRender(view, `<div data-applet="unregistered" data-eta-part="a" class="one"><ul data-eta-part="inside"><li>drawn by the applet</li></ul></div>`);
    await waitFor(view, `document.querySelector('[data-eta-part="a"]') !== null`, (v) => v === true);
    await push(view, {
      type: "render",
      ops: [
        { op: "replace", target: '[data-eta-part="inside"]', html: `<ul data-eta-part="inside"><li>the server's</li></ul>` },
        { op: "after", target: '[data-eta-part="inside"]', html: `<p>more</p>` },
        { op: "tag", target: '[data-eta-part="a"]', html: `<div data-applet="unregistered" data-eta-part="a" class="two">` },
      ],
    });
    await waitFor(view, `document.querySelector('[data-eta-part="a"]').className`, (v) => v === "two");
    expect(await view.evaluate<string>(`document.querySelector('[data-eta-part="a"]').textContent`)).toBe("drawn by the applet");
  });

  test("a connection that drops leaves the page as it was, inert and marked, until it is back", async () => {
    await using view = await open();
    await pushRender(view, `<form><input id="say" name="text"></form>`);
    await waitFor(view, `document.getElementById('say') !== null`, (v) => v === true);
    await view.click("#say");
    await view.type("half typ");

    await view.evaluate(`window.eta.socket().close()`);
    await waitFor(view, `document.getElementById('app').hasAttribute('data-offline')`, (v) => v === true, 1000);
    expect(await view.evaluate<boolean>(`document.getElementById('app').inert`)).toBe(true);
    expect(await view.evaluate<string>(`document.getElementById('say').value`)).toBe("half typ");

    await waitFor(view, `window.eta.socket().readyState === 1`, (v) => v === true, 3000); // back, after the backoff
    expect(await view.evaluate<boolean>(`document.getElementById('app').inert || document.getElementById('app').hasAttribute('data-offline')`)).toBe(false);
    expect(await view.evaluate<string>(`document.getElementById('say').value`)).toBe("half typ");
  });

});
