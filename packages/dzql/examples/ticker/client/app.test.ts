import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { press, urlFor, waitFor, webview } from "dzql/rendering/webview";
import { createServer } from "dzql/rendering/server";
import { tick } from "../resources/ticker/ticker";
import type { MarketDocument } from "../resources/ticker/ticker-api";
import { app as example } from "../routes";

/** The market as delta has it now, by symbol. */
async function quotes(): Promise<MarketDocument> {
  const rows = (await example.delta!.as("test").call("open", { doc: "ticker:1" })).result.quotes as Record<string, MarketDocument[string]>;
  return Object.fromEntries(Object.values(rows).map((q) => [q.symbol, q]));
}

let server: Awaited<ReturnType<typeof createServer>>;

beforeAll(async () => {
  server = await createServer(example, 0);
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


/** Each field on the page, by its name, with the size of its text. */
const FIELDS = `[...document.querySelectorAll('input, select, textarea')].map((el) => (el.name || el.type) + ' ' + getComputedStyle(el).fontSize)`;

describe("the ticker in a real browser", () => {
  test("on a phone no field is under 16px, so iOS does not zoom into it -- the city's, the symbol's -- and the reader may zoom", async () => {
    await using view = webview({ width: 375, height: 740 });
    await view.navigate(urlFor(view, server.url));
    await waitFor(view, `document.querySelector('.cell.thing') !== null`, (v) => v === true);
    expect(await view.evaluate<string>(`document.querySelector('meta[name=viewport]').content`)).not.toMatch(/maximum-scale|user-scalable/);
    await press(view, ".cell.thing");
    await waitFor(view, `document.querySelector('#city input') !== null`, (v) => v === true);
    expect(await view.evaluate<string[]>(FIELDS)).toEqual(["text 16px"]);
    await press(view, ".drawer-close");
    await press(view, '.cell[data-key="board"]');
    await waitFor(view, `document.querySelector('.cell.open [aria-label="Watch a symbol"]') !== null`, (v) => v === true);
    await press(view, '.cell.open [aria-label="Watch a symbol"]');
    // the ask is a choice of the symbols the board lacks: a select, sized as a field is
    await waitFor(view, `document.querySelector('select[name=symbol]') !== null`, (v) => v === true);
    expect(await view.evaluate<string[]>(FIELDS)).toEqual(["symbol 16px"]);
  });

  test("the board applet takes a tick from the patch itself -- no render -- and the clock runs on its own", async () => {
    await using view = webview();
    await view.navigate(urlFor(view, server.url));
    // the board grows into the window; the plus on its rail asks which symbol in a modal
    await waitFor(view, `document.querySelector('.cell[data-key="board"]') !== null`, (v) => v === true);
    await press(view, '.cell[data-key="board"]');
    await waitFor(view, `document.querySelector('.cell.open [aria-label="Watch a symbol"]') !== null`, (v) => v === true);
    await press(view, '.cell.open [aria-label="Watch a symbol"]');
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
    // the tick reached the page as its patch (the fields it moves), and no render came with it -- other
    // ticks may land meanwhile (a feed another test started), so this tick is looked for by its value
    expect(await view.evaluate<boolean>(`window.eta.docs()['ticker:1'].ops.some((op) => op.path === '/6/price' && op.value === ${price})`)).toBe(true);
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
    // its hands say nothing to a reader, so the face is named by the time: two in the afternoon in Zurich
    const face = `document.querySelector('svg.clock').getAttribute('aria-label')`;
    expect(await view.evaluate<string>(face)).toBe("14:00");
    // asked for no motion, the seconds hand holds still and the clock turns once a second, still saying the time
    await view.evaluate(`(() => { const real = window.matchMedia.bind(window); window.__matchMedia = real; window.matchMedia = (q) => (q.includes("reduced-motion") ? { matches: true, media: q, addEventListener() {}, removeEventListener() {} } : real(q)); return 1; })()`);
    await Bun.sleep(100); // the frame in flight turns it once more
    const held = await view.evaluate<string>(hand);
    await Bun.sleep(1200);
    expect(await view.evaluate<string>(hand)).toBe(held);
    expect(await view.evaluate<string>(face)).toBe("14:00");
    await view.evaluate(`(window.matchMedia = window.__matchMedia, 1)`);

    // in the window a board row is a figure, as a list's row is: a tap anywhere on it opens its drawer, and it is lit
    const line = `document.querySelector('#quote-FXTR polyline').getAttribute('points')`;
    const seen = await view.evaluate<string>(line);
    // (what a finger meets at the price, or the sparkline, is the row's button)
    const hit = (what: string) => `(() => { const r = document.querySelector('#quote-FXTR ${what}').getBoundingClientRect(); return document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) === document.querySelector('#quote-FXTR button'); })()`;
    expect(await view.evaluate<boolean[]>(`[${hit(".price")}, ${hit("svg.spark")}]`)).toEqual([true, true]);
    await view.click("#quote-FXTR button");
    await waitFor(view, `document.querySelector('.drawer h2')?.textContent ?? null`, (v) => v === "FXTR");
    expect(await view.evaluate<string>(`document.querySelector('#quote-FXTR button').getAttribute('aria-expanded')`)).toBe("true");
    expect(await view.evaluate<string>(line)).toBe(seen); // the same applet, the ticks it has seen kept

    // the clock is a thing: its drawer holds the city picker. "lon" puts London first, ahead of
    // Blanc-Sablon; Enter takes the first; the clock document's write is taken by the applets --
    // the hands turn to London's time, and the picker says London. The drawer's scrim covers the
    // window's way back, so the drawer is put away first, as a person must
    await press(view, ".drawer-close");
    await waitFor(view, `document.querySelector('.drawer') === null`, (v) => v === true);
    await press(view, ".cell.open .cell-back");
    await waitFor(view, `document.querySelector('.cell.thing') !== null && document.querySelector('.cell.open') === null`, (v) => v === true);
    await press(view, ".cell.thing");
    await waitFor(view, `document.querySelector('#city input') !== null`, (v) => v === true);
    await view.click("#city input");
    await view.type("lon");
    const suggested = await waitFor(view, `[...document.querySelectorAll('#city .suggestions li')].map((li) => li.dataset.tz)`, (v) => Array.isArray(v) && v.length > 0);
    expect((suggested as string[])[0]).toBe("Europe/London");
    expect((suggested as string[])[1]).toBe("Arctic/Longyearbyen");
    expect(suggested as string[]).toContain("America/Blanc-Sablon");
    // the field is a combobox: a reader hears its list open, and which suggestion is highlighted
    const said = `(() => { const i = document.querySelector('#city input'); return [i.getAttribute('role'), i.getAttribute('aria-expanded'), document.getElementById(i.getAttribute('aria-activedescendant'))?.dataset.tz]; })()`;
    expect(await view.evaluate<string[]>(said)).toEqual(["combobox", "true", "Europe/London"]);
    expect(await view.evaluate<string>(`document.querySelector('#city input').getAttribute('aria-label')`)).toStartWith("City"); // its name holds the label it is shown under
    // the arrow keys move the highlight; Enter takes the highlighted one. (The WebView's press() does
    // not deliver a keydown, so the keys are dispatched as the browser would.)
    const arrow = (key: string) => view.evaluate(`document.querySelector('#city input').dispatchEvent(new KeyboardEvent('keydown', { key: '${key}', bubbles: true, cancelable: true }))`);
    await arrow("ArrowDown");
    expect(await view.evaluate<string>(`document.querySelector('#city .suggestions li.active').dataset.tz`)).toBe("Arctic/Longyearbyen");
    expect((await view.evaluate<string[]>(said))[2]).toBe("Arctic/Longyearbyen");
    await arrow("ArrowUp");
    expect(await view.evaluate<string>(`document.querySelector('#city .suggestions li.active').dataset.tz`)).toBe("Europe/London");
    await view.press("Enter");
    // at 12:00 UTC it is two in the afternoon in Zurich and one in London: the hour hand goes back an hour
    await waitFor(view, `document.querySelector('svg.clock .hand.hour').getAttribute('transform')`, (v) => v === "rotate(30.00)");
    expect(await view.evaluate<string>(face)).toBe("13:00");
    expect(await view.evaluate<string>(`document.querySelector('#city input').getAttribute('aria-expanded')`)).toBe("false"); // chosen, the list is put away
    expect(await view.evaluate<string>(`document.querySelector('#city input').placeholder`)).toBe("London");
    expect(await view.evaluate<number>(`window.eta.docs().clock.ops.length`)).toBe(1);

    // a suggestion pressed is taken as Enter takes one: back to Zurich, two in the afternoon
    await view.click("#city input");
    await view.type("zur");
    await waitFor(view, `document.querySelector('#city .suggestions li[data-tz="Europe/Zurich"]') !== null`, (v) => v === true);
    await view.click('#city .suggestions li[data-tz="Europe/Zurich"]');
    await waitFor(view, face, (v) => v === "14:00");

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

  test("the keyboard opens a board row as a finger does: Space opens its drawer, Enter too, and the row says it is expanded", async () => {
    await using view = webview();
    await view.navigate(urlFor(view, server.url));
    await waitFor(view, `document.querySelector('.cell[data-key="board"]') !== null`, (v) => v === true);
    await press(view, '.cell[data-key="board"]');
    await waitFor(view, `document.querySelector('.cell.open [aria-label="Watch a symbol"]') !== null`, (v) => v === true);
    await press(view, '.cell.open [aria-label="Watch a symbol"]');
    await waitFor(view, `document.querySelector('select[name=symbol]') !== null`, (v) => v === true);
    await view.evaluate(`document.querySelector('select[name=symbol]').value = 'FXTR'`);
    await view.click("dialog button[type=submit]");
    await waitFor(view, `document.querySelector('#quote-FXTR polyline') !== null && document.querySelector('dialog') === null`, (v) => v === true);

    // where a Tab stops on the row: the row itself, or what in it takes the keyboard
    const stop = `(() => { const el = document.getElementById('quote-FXTR'); return el.matches('button, a[href], [tabindex]') ? el : el.querySelector('button, a[href], [tabindex]'); })()`;
    const drawer = `document.querySelector('.drawer h2')?.textContent ?? null`;
    const line = `document.querySelector('#quote-FXTR polyline').getAttribute('points')`;
    const seen = await view.evaluate<string>(line);
    await view.evaluate(`${stop}.focus()`);
    await view.press("Space");
    expect(await waitFor(view, drawer, (v) => v === "FXTR", 2000).catch(() => view.evaluate(drawer))).toBe("FXTR");
    expect(await view.evaluate<string[]>(`[${stop}.tagName, ${stop}.getAttribute('aria-expanded')]`)).toEqual(["BUTTON", "true"]);
    expect(await view.evaluate<string>(line)).toBe(seen); // the same applet, the ticks it has seen kept

    // Escape puts the drawer away, and the keyboard goes back to the row: not expanded now
    await view.evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))`);
    await waitFor(view, `document.querySelector('.drawer') === null`, (v) => v === true);
    expect(await view.evaluate<unknown[]>(`[document.activeElement === ${stop}, ${stop}.getAttribute('aria-expanded')]`)).toEqual([true, "false"]);
    await view.press("Enter");
    await waitFor(view, drawer, (v) => v === "FXTR");
    expect(await view.evaluate<string>(`${stop}.getAttribute('aria-expanded')`)).toBe("true");
    await view.evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))`);
    await waitFor(view, `document.querySelector('.drawer') === null`, (v) => v === true);

    // the button is beside the applet, not around it: the line is the same applet on the box as in
    // the window, so closing the window keeps the ticks it has seen, and on the box it is no stop
    await view.evaluate(`(document.getElementById('line-FXTR').kept = true)`);
    await press(view, ".cell.open .cell-back");
    await waitFor(view, `document.querySelector('.cell.open') === null`, (v) => v === true);
    expect(await view.evaluate<unknown[]>(`[document.getElementById('line-FXTR').kept, document.querySelector('#quote-FXTR button')]`)).toEqual([true, null]);
  }, 15000);
});
