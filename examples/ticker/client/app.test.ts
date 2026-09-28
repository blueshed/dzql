import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { urlFor, waitFor } from "../../../src/webview";
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

/** The page's clock set to `at`, running on from there. */
function pinClock(view: Bun.WebView, at: number): Promise<unknown> {
  return view.evaluate(`(() => {
    const Real = Date, t0 = performance.now(), at = ${at};
    globalThis.Date = class extends Real { constructor(...a) { a.length ? super(...a) : super(at + performance.now() - t0); } static now() { return at + performance.now() - t0; } };
    return 1;
  })()`);
}


describe("the ticker in a real browser", () => {
  test("the board applet takes a tick from the patch itself -- no render -- and the clock runs on its own", async () => {
    await using view = new Bun.WebView();
    await view.navigate(urlFor(view, server.url));
    // the board grows into the window; the plus on its rail asks which symbol in a modal
    await waitFor(view, `document.querySelector('.cell[data-key="board"]') !== null`, (v) => v === true);
    await view.evaluate(`document.querySelector('.cell[data-key="board"]').click()`);
    await waitFor(view, `document.querySelector('.cell.open [aria-label="Watch a symbol"]') !== null`, (v) => v === true);
    await view.evaluate(`document.querySelector('.cell.open [aria-label="Watch a symbol"]').click()`);
    // the ask is a choice of the symbols the board lacks
    await waitFor(view, `document.querySelector('select[name=symbol]') !== null`, (v) => v === true);
    await view.evaluate(`document.querySelector('select[name=symbol]').value = 'FXTR'`);
    await view.click("dialog button[type=submit]");
    const fxtr = (await quotes()).FXTR!.price;
    await waitFor(view, `document.querySelector('.board .quote[data-row="FXTR"] .price')?.textContent ?? null`, (v) => v === fxtr.toFixed(2));

    // a tick from the server side (as the feed makes them): the board's row moves, and the only
    // message the client saw was the patch
    await view.evaluate(`(() => { window.__renders = 0; window.eta.socket().addEventListener('message', (e) => { if (JSON.parse(e.data).type === 'render') window.__renders++; }); return 1; })()`);
    const price = Math.round(((await quotes()).FXTR!.price + 2.5) * 100) / 100;
    await tick([{ op: "replace", path: "/FXTR/price", value: price }]);
    await waitFor(view, `document.querySelector('.board .quote[data-row="FXTR"] .price')?.textContent`, (v) => v === price.toFixed(2));
    expect(await view.evaluate<boolean>(`document.querySelector('.board .quote[data-row="FXTR"]').classList.contains('up')`)).toBe(true);
    // the tick reached the page as its patch (the quote it leaves), and no render came with it -- other
    // ticks may land meanwhile (a feed another test started), so this tick is looked for by its value
    expect(await view.evaluate<boolean>(`window.eta.docs()['ticker:market'].ops.some((op) => op.path === '/FXTR' && op.value.price === ${price})`)).toBe(true);
    expect(await view.evaluate<number>(`window.__renders`)).toBe(0);
    expect(await view.evaluate<number>(`document.querySelectorAll('.board .quote[data-row="FXTR"] polyline').length`)).toBe(1);

    // the clock's seconds hand is turning, with nothing from the server. It sweeps the dial in 58.5
    // seconds and waits at twelve for the rest of the minute, so two looks in that wait both see
    // rotate(360.00): the page's clock is set ten seconds into a minute, mid-sweep, whenever this runs
    await pinClock(view, Date.UTC(2026, 8, 28, 12, 0, 10));
    const hand = `document.querySelector('svg.clock .hand.second').getAttribute('transform')`;
    const angle = (v: unknown) => Number(/rotate\(([\d.]+)\)/.exec(String(v))?.[1]);
    const a = await waitFor(view, hand, (v) => angle(v) >= 61.5 && angle(v) < 300); // ten seconds in: 61.5°, and turning
    await Bun.sleep(300);
    const b = await view.evaluate(hand);
    expect(a).not.toBe(b);

    // in the window a board row is a figure, as a list's row is: a tap opens its drawer, and it is lit
    const line = `document.querySelector('#quote-FXTR polyline').getAttribute('points')`;
    const seen = await view.evaluate<string>(line);
    await view.evaluate(`document.getElementById('quote-FXTR').click()`);
    await waitFor(view, `document.querySelector('.drawer h2')?.textContent ?? null`, (v) => v === "FXTR");
    expect(await view.evaluate<string>(`document.getElementById('quote-FXTR').getAttribute('aria-pressed')`)).toBe("true");
    expect(await view.evaluate<string>(line)).toBe(seen); // the same applet, the ticks it has seen kept

    // the clock is a thing: its drawer holds the city picker. "lon" puts London first, ahead of
    // Blanc-Sablon; Enter takes the first; the clock document's write is taken by the applets --
    // the hands turn to London's time, and the picker says London
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
    // at 12:00 UTC it is two in the afternoon in Zurich and one in London: the hour hand goes back an hour
    await waitFor(view, `document.querySelector('svg.clock .hand.hour').getAttribute('transform')`, (v) => v === "rotate(30.00)");
    expect(await view.evaluate<string>(`document.querySelector('#city input').placeholder`)).toBe("London");
    expect(await view.evaluate<number>(`window.eta.docs().clock.ops.length`)).toBe(1);

    // Escape: the first empties the picker's word and leaves the drawer open; the next puts the drawer away
    await view.click("#city input");
    await view.type("par");
    await waitFor(view, `document.querySelectorAll('#city .suggestions li').length > 0`, (v) => v === true);
    await arrow("Escape");
    await waitFor(view, `document.querySelector('#city input').value`, (v) => v === "");
    expect(await view.evaluate<boolean>(`document.querySelector('.drawer') !== null`)).toBe(true);
    await arrow("Escape");
    await waitFor(view, `document.querySelector('.drawer') === null`, (v) => v === true);
  }, 15000);
});
