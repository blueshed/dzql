import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { at, waitFor } from "../../../src/webview";
import { createServer } from "../../../src/server";
import { tick } from "../compartments/ticker";
import type { MarketDocument } from "../documents/market";
import { example } from "../index";

/** The market as delta has it now. */
async function quotes(): Promise<MarketDocument> {
  return (await example.delta!.as("test").call("open", { doc: "ticker:market" })).result.quotes;
}

let server: ReturnType<typeof createServer>;

beforeAll(() => {
  server = createServer(example, 0);
});

afterAll(() => {
  server.stop(true);
});


describe("the ticker in a real browser", () => {
  test("the board applet takes a tick from the patch itself -- no render -- and the clock runs on its own", async () => {
    await using view = new Bun.WebView();
    await view.navigate(at(view, server.url));
    // the board grows into the window; the plus on its rail asks which symbol in a modal
    await waitFor(view, `document.querySelector('.cell[data-key="board"]') !== null`, (v) => v === true);
    await view.evaluate(`document.querySelector('.cell[data-key="board"]').click()`);
    await waitFor(view, `document.querySelector('.cell.open [aria-label="Watch a symbol"]') !== null`, (v) => v === true);
    await view.evaluate(`document.querySelector('.cell.open [aria-label="Watch a symbol"]').click()`);
    await waitFor(view, `document.querySelector('input[name=symbol]') !== null`, (v) => v === true);
    await view.click("input[name=symbol]");
    await view.type("fxtr");
    await view.press("Enter");
    const fxtr = (await quotes()).FXTR!.price;
    await waitFor(view, `document.querySelector('svg.board .row[data-row="FXTR"] .price')?.textContent ?? null`, (v) => v === fxtr.toFixed(2));

    // a tick from the server side (as the feed makes them): the board's row moves, and the only
    // message the client saw was the patch
    await view.evaluate(`(() => { window.__renders = 0; window.eta.socket().addEventListener('message', (e) => { if (JSON.parse(e.data).type === 'render') window.__renders++; }); return 1; })()`);
    const price = Math.round(((await quotes()).FXTR!.price + 2.5) * 100) / 100;
    await tick([{ op: "replace", path: "/FXTR/price", value: price }]);
    await waitFor(view, `document.querySelector('svg.board .row[data-row="FXTR"] .price')?.textContent`, (v) => v === price.toFixed(2));
    expect(await view.evaluate<boolean>(`document.querySelector('svg.board .row[data-row="FXTR"]').classList.contains('up')`)).toBe(true);
    // the tick reached the page as its patch (the quote it leaves), and no render came with it -- other
    // ticks may land meanwhile (a feed another test started), so this tick is looked for by its value
    expect(await view.evaluate<boolean>(`window.eta.docs()['ticker:market'].ops.some((op) => op.path === '/FXTR' && op.value.price === ${price})`)).toBe(true);
    expect(await view.evaluate<number>(`window.__renders`)).toBe(0);
    expect(await view.evaluate<number>(`document.querySelectorAll('svg.board .row[data-row="FXTR"] polyline').length`)).toBe(1);

    // the clock's seconds hand is turning, with nothing from the server
    const a = await view.evaluate(`document.querySelector('svg.clock .hand.second').getAttribute('transform')`);
    await Bun.sleep(300);
    const b = await view.evaluate(`document.querySelector('svg.clock .hand.second').getAttribute('transform')`);
    expect(a).not.toBe(b);

    // the clock is a thing: its drawer holds the city picker. "lon" puts London first, ahead of
    // Blanc-Sablon; Enter takes the first; the clock document's write is taken by the applets --
    // the name on the face changes, no render
    await view.evaluate(`document.querySelector('.cell.open .cell-back').click()`);
    await waitFor(view, `document.querySelector('.cell.thing') !== null && document.querySelector('.cell.open') === null`, (v) => v === true);
    await view.evaluate(`document.querySelector('.cell.thing').click()`);
    await waitFor(view, `document.querySelector('#city input') !== null`, (v) => v === true);
    await view.click("#city input");
    await view.type("lon");
    const suggested = await waitFor(view, `[...document.querySelectorAll('#city .suggestions li')].map((li) => li.dataset.tz)`, (v) => Array.isArray(v) && v.length > 0);
    expect((suggested as string[])[0]).toBe("Europe/London");
    expect((suggested as string[])[1]).toBe("Arctic/Longyearbyen");
    expect(suggested as string[]).toContain("America/Blanc-Sablon");
    // the arrow keys move the highlight; Enter takes the highlighted one. (The WebView's press() does
    // not deliver a keydown, so the keys are dispatched as the browser would.)
    const arrow = (key: string) => view.evaluate(`document.querySelector('#city input').dispatchEvent(new KeyboardEvent('keydown', { key: '${key}', bubbles: true, cancelable: true }))`);
    await arrow("ArrowDown");
    expect(await view.evaluate<string>(`document.querySelector('#city .suggestions li.active').dataset.tz`)).toBe("Arctic/Longyearbyen");
    await arrow("ArrowUp");
    expect(await view.evaluate<string>(`document.querySelector('#city .suggestions li.active').dataset.tz`)).toBe("Europe/London");
    await view.press("Enter");
    await waitFor(view, `document.querySelector('svg.clock .label').textContent`, (v) => v === "London");
    expect(await view.evaluate<string>(`document.querySelector('#city input').placeholder`)).toBe("London");
    expect(await view.evaluate<number>(`window.eta.docs().clock.ops.length`)).toBe(1);
  }, 15000);
});
