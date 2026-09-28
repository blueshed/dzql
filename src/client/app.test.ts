import { afterAll, beforeAll, describe, expect, setSystemTime, test } from "bun:test";
import { bento, type Field } from "../bento";
import { write } from "../html";
import { diff, drawParts, part } from "../parts";
import { waitFor } from "../webview";
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

/** Chooses `value` in the select at `selector` as a person would: the WebView cannot open its menu,
 * so the choice is made as the browser makes it, the value set, then `input` and `change`. */
async function choose(view: Bun.WebView, selector: string, value: string): Promise<void> {
  await view.evaluate(`(() => {
    const select = document.querySelector(${JSON.stringify(selector)});
    select.value = ${JSON.stringify(value)};
    select.dispatchEvent(new Event("input", { bubbles: true }));
    select.dispatchEvent(new Event("change", { bubbles: true }));
  })()`);
}

/** A trip's editing form: its title typed, its kind chosen, `kind` the option drawn `selected`. */
const tripForm = (title: string, kind: string, on = "change") =>
  `<form data-write-on="${on}" id="f">
    <input id="title" value="${title}" data-write='{"doc":"trip","op":"replace","path":"/title"}'>
    <select id="kind" data-write='{"doc":"trip","op":"replace","path":"/kind"}'>${["see", "eat", "travel"].map((k) => `<option${k === kind ? " selected" : ""}>${k}</option>`).join("")}</select>
  </form>`;

/** A trip's editing form in ticks: whether it is booked (a box with a value), whether it is paid (one without), and its kind (radios), each as drawn. */
const ticksForm = (title: string, booked: boolean, paid: boolean, kind: string, on = "change") =>
  `<form data-write-on="${on}" id="t">
    <input id="title" value="${title}" data-write='{"doc":"trip","op":"replace","path":"/title"}'>
    <input type="checkbox" id="booked" value="yes"${booked ? " checked" : ""} data-write='{"doc":"trip","op":"replace","path":"/booked"}'>
    <input type="checkbox" id="paid"${paid ? " checked" : ""} data-write='{"doc":"trip","op":"replace","path":"/paid"}'>
    ${["see", "eat", "travel"].map((k) => `<input type="radio" name="kind" id="kind-${k}" value="${k}"${k === kind ? " checked" : ""} data-write='{"doc":"trip","op":"replace","path":"/kind"}'>`).join("")}
  </form>`;

