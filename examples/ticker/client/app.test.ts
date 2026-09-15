import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createServer } from "../../../src/server";
import * as market from "../documents/market";
import { tick } from "../concepts/ticker";
import { example } from "../index";

let server: ReturnType<typeof createServer>;

beforeAll(() => {
  server = createServer(example, 0);
});

afterAll(() => {
  server.stop(true);
});

async function waitFor(view: Bun.WebView, script: string, predicate: (value: unknown) => boolean, timeout = 5000): Promise<unknown> {
  const start = Date.now();
  let last: unknown;
  while (Date.now() - start < timeout) {
    last = await view.evaluate(script);
    if (predicate(last)) return last;
    await Bun.sleep(50);
  }
  throw new Error(`Timed out waiting for \`${script}\`; last value: ${JSON.stringify(last)}`);
}

describe("the ticker in a real browser", () => {
  test("the board applet takes a tick from the patch itself -- no render -- and the clock runs on its own", async () => {
    await using view = new Bun.WebView();
    await view.navigate(server.url.toString());
    await waitFor(view, `document.querySelector('input[name=symbol]') !== null`, (v) => v === true);
    await view.click("input[name=symbol]");
    await view.type("fxtr");
    await view.press("Enter");
    await waitFor(view, `document.querySelector('svg.board .row[data-row="FXTR"] .price')?.textContent ?? null`, (v) => v === market.read().FXTR!.price.toFixed(2));

    // a tick from the server side (as the feed makes them): the board's row moves, and the only
    // message the client saw was the patch
    const renders = await view.evaluate(`window.eta.docs().ticker?.ops.length ?? 0`);
    const price = Math.round((market.read().FXTR!.price + 2.5) * 100) / 100;
    tick([{ op: "replace", path: "/FXTR/price", value: price }], "feed");
    await waitFor(view, `document.querySelector('svg.board .row[data-row="FXTR"] .price')?.textContent`, (v) => v === price.toFixed(2));
    expect(await view.evaluate(`document.querySelector('svg.board .row[data-row="FXTR"]').classList.contains('up')`)).toBe(true);
    expect(await view.evaluate(`window.eta.docs().ticker.ops.length`)).toBe((renders as number) + 1);
    expect(await view.evaluate(`document.querySelectorAll('svg.board .row[data-row="FXTR"] polyline').length`)).toBe(1);

    // the clock's seconds hand is turning, with nothing from the server
    const a = await view.evaluate(`document.querySelector('svg.clock .hand.second').getAttribute('transform')`);
    await Bun.sleep(300);
    const b = await view.evaluate(`document.querySelector('svg.clock .hand.second').getAttribute('transform')`);
    expect(a).not.toBe(b);
  }, 15000);
});
