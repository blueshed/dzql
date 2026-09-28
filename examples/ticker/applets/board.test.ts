import { describe, expect, test } from "bun:test";
import { HISTORY, applyOps, drawRow, drawSpark, rowHtml, sparkSvg, sparkline, type RowState } from "./board";

const state = (): RowState => ({ props: { symbol: "ALPH", quote: { name: "Alpha Systems", price: 189.42, prev: 189.0 } }, history: [189.0, 189.42] });

describe("board", () => {
  test("a row, in HTML, shows the symbol, the name, the price, the change in money and in per cent and its direction, and a sparkline of what it has seen", () => {
    const row = rowHtml("ALPH", { name: "Alpha Systems", price: 189.42, prev: 189.0 }, [189.0, 189.42]);
    expect(row).toStartWith('<div class="quote up" data-row="ALPH"><span class="symbol">ALPH</span><span class="name">Alpha Systems</span><span class="price">189.42</span>');
    expect(row).toContain('<span class="change"><span class="abs">+0.42</span> <span class="pct">+0.22%</span></span>');
    expect(row).toContain('<svg class="spark" viewBox="0 0 120 18" preserveAspectRatio="none" aria-hidden="true"><polyline');
    expect(rowHtml("X", { name: "x", price: 1, prev: 2 }, [2, 1])).toContain('class="quote down"');
    expect(rowHtml("X", { name: "x", price: 1, prev: 2 }, [2, 1])).toContain('<span class="abs">-1.00</span> <span class="pct">-50.00%</span>');
    expect(rowHtml("X", { name: "x", price: 1, prev: 1 }, [1])).toContain('class="quote flat"');
    expect(rowHtml("X", { name: "x", price: 1, prev: 0 }, [1])).toContain(">+0.00%<");
    expect(rowHtml("<b>", { name: "a & b", price: 1, prev: 1 }, [1])).toContain('<span class="symbol">&lt;b></span><span class="name">a &amp; b</span>');
    expect(drawRow(state())).toBe(rowHtml("ALPH", state().props.quote, [189.0, 189.42]));
  });

  test("a sparkline scales to its own range; one price draws nothing", () => {
    expect(sparkline([1])).toBe("");
    expect(sparkline([1, 3, 2], 100, 10)).toBe('<polyline points="0.0,10.0 50.0,0.0 100.0,5.0" fill="none" stroke="currentColor" stroke-width="1.2"/>');
    expect(sparkline([2, 2], 100, 10)).toContain("0.0,10.0 100.0,10.0"); // flat stays flat
  });

  test("a drawer's sparkline is the line alone, coloured by the last move and said as the range it spans", () => {
    expect(sparkSvg({ name: "x", price: 2, prev: 1 }, [1, 3, 2])).toStartWith('<svg class="sparkline up" viewBox="-1 -1 122 20" width="122" height="20" role="img" aria-label="3 prices, from 1.00 to 3.00"><polyline');
    expect(sparkSvg({ name: "x", price: 1, prev: 2 }, [2, 1])).toContain('class="sparkline down"');
    expect(sparkSvg({ name: "x", price: 1, prev: 1 }, [1, 1])).toContain('class="sparkline flat"');
    expect(drawSpark(state())).toBe(sparkSvg(state().props.quote, [189.0, 189.42]));
  });

  test("the quote's own patch moves it and extends its history, capped; other ops are ignored", () => {
    const s = state();
    const quote = (price: number, prev: number) => ({ id: "ALPH", name: "x", price, prev });
    expect(applyOps(s, [{ op: "remove", path: "" }, { op: "replace", path: "/name", value: "x" }, { op: "replace", path: "", value: { name: "x" } }])).toBe(false);
    expect(applyOps(s, [{ op: "replace", path: "", value: quote(190, 189.42) }])).toBe(true);
    expect(s.props.quote).toEqual({ name: "Alpha Systems", price: 190, prev: 189.42 });
    expect(s.history).toEqual([189.0, 189.42, 190]);
    applyOps(s, [{ op: "replace", path: "", value: { price: 191 } }]); // no prev said: the last price
    expect(s.props.quote.prev).toBe(190);
    for (let i = 0; i < HISTORY + 5; i++) applyOps(s, [{ op: "replace", path: "", value: quote(400 + i, 399 + i) }]);
    expect(s.history).toHaveLength(HISTORY);
  });
});