/** Which of a ticks form's boxes and radios are ticked, in order. */
const ticked = `["booked", "paid", "kind-see", "kind-eat", "kind-travel"].filter((id) => document.getElementById(id).checked)`;

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

  test("with several data-moving candidates on screen at once, only the one that actually changed transitions (W3: a box with more than one openable cell)", async () => {
    await using view = await open();
    await stubSend(view);

    // three siblings each carry data-moving, the way every navigable cell in a box does before
    // any one of them is known to be the next thing opened
    await pushRender(
      view,
      `<div id="grid">
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
      `<div id="grid">
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

  test("a revealed element taller than the view less its margins lands by its top, reached from below as from above", async () => {
    await using view = await open();
    const day = (height: number, reveal: boolean) =>
      `<div class="list" id="list" style="height:200px"><div style="height:600px"></div><div id="day" style="height:${height}px;scroll-margin:24px 0"${reveal ? " data-reveal" : ""}></div><div style="height:600px"></div></div>`;
    const top = `Math.round(document.getElementById('day').getBoundingClientRect().top - document.getElementById('list').getBoundingClientRect().top)`;
    const landed: string[] = [];
    for (const height of [170, 400]) {
      for (const from of ["below", "above"]) {
        await pushRender(view, day(height, false));
        await view.evaluate(`document.getElementById('list').scrollTop = ${from === "below" ? "document.getElementById('list').scrollHeight" : "0"}`);
        await pushRender(view, day(height, true));
        landed.push(`${height}px from ${from}: ${await view.evaluate<number>(top)}`);
      }
    }
    expect(landed).toEqual(["170px from below: 24", "170px from above: 24", "400px from below: 24", "400px from above: 24"]); // its top margin under the view's top

    // and in the page itself, as a day is revealed on a phone, under a sticky header the page
    // declares (`scroll-padding-top`): one that fits the window with its margins, but not below the header
    const page = (reveal: boolean) =>
      `<style>html { scroll-padding-top: 40px }</style><header style="position:sticky;top:0;height:40px"></header><div style="height:2000px"></div><div id="day" style="height:calc(100vh - 68px);scroll-margin:24px 0"${reveal ? " data-reveal" : ""}></div><div style="height:2000px"></div>`;
    await pushRender(view, page(false));
    await view.evaluate(`window.scrollTo(0, document.documentElement.scrollHeight)`);
    await pushRender(view, page(true));
    expect(await view.evaluate<number>(`Math.round(document.getElementById('day').getBoundingClientRect().top)`)).toBe(64); // under the header, and its margin
  });

  test("a tall revealed element moves only the scroller that holds it, under that scroller's own scroll-padding, in percent too", async () => {
    await using view = await open();
    const nested = (reveal: boolean) =>
      `<div style="height:250px"></div><div class="list" id="list" style="height:200px"><div style="height:600px"></div><div id="day" style="height:400px;scroll-margin:24px 0"${reveal ? " data-reveal" : ""}></div><div style="height:600px"></div></div><div style="height:2000px"></div>`;
    await pushRender(view, nested(false));
    await view.evaluate(`window.scrollTo(0, 100)`);
    await pushRender(view, nested(true));
    expect(await view.evaluate<unknown>(`[scrollY, Math.round(document.getElementById('day').getBoundingClientRect().top - document.getElementById('list').getBoundingClientRect().top)]`)).toEqual([100, 24]); // the page stays where it was

    const page = (reveal: boolean) =>
      `<style>html { scroll-padding-top: 10% }</style><div style="height:2000px"></div><div id="day" style="height:calc(100vh - 40px);scroll-margin:0"${reveal ? " data-reveal" : ""}></div><div style="height:2000px"></div>`;
    await pushRender(view, page(false));
    await view.evaluate(`window.scrollTo(0, document.documentElement.scrollHeight)`);
    await pushRender(view, page(true));
    const [top, tenth] = await view.evaluate<number[]>(`[document.getElementById('day').getBoundingClientRect().top, document.documentElement.clientHeight / 10]`);
    expect(Math.abs(top! - tenth!)).toBeLessThan(1); // under a tenth of the view
  });

  test("the reader's place is kept under a sticky header: a stop another moves from Wednesday to Thursday, from under the header, leaves Thursday where it was read", async () => {
    // two people on one trip, through a server that draws it with the kernel's parts: Willem moves
    // Wednesday's last stop to Thursday, while Ann reads Thursday from just under the header
    const stop = (k: string) => part(k, `<li style="height:59px;margin:0;border-bottom:1px solid #ccc;box-sizing:border-box">${k}</li>`);
    const day = (key: string, stops: string[]) => part(key, `<section id="${key}"><h2 style="height:40px;margin:0">${key}</h2><ul style="margin:0;padding:0;list-style:none">${stops.map(stop).join("")}</ul></section>`);
    for (const whole of [false, true]) {
      const trip = { wed: ["w0", "w1", "w2", "w3", "w4"], thu: ["t0", "t1", "t2"] };
      const page = () =>
        `<style>body { margin: 0 }</style><header style="position:sticky;top:0;height:140px;background:#fff;z-index:1"><button type="button" id="move" data-write='{"doc":"trip","op":"replace","path":"/move"}' data-value="w4">Move</button></header>` +
        part("trip", `<main><div style="height:300px"></div>${day("wed", trip.wed)}${day("thu", trip.thu)}<div style="height:2000px"></div></main>`);
      const clients = new Set<Bun.ServerWebSocket<{ drawn?: ReturnType<typeof drawParts> }>>();
      const relay = Bun.serve<{ drawn?: ReturnType<typeof drawParts> }>({
        port: 0,
        routes: { "/": fixture, "/ws": (req: Request, s: Bun.Server<{ drawn?: ReturnType<typeof drawParts> }>) => (s.upgrade(req, { data: {} }) ? undefined : new Response("no", { status: 400 })) },
        websocket: {
          open(ws) {
            clients.add(ws);
            ws.data.drawn = drawParts(page);
            ws.send(JSON.stringify({ type: "render", html: ws.data.drawn.html }));
          },
          message() {
            trip.thu.unshift(trip.wed.pop()!); // the stop, moved
            for (const ws of clients) {
              const next = drawParts(page);
              const ops = diff(ws.data.drawn!, next);
              ws.data.drawn = next;
              ws.send(JSON.stringify(whole || !ops ? { type: "render", html: next.html } : { type: "render", ops }));
            }
          },
          close(ws) {
            clients.delete(ws);
          },
        },
      });
      try {
        await using ann = new Bun.WebView();
        await using willem = new Bun.WebView();
        for (const view of [ann, willem]) {
          await view.navigate(relay.url.toString());
          await waitFor(view, `document.getElementById('thu') !== null`, (v) => v === true);
        }
        await ann.evaluate(`window.scrollTo(0, scrollY + document.getElementById('thu').getBoundingClientRect().top - 140)`); // Thursday, just under the header; w4 under it
        const thu = `Math.round(document.getElementById('thu').getBoundingClientRect().top)`;
        expect(await ann.evaluate<number>(thu)).toBe(140);
        await willem.click("#move");
        await waitFor(ann, `document.querySelector('#thu li')?.textContent`, (v) => v === "w4");
        await Bun.sleep(50);
        expect(`${whole ? "whole" : "in parts"}: ${await ann.evaluate<number>(thu)}`).toBe(`${whole ? "whole" : "in parts"}: 140`);
      } finally {
        relay.stop(true);
      }
    }
  });

  test("the reader's place is kept in a scroller of its own too, as the bento's window is, and not while someone is pressing", async () => {
    await using view = await open();
    const rows = (gone: string[]) => Array.from({ length: 30 }, (_, i) => `r${i}`).filter((k) => !gone.includes(k)).map((k) => `<li id="${k}" data-eta-part="${k}" style="height:50px;margin:0">${k}</li>`).join("");
    const page = (gone: string[] = []) =>
      `<div style="position:fixed;inset:8px;overflow:hidden"><div id="full" style="position:absolute;inset:0;overflow:auto"><header style="position:sticky;top:0;height:60px;background:#fff;z-index:1">the day</header><ul data-eta-part="list" style="margin:0;padding:0;list-style:none">${rows(gone)}</ul></div></div>`;
    const r11 = `Math.round(document.getElementById('r11').getBoundingClientRect().top - document.getElementById('full').getBoundingClientRect().top)`;
    await pushRender(view, page());
    await view.evaluate(`document.getElementById('full').scrollTop = 550`); // r11 just under the header, r10 under it
    expect(await view.evaluate<number>(r11)).toBe(60);
    await push(view, { type: "render", ops: [{ op: "remove", target: '[data-eta-part="r10"]' }] });
    expect(await view.evaluate<number>(r11)).toBe(60);
    await pushRender(view, page(["r10", "r9"])); // whole, one more gone above
    expect(await view.evaluate<number>(r11)).toBe(60);

    await view.evaluate(`document.getElementById('full').dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }))`); // a drag begins
    const top = await view.evaluate<number>(`document.getElementById('full').scrollTop`);
    await pushRender(view, page(["r10", "r9", "r8"]));
    expect(await view.evaluate<number>(`document.getElementById('full').scrollTop`)).toBe(top); // left to the browser
  });

  test("a cell that grows into a fixed window is no place to keep: the page behind stays where it was, open and closed", async () => {
    await using view = await open();
    const box = (open: boolean) =>
      `<style>body { margin: 0 }</style><div style="height:100px">the trail</div>` +
      ["asks", "market", "clock"].map((k) => `<div id="${k}" data-moving="${k}" style="height:300px${open && k === "market" ? ";position:fixed;inset:8px;overflow:auto" : ""}">${k}</div>`).join("") +
      `<div style="height:200px"></div>`;
    await pushRender(view, box(false));
    await view.evaluate(`window.scrollTo(0, scrollY + document.getElementById('market').getBoundingClientRect().top - 100)`); // the market cell 100px down
    const seen = [await view.evaluate<number>(`scrollY`)];
    await pushRender(view, box(true)); // it grows into the window
    seen.push(await view.evaluate<number>(`scrollY`));
    await pushRender(view, box(false)); // and back
    seen.push(await view.evaluate<number>(`scrollY`));
    expect(seen).toEqual([300, 300, 300]); // the browser alone ends at 100 (WebKit) or 187 (Chrome)
  });

  test("a revealed element lands below a sticky header the page does not declare", async () => {
    await using view = await open();
    const page = (height: string, reveal: boolean) =>
      `<header style="position:sticky;top:0;height:40px;background:#fff;z-index:1"></header><div style="height:2000px"></div><div id="day" style="height:${height};scroll-margin:24px 0"${reveal ? " data-reveal" : ""}></div><div style="height:2000px"></div>`;
    const landed: number[] = [];
    for (const height of ["100px", "100vh"]) {
      await pushRender(view, page(height, false));
      await view.evaluate(`window.scrollTo(0, document.documentElement.scrollHeight)`);
      await pushRender(view, page(height, true));
      landed.push(await view.evaluate<number>(`Math.round(document.getElementById('day').getBoundingClientRect().top)`));
    }
    expect(landed).toEqual([64, 64]); // under the header, and its margin: one that fits, and one too tall
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

  test("Escape presses what was opened last -- the last [data-escape] on the page -- and nothing when nothing is open, or something took the key first", async () => {
    await using view = await open();
    await stubSend(view);
    // (the WebView's press() does not deliver a keydown, so the key is dispatched as the browser would)
    const key = (name: string, on = "document") => view.evaluate(`${on}.dispatchEvent(new KeyboardEvent('keydown', { key: '${name}', bubbles: true, cancelable: true }))`);

    await pushRender(view, `<p id="page">nothing open</p>`);
    await waitFor(view, `document.getElementById('page') !== null`, (v) => v === true);
    await key("Escape");
    expect(await view.evaluate<Sent[]>(`window.__sent`)).toEqual([]);

    // a drawer's × and, drawn after it, a modal's scrim: the modal was opened last
    await pushRender(
      view,
      `<aside><button id="x" data-escape data-write='{"doc":"session","op":"replace","path":"/page"}' data-value="">×</button><input id="own"></aside>` +
        `<div id="scrim" data-escape data-write='{"doc":"session","op":"replace","path":"/page"}' data-value="?drawer"></div>`,
    );
    await waitFor(view, `document.getElementById('scrim') !== null`, (v) => v === true);
    await key("Enter"); // another key is nobody's
    // a field (or an applet) that takes Escape for itself says so, and the page leaves it be
    await view.evaluate(`document.getElementById('own').addEventListener('keydown', (e) => e.preventDefault())`);
    await key("Escape", "document.getElementById('own')");
    expect(await view.evaluate<Sent[]>(`window.__sent`)).toEqual([]);

    await key("Escape");
    await waitFor(view, `window.__sent.length`, (v) => v === 1, 1000);
    expect(await view.evaluate<Sent>(`window.__sent[0]`)).toEqual({ doc: "session", ops: [{ op: "replace", path: "/page", value: "?drawer" }] });
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
  test("waitFor says what it waited for, and the last value it saw, when the wait runs out", async () => {
    await using view = await open();
    expect(waitFor(view, `1 + 1`, (v) => v === 3, 60)).rejects.toThrow("Timed out waiting for `1 + 1`; last value: 2");
  });

  test("waitFor runs out with the clock fixed, as a test that opens a page on a given day fixes it", async () => {
    await using view = await open();
    setSystemTime(new Date("2026-11-10T09:00:00Z")); // Date.now() stands still from here
    try {
      await expect(waitFor(view, `1 + 1`, (v) => v === 3, 60)).rejects.toThrow("Timed out waiting for `1 + 1`; last value: 2");
    } finally {
      setSystemTime();
    }
  }, 2000);

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

  test("a select in a data-write-on=\"change\" form goes only when it is chosen, and after an undo shows what was undone to", async () => {
    await using view = await open();
    await stubSend(view);
    await pushRender(view, tripForm("Temple", "eat"));
    await waitFor(view, `document.getElementById('title') !== null`, (v) => v === true);

    await view.click("#title");
    await view.type(" gate");
    await view.evaluate(`document.getElementById('title').blur()`);
    await waitFor(view, `window.__sent.length`, (v) => v === 1, 1000);
    expect(await view.evaluate<Sent>(`window.__sent[0]`)).toEqual({ doc: "trip", ops: [{ op: "replace", path: "/title", value: "Temple gate" }] }); // not the select, left as it was drawn
    await pushRender(view, tripForm("Temple gate", "eat"));

    await choose(view, "#kind", "travel");
    await waitFor(view, `window.__sent.length`, (v) => v === 2, 1000);
    expect(await view.evaluate<Sent>(`window.__sent[1]`)).toEqual({ doc: "trip", ops: [{ op: "replace", path: "/kind", value: "travel" }] });
    await pushRender(view, tripForm("Temple gate", "travel")); // echoed and drawn
    await pushRender(view, tripForm("Temple gate", "eat")); // then undone, and drawn again
    expect(await view.evaluate<string>(`document.getElementById('kind').value`)).toBe("eat");

    await view.click("#title");
    await view.type("s");
    await view.evaluate(`document.getElementById('title').blur()`);
    await waitFor(view, `window.__sent.length`, (v) => v === 3, 1000);
    expect(await view.evaluate<Sent>(`window.__sent[2]`)).toEqual({ doc: "trip", ops: [{ op: "replace", path: "/title", value: "Temple gates" }] }); // the undone choice is not sent again
  });

  test("after an undo, a select shows its drawn option, even one chosen by hand before and with someone still in it, so the next commit does not revert the undo", async () => {
    await using view = await open();
    await stubSend(view);
    await pushRender(view, tripForm("Temple", "see"));
    await waitFor(view, `document.getElementById('kind') !== null`, (v) => v === true);

    await view.evaluate(`document.getElementById('kind').focus()`); // a pick from its menu leaves the caret in it
    await choose(view, "#kind", "eat");
    await waitFor(view, `window.__sent.length`, (v) => v === 1, 1000);
    await pushRender(view, tripForm("Temple", "eat")); // echoed and drawn
    await choose(view, "#kind", "travel");
    await waitFor(view, `window.__sent.length`, (v) => v === 2, 1000);
    await pushRender(view, tripForm("Temple", "travel"));
    // undone, back to an option chosen by hand. Only Chrome shows this one: it no longer moves an
    // option by its `selected` once someone has chosen it, where WebKit moves it whatever was chosen
    await pushRender(view, tripForm("Temple", "eat"));
    expect(await view.evaluate<string>(`document.getElementById('kind').value`)).toBe("eat");

    await view.click("#title");
    await view.type(" gate");
    await view.evaluate(`document.getElementById('title').blur()`);
    await waitFor(view, `window.__sent.length`, (v) => v === 3, 1000);
    expect(await view.evaluate<Sent>(`window.__sent[2]`)).toEqual({ doc: "trip", ops: [{ op: "replace", path: "/title", value: "Temple gate" }] }); // not travel, which would revert the undo
  });

  test("what a select was drawn showing is the browser's own: the last option drawn `selected`, else the first not disabled, and in a list none", async () => {
    await using view = await open();
    await stubSend(view);
    const form = (pick = "") =>
      `<form data-write-on="blur" id="f">
        <select id="pick" data-write='{"doc":"trip","op":"replace","path":"/kind"}'><option value="" disabled>Pick one</option>${["see", "eat"].map((k) => `<option${k === pick ? " selected" : ""}>${k}</option>`).join("")}</select>
        <select id="both" data-write='{"doc":"trip","op":"replace","path":"/mood"}'><option selected>calm</option><option selected>keen</option></select>
        <select id="list" size="3" data-write='{"doc":"trip","op":"replace","path":"/pace"}'><option>slow</option><option>fast</option></select>
      </form><button id="elsewhere">elsewhere</button>`;
    await pushRender(view, form());
    await waitFor(view, `document.getElementById('pick') !== null`, (v) => v === true);
    expect(await view.evaluate<string[]>(`["pick", "both", "list"].map((id) => document.getElementById(id).value)`)).toEqual(["see", "keen", ""]);

    for (const id of ["pick", "both", "list", "elsewhere"]) await view.evaluate(`document.getElementById('${id}').focus()`); // tabbing through all three
    await Bun.sleep(50);
    expect(await view.evaluate<Sent[]>(`window.__sent`)).toEqual([]);

    await pushRender(view, form("eat")); // another member's choice
    await pushRender(view, form()); // undone: the browser's first, never the placeholder
    expect(await view.evaluate<string>(`document.getElementById('pick').value`)).toBe("see");
  });

  test("a multiple select is not a field: an editing form never sends it, nor does a render choose in it", async () => {
    await using view = await open();
    await stubSend(view);
    const form = (title: string) =>
      `<form data-write-on="change" id="f">
        <input id="title" value="${title}" data-write='{"doc":"trip","op":"replace","path":"/title"}'>
        <select multiple id="tags" data-write='{"doc":"trip","op":"replace","path":"/tags"}'><option>quiet</option><option>busy</option></select>
      </form>`;
    await pushRender(view, form("Temple"));
    await waitFor(view, `document.getElementById('title') !== null`, (v) => v === true);
    await view.click("#title");
    await view.type(" gate");
    await view.evaluate(`document.getElementById('title').blur()`);
    await waitFor(view, `window.__sent.length`, (v) => v === 1, 1000);
    expect(await view.evaluate<Sent>(`window.__sent[0]`)).toEqual({ doc: "trip", ops: [{ op: "replace", path: "/title", value: "Temple gate" }] });

    await pushRender(view, form("Temple gate")); // echoed
    expect(await view.evaluate<number>(`document.getElementById('tags').selectedOptions.length`)).toBe(0);
    await view.evaluate(`(() => { const s = document.getElementById('tags'); s.options[1].selected = true; s.dispatchEvent(new Event("change", { bubbles: true })); })()`);
    await Bun.sleep(50);
    expect(await view.evaluate<number>(`window.__sent.length`)).toBe(1);
  });

  test("an editing form says a thing once until a write lands, then may say it again: leaving twice sends once, and after an undo the same choice goes", async () => {
    await using view = await open();
    await stubSend(view);
    const landed = (version: number, kind: string) => push(view, { type: "patch", doc: "trip:1", version, ops: [{ op: "replace", path: "/kind", value: kind }] });
    for (const on of ["blur", "input"]) {
      await pushRender(view, `<p>elsewhere</p>`); // a page of its own, so each form is a new one
      await pushRender(view, tripForm("Temple", "eat", on));
      await waitFor(view, `document.getElementById('f')?.dataset.writeOn`, (v) => v === on);
      await view.evaluate(`window.__sent = []`);

      await view.evaluate(`document.getElementById('kind').focus()`);
      await choose(view, "#kind", "travel");
      await view.evaluate(`document.getElementById('title').focus()`); // leaving it
      await view.evaluate(`document.getElementById('kind').focus()`);
      await view.evaluate(`document.getElementById('title').focus()`); // and again, before the echo
      await Bun.sleep(250); // past the input form's debounce
      expect(await view.evaluate<Sent[]>(`window.__sent`)).toEqual([{ doc: "trip", ops: [{ op: "replace", path: "/kind", value: "travel" }] }]);

      await landed(2, "travel"); // echoed
      await pushRender(view, tripForm("Temple", "travel", on));
      await landed(3, "eat"); // undone
      await pushRender(view, tripForm("Temple", "eat", on));
      await view.evaluate(`document.getElementById('kind').focus()`);
      await choose(view, "#kind", "travel"); // the same choice, news again
      await view.evaluate(`document.getElementById('title').focus()`);
      await waitFor(view, `window.__sent.length`, (v) => v === 2, 1000);
      expect(await view.evaluate<Sent>(`window.__sent[1]`)).toEqual({ doc: "trip", ops: [{ op: "replace", path: "/kind", value: "travel" }] });
    }
  });

  test("a choice not yet sent is the person's: a render that moves the drawn option under it keeps it, and leaving sends it", async () => {
    await using view = await open();
    await stubSend(view);
    await pushRender(view, tripForm("Temple", "eat", "blur"));
    await waitFor(view, `document.getElementById('kind') !== null`, (v) => v === true);

    await view.evaluate(`document.getElementById('kind').focus()`);
    await choose(view, "#kind", "travel");
    await pushRender(view, tripForm("Temple", "see", "blur")); // another member's change, before this one is sent
    expect(await view.evaluate<string>(`document.getElementById('kind').value`)).toBe("travel");
    await view.evaluate(`document.getElementById('title').focus()`);
    await waitFor(view, `window.__sent.length`, (v) => v === 1, 1000);
    expect(await view.evaluate<Sent>(`window.__sent[0]`)).toEqual({ doc: "trip", ops: [{ op: "replace", path: "/kind", value: "travel" }] });
  });

  test("a choice goes with its value, not its place: an option added before it leaves it chosen", async () => {
    await using view = await open();
    await stubSend(view);
    const add = (days: string[]) =>
      `<form id="add" data-write='{"doc":"trip","op":"add","path":"/stops/-"}'><input id="what" name="what"><select id="day" name="day">${days.map((d) => `<option>${d}</option>`).join("")}</select></form>`;
    await pushRender(view, add(["D1", "D2", "D3"]));
    await waitFor(view, `document.getElementById('day') !== null`, (v) => v === true);
    await choose(view, "#day", "D3");
    await pushRender(view, add(["D0", "D1", "D2", "D3"])); // someone added a day before the first
    expect(await view.evaluate<string>(`document.getElementById('day').value`)).toBe("D3");
  });

  test("a refused add whose page no longer offers the option chosen hands back the drawn one, with what was typed", async () => {
    await using view = await open();
    await stubSend(view);
    const book = (slots: string[], taken = "") =>
      `<form id="book" data-write='{"doc":"diary","op":"add","path":"/bookings/-"}'><input id="who" name="who"><select id="slot" name="slot">${slots.map((s) => `<option${s === taken ? " disabled" : ""}>${s}</option>`).join("")}</select></form>`;
    await pushRender(view, book(["9:00", "10:00", "10:30"]));
    await waitFor(view, `document.getElementById('who') !== null`, (v) => v === true);
    await view.click("#who");
    await view.type("Ada");
    await choose(view, "#slot", "10:00");
    await view.press("Enter");
    await waitFor(view, `window.__sent.length`, (v) => v === 1, 1000);
    await pushRender(view, book(["9:00", "10:30"])); // refused: 10:00 was taken meanwhile, and is gone
    expect(await view.evaluate<string[]>(`[document.getElementById('who').value, document.getElementById('slot').value]`)).toEqual(["Ada", "9:00"]);

    await choose(view, "#slot", "10:30");
    await view.click("#who");
    await view.press("Enter");
    await waitFor(view, `window.__sent.length`, (v) => v === 2, 1000);
    await pushRender(view, book(["9:00", "10:30"], "10:30")); // refused: 10:30 is shown, but not to be had
    expect(await view.evaluate<string[]>(`[document.getElementById('who').value, document.getElementById('slot').value]`)).toEqual(["Ada", "9:00"]);
  });

  test("tabbing through a select in a data-write-on=\"blur\" form sends nothing; choosing in it, then leaving, sends it alone", async () => {
    await using view = await open();
    await stubSend(view);
    // no option drawn `selected`: the select shows its first, and that is what was rendered
    await pushRender(
      view,
      `<form data-write-on="blur" id="f">
        <input id="title" value="Temple" data-write='{"doc":"trip","op":"replace","path":"/title"}'>
        <select id="kind" data-write='{"doc":"trip","op":"replace","path":"/kind"}'><option>see</option><option>eat</option></select>
      </form><button id="elsewhere">elsewhere</button>`,
    );
    await waitFor(view, `document.getElementById('kind') !== null`, (v) => v === true);

    // (the WebView's press("Tab") does not move the caret, so it is moved as a Tab moves it)
    await view.evaluate(`document.getElementById('kind').focus()`);
    await view.evaluate(`document.getElementById('elsewhere').focus()`);
    await Bun.sleep(50);
    expect(await view.evaluate<Sent[]>(`window.__sent`)).toEqual([]);

    await view.evaluate(`document.getElementById('kind').focus()`);
    await choose(view, "#kind", "eat");
    await view.evaluate(`document.getElementById('elsewhere').focus()`);
    await waitFor(view, `window.__sent.length`, (v) => v === 1, 1000);
    expect(await view.evaluate<Sent>(`window.__sent[0]`)).toEqual({ doc: "trip", ops: [{ op: "replace", path: "/kind", value: "eat" }] });
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

  test("a part that moves from one parent part to another is where it went, and not where it was", async () => {
    await using view = await open();
    const page = (at: "a" | "b") => part("root", `<div>${["a", "b"].map((k) => part(k, `<section>${at === k ? part("head", "<header>H</header>") : ""}</section>`)).join("")}</div>`);
    for (const [from, to] of [["b", "a"], ["a", "b"]] as const) {
      const [before, after] = [drawParts(() => page(from)), drawParts(() => page(to))];
      await pushRender(view, before.html);
      await push(view, { type: "render", ops: diff(before, after) });
      expect(await view.evaluate<string>(`document.getElementById('app').innerHTML`)).toBe(after.html);
    }
  });

  test("words in an editing form are said before Escape or Back puts its drawer away, though a field a render takes out says nothing in WebKit", async () => {
    await using view = await open();
    await stubSend(view);
    const toPage = `'{"doc":"session","op":"replace","path":"/page"}'`;
    const page = (open: boolean) =>
      `<main data-page="${open ? "?answer" : ""}" data-page-write=${toPage}>${open ? `<aside><button type="button" id="x" data-escape data-write=${toPage} data-value="">×</button><form data-write-on="blur"><textarea id="words" data-write='{"doc":"household","op":"replace","path":"/message"}'>Hello</textarea></form></aside>` : ""}</main>`;
    const words = { doc: "household", ops: [{ op: "replace", path: "/message", value: "Hello there" }] };
    const away = { doc: "session", ops: [{ op: "replace", path: "/page", value: "" }] };
    await pushRender(view, page(false));
    for (const how of ["Escape", "Back"]) {
      await pushRender(view, page(true));
      await view.click("#words");
      await view.evaluate(`document.getElementById('words').setSelectionRange(5, 5)`);
      await view.type(" there");
      await view.evaluate(`window.__sent = []`);
      if (how === "Escape") await view.press("Escape");
      else await view.evaluate(`history.back()`);
      await waitFor(view, `window.__sent.length`, (v) => (v as number) > 0, 1000);
      await pushRender(view, page(false)); // the drawer put away, the field with it
      await Bun.sleep(50);
      expect(await view.evaluate<Sent[]>(`window.__sent`)).toEqual([words, away]);
    }
  });

  test("a write made while the socket is down is not taken for sent: a form keeps what is typed, and an editing form says it once the socket is back", async () => {
    await using view = await open();
    // as a real socket does, the stub drops what is sent while it is not open
    const stub = `(() => { window.__sent ??= []; window.eta.socket().send = function (d) { if (this.readyState === 1) window.__sent.push(JSON.parse(d)); }; })()`;
    await view.evaluate(stub);
    await pushRender(view, `<form id="say" data-write='{"doc":"room","op":"add","path":"/messages/-"}'><input id="text" name="text"></form>
      <form data-write-on="blur"><textarea id="words" data-write='{"doc":"household","op":"replace","path":"/message"}'>Hello</textarea></form>`);
    await waitFor(view, `document.getElementById('words') !== null`, (v) => v === true);
    await view.click("#text");
    await view.type("hi all");
    await view.click("#words");
    await view.evaluate(`document.getElementById('words').setSelectionRange(5, 5)`);
    await view.type(" there");

    const dropped = await view.evaluate(`(() => { window.__old = window.eta.socket(); window.__old.close(); document.getElementById('say').requestSubmit(); return document.getElementById('text').value; })()`);
    expect(dropped).toBe("hi all"); // not sent, so not cleared
    await waitFor(view, `window.eta.socket() !== window.__old && window.eta.socket().readyState === 1 && !document.getElementById('app').inert`, (v) => v === true, 4000);
    await view.evaluate(stub);
    await view.evaluate(`document.getElementById('words').focus()`);
    await view.evaluate(`document.getElementById('words').blur()`); // leaving it, now the socket is back
    await Bun.sleep(50);
    expect(await view.evaluate<Sent[]>(`window.__sent`)).toEqual([{ doc: "household", ops: [{ op: "replace", path: "/message", value: "Hello there" }] }]);
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

  test("a form clears as it sends: what is typed while the write is on its way is kept, whoever's echo comes", async () => {
    await using view = await open();
    await stubSend(view);
    const room = `<form id="say" data-write='{"doc":"room","op":"add","path":"/messages/-"}'><input id="text" name="text"></form>`;
    await pushRender(view, room);
    await waitFor(view, `document.getElementById('text') !== null`, (v) => v === true);
    await view.click("#text");
    await view.type("first");
    await view.press("Enter");
    await waitFor(view, `window.__sent.length`, (v) => v === 1, 1000);
    expect(await view.evaluate<string>(`document.getElementById('text').value`)).toBe("");

    await view.type("second"); // before the first is echoed
    await push(view, { type: "patch", doc: "room:general", version: 3, ops: [{ op: "add", path: "/messages/a1", value: { name: "Ada", text: "first" } }] });
    await push(view, { type: "render", ops: [{ op: "replace", target: "#say", html: room }] });
    expect(await view.evaluate<string>(`document.getElementById('text').value`)).toBe("second");
  });

  test("a refused write keeps what is typed after it: the page handed back ends the wait, so nobody's echo clears the field", async () => {
    await using view = await open();
    await stubSend(view);
    const room = `<form id="say" data-write='{"doc":"room","op":"add","path":"/messages/-"}'><input id="text" name="text"></form>`;
    await pushRender(view, room);
    await waitFor(view, `document.getElementById('text') !== null`, (v) => v === true);
    await view.click("#text");
    await view.type("  ");
    await view.press("Enter");
    await waitFor(view, `window.__sent.length`, (v) => v === 1, 1000);
    await pushRender(view, room); // refused: the page, handed back

    await view.type("hello, I was just say");
    await push(view, { type: "patch", doc: "room:general", version: 9, ops: [{ op: "add", path: "/messages/b1", value: { name: "Bob", text: "hi all" } }] });
    expect(await view.evaluate<string>(`document.getElementById('text').value`)).toBe("  hello, I was just say");
  });

  test("a refused write hands back the option chosen, as it does what was typed", async () => {
    await using view = await open();
    await stubSend(view);
    const add = `<form id="add" data-write='{"doc":"trip","op":"add","path":"/events/-"}'>
      <input id="title" name="title">
      <select id="kind" name="kind"><option>see</option><option selected>eat</option><option>travel</option></select>
    </form>`;
    await pushRender(view, add);
    await waitFor(view, `document.getElementById('title') !== null`, (v) => v === true);
    await view.click("#title");
    await view.type("Fushimi");
    await choose(view, "#kind", "travel");
    await view.press("Enter");
    await waitFor(view, `window.__sent.length`, (v) => v === 1, 1000);
    expect(await view.evaluate<Sent>(`window.__sent[0]`)).toEqual({ doc: "trip", ops: [{ op: "add", path: "/events/-", value: { title: "Fushimi", kind: "travel" } }] });
    expect(await view.evaluate<string[]>(`[document.getElementById('title').value, document.getElementById('kind').value]`)).toEqual(["", "eat"]); // cleared as it sends

    await pushRender(view, add); // refused: the page, handed back
    expect(await view.evaluate<string[]>(`[document.getElementById('title').value, document.getElementById('kind').value]`)).toEqual(["Fushimi", "travel"]);
  });

  test("a box or a radio in an editing form goes only when it is ticked or unticked: a box as whether it is ticked, a radio as its value", async () => {
    await using view = await open();
    await stubSend(view);
    await pushRender(view, ticksForm("Temple", true, false, "see"));
    await waitFor(view, `document.getElementById('title') !== null`, (v) => v === true);

    await view.click("#title");
    await view.type(" gate");
    await view.evaluate(`document.getElementById('title').blur()`);
    await waitFor(view, `window.__sent.length`, (v) => v === 1, 1000);
    expect(await view.evaluate<Sent>(`window.__sent[0]`)).toEqual({ doc: "trip", ops: [{ op: "replace", path: "/title", value: "Temple gate" }] }); // not the boxes, left as they were drawn
    await pushRender(view, ticksForm("Temple gate", true, false, "see"));

    await view.click("#paid");
    await waitFor(view, `window.__sent.length`, (v) => v === 2, 1000);
    expect(await view.evaluate<Sent>(`window.__sent[1]`)).toEqual({ doc: "trip", ops: [{ op: "replace", path: "/paid", value: true }] });
    await pushRender(view, ticksForm("Temple gate", true, true, "see"));

    await view.click("#booked"); // drawn with a value, and ticked
    await waitFor(view, `window.__sent.length`, (v) => v === 3, 1000);
    expect(await view.evaluate<Sent>(`window.__sent[2]`)).toEqual({ doc: "trip", ops: [{ op: "replace", path: "/booked", value: false }] });
    await pushRender(view, ticksForm("Temple gate", false, true, "see"));

    await view.click("#kind-eat");
    await waitFor(view, `window.__sent.length`, (v) => v === 4, 1000);
    expect(await view.evaluate<Sent>(`window.__sent[3]`)).toEqual({ doc: "trip", ops: [{ op: "replace", path: "/kind", value: "eat" }] }); // not the radio it was chosen over
  });

  test("after an undo, a box and a radio show what they are drawn, a box even with the caret still in it, so the next commit does not revert the undo", async () => {
    await using view = await open();
    await stubSend(view);
    await pushRender(view, ticksForm("Temple", false, false, "see"));
    await waitFor(view, `document.getElementById('paid') !== null`, (v) => v === true);

    await view.click("#kind-eat");
    await waitFor(view, `window.__sent.length`, (v) => v === 1, 1000);
    await pushRender(view, ticksForm("Temple", false, false, "eat")); // echoed and drawn
    await pushRender(view, ticksForm("Temple", false, false, "see")); // then undone
    await view.click("#paid");
    await view.evaluate(`document.getElementById('paid').focus()`); // a click leaves the caret in a box in Chrome
    await waitFor(view, `window.__sent.length`, (v) => v === 2, 1000);
    await pushRender(view, ticksForm("Temple", false, true, "see"));
    await pushRender(view, ticksForm("Temple", false, false, "see")); // undone, with the caret still in it
    expect(await view.evaluate<string[]>(ticked)).toEqual(["kind-see"]);

    await view.click("#title");
    await view.type(" gate");
    await view.evaluate(`document.getElementById('title').blur()`);
    await waitFor(view, `window.__sent.length`, (v) => v === 3, 1000);
    expect(await view.evaluate<Sent>(`window.__sent[2]`)).toEqual({ doc: "trip", ops: [{ op: "replace", path: "/title", value: "Temple gate" }] }); // not the tick or the choice undone
  });

  test("a render drawn between pressing a box and letting go leaves it be, so the click ticks it as the person meant, and nothing undoes the other's tick", async () => {
    await using view = await open();
    await stubSend(view);
    for (const touched of [false, true]) {
      await pushRender(view, ticksForm("Temple", false, false, "see"));
      if (touched) {
        for (const [paid, version] of [[true, 2], [false, 3]] as const) {
          await view.click("#paid");
          await push(view, { type: "patch", doc: "trip:1", version, ops: [{ op: "replace", path: "/paid", value: paid }] });
          await pushRender(view, ticksForm("Temple", false, paid, "see"));
        }
      }
      await view.evaluate(`window.__sent = []`);
      await view.evaluate(`document.getElementById('paid').dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }))`);
      await pushRender(view, ticksForm("Temple", false, true, "see")); // someone else ticked it, drawn while the finger is down
      await view.evaluate(`document.getElementById('paid').click()`); // let go
      await Bun.sleep(50);
      expect(await view.evaluate<unknown[]>(`[document.getElementById('paid').checked, window.__sent]`)).toEqual([true, []]);
    }
  });

  test("a tick not yet sent is the person's: a render that draws another choice keeps it, and leaving sends it", async () => {
    await using view = await open();
    await stubSend(view);
    await pushRender(view, ticksForm("Temple", false, false, "see", "blur"));
    await waitFor(view, `document.getElementById('paid') !== null`, (v) => v === true);

    await view.evaluate(`["paid", "kind-travel"].forEach((id) => document.getElementById(id).click())`); // ticked, and not yet left
    await pushRender(view, ticksForm("Temple", true, false, "eat", "blur")); // another member's change, before these are sent
    expect(await view.evaluate<string[]>(ticked)).toEqual(["booked", "paid", "kind-travel"]);
    await view.evaluate(`document.getElementById('title').focus()`);
    await view.evaluate(`document.getElementById('title').blur()`);
    await waitFor(view, `window.__sent.length`, (v) => v === 1, 1000);
    expect(await view.evaluate<Sent>(`window.__sent[0]`)).toEqual({ doc: "trip", ops: [{ op: "replace", path: "/paid", value: true }, { op: "replace", path: "/kind", value: "travel" }] });
  });

  test("a creating form sends a box as whether it is ticked, ticked or not, so its value keeps one shape", async () => {
    await using view = await open();
    await stubSend(view);
    await pushRender(view, `<form id="add" data-write='{"doc":"trip","op":"add","path":"/events/-"}'><input id="title" name="title"><input type="checkbox" id="booked" name="booked"></form>`);
    await waitFor(view, `document.getElementById('title') !== null`, (v) => v === true);
    await view.click("#title");
    await view.type("Fushimi");
    await view.press("Enter");
    await view.click("#booked");
    await view.click("#title");
    await view.type("Inari");
    await view.press("Enter");
    await waitFor(view, `window.__sent.length`, (v) => v === 2, 1000);
    expect(await view.evaluate<unknown[]>(`window.__sent.map((s) => s.ops[0].value)`)).toEqual([{ title: "Fushimi", booked: false }, { title: "Inari", booked: true }]);
  });

  test("a choice not yet sent survives a render in parts around it: a radio put in drawn ticked, or a part of its group swapped for another tag", async () => {
    await using view = await open();
    const row = (k: string, drawn: boolean) => `<li data-eta-part="r-${k}"><input type="radio" name="kind" id="kind-${k}" value="${k}"${drawn ? " checked" : ""}></li>`;
    await pushRender(view, `<form id="f"><ul data-eta-part="list">${row("see", true)}${row("eat", false)}</ul></form>`);
    await waitFor(view, `document.getElementById('kind-eat') !== null`, (v) => v === true);
    await view.click("#kind-eat");
    await push(view, { type: "render", ops: [{ op: "after", target: '[data-eta-part="r-eat"]', html: row("travel", true) }] }); // someone else chose travel, a new one
    const chosen = `document.querySelector('[name=kind]:checked')?.value`;
    expect(await view.evaluate<string>(chosen)).toBe("eat");

    const a = (tag: string) => `<${tag} data-eta-part="a">${["see", "eat"].map((k) => `<input type="radio" form="f" name="kind" id="kind-${k}" value="${k}"${k === "see" ? " checked" : ""}>`).join("")}</${tag}>`;
    await pushRender(view, `<form id="f"></form>${a("div")}<div data-eta-part="b"><input type="radio" form="f" name="kind" id="kind-travel" value="travel"></div>`);
    await view.click("#kind-travel");
    await push(view, { type: "render", ops: [{ op: "replace", target: '[data-eta-part="a"]', html: a("fieldset") }] });
    expect(await view.evaluate<string>(chosen)).toBe("travel");
  });

  test("a refused write hands back what was ticked, as it does what was typed, and keeps a choice made while it was on its way", async () => {
    await using view = await open();
    await stubSend(view);
    const add = `<form id="add" data-write='{"doc":"trip","op":"add","path":"/events/-"}'>
      <input id="title" name="title">
      <input type="checkbox" id="booked" name="booked">
      ${["see", "eat", "travel"].map((k) => `<input type="radio" name="kind" id="kind-${k}" value="${k}"${k === "see" ? " checked" : ""}>`).join("")}
    </form>`;
    await pushRender(view, add);
    await waitFor(view, `document.getElementById('title') !== null`, (v) => v === true);
    await view.click("#booked");
    await view.click("#kind-eat");
    await view.click("#title");
    await view.type("Fushimi");
    await view.press("Enter");
    await waitFor(view, `window.__sent.length`, (v) => v === 1, 1000);
    expect(await view.evaluate<Sent>(`window.__sent[0]`)).toEqual({ doc: "trip", ops: [{ op: "add", path: "/events/-", value: { title: "Fushimi", booked: true, kind: "eat" } }] });
    const state = `[document.getElementById('title').value, document.getElementById('booked').checked, document.getElementById('kind-eat').checked]`;
    expect(await view.evaluate<unknown[]>(state)).toEqual(["", false, false]); // cleared as it sends

    await pushRender(view, add); // refused: the page, handed back
    expect(await view.evaluate<unknown[]>(state)).toEqual(["Fushimi", true, true]);

    await view.press("Enter");
    await waitFor(view, `window.__sent.length`, (v) => v === 2, 1000);
    await view.click("#kind-travel"); // chosen again before the answer
    await pushRender(view, add); // refused again
    expect(await view.evaluate<unknown[]>(`[document.getElementById('title').value, document.getElementById('booked').checked, document.querySelector('[name=kind]:checked').value]`)).toEqual(["Fushimi", true, "travel"]);
  });

  test("the bento's add modal asks with a select and a link, and a refused add hands back what was typed and chosen", async () => {
    await using view = await open();
    await stubSend(view);
    const { addModal } = bento({ icon: () => "", session: "session" });
    const fields: Field[] = [
      { name: "title", label: "What" },
      { name: "kind", label: "Its kind", options: ["see", "eat", "travel"].map((k) => ({ value: k, text: k })), value: "see" },
      { name: "url", label: "A link", type: "url", required: false },
    ];
    const ask = (said = "") => addModal("A stop in Kyoto", fields, write("trip", "add", "/events/-"), write("session", "replace", "/page", "kyoto"), "Add", said);
    await pushRender(view, ask());
    await waitFor(view, `document.activeElement?.name`, (v) => v === "title", 1000); // the first field waits for the caret
    expect(await view.evaluate<string[]>(`["title", "kind", "url"].map((n) => document.querySelector('[name=' + n + ']').type)`)).toEqual(["text", "select-one", "url"]);
    await view.type("Fushimi Inari");
    await choose(view, "[name=kind]", "travel");
    await view.click("[name=url]");
    await view.type("https://inari.jp");
    await view.press("Enter");
    await waitFor(view, `window.__sent.length`, (v) => v === 1, 1000);
    expect(await view.evaluate<Sent>(`window.__sent[0]`)).toEqual({ doc: "trip", ops: [{ op: "add", path: "/events/-", value: { title: "Fushimi Inari", kind: "travel", url: "https://inari.jp" } }] });

    await pushRender(view, ask(`<p class="refused" role="alert">Kyoto has that stop already.</p>`)); // refused: the page, handed back, saying why
    await waitFor(view, `document.querySelector('.refused') !== null`, (v) => v === true);
    expect(await view.evaluate<string[]>(`["title", "kind", "url"].map((n) => document.querySelector('[name=' + n + ']').value)`)).toEqual(["Fushimi Inari", "travel", "https://inari.jp"]);
  });
});
