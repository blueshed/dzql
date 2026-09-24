import { describe, expect, test } from "bun:test";
import { HISTORY, applyOps, boardSvg, rowSvg, sparkline, type BoardState } from "./board";

const state = (): BoardState => ({
  props: { symbols: ["ALPH", "MIKE"], quotes: { ALPH: { name: "Alpha Systems", price: 189.42, prev: 189.0 }, MIKE: { name: "Mike Semiconductors", price: 402.77, prev: 402.77 } } },
  history: { ALPH: [189.0, 189.42] },
});

describe("board", () => {
  test("a row shows the symbol, the name, the price, the change and its direction, and a sparkline of what it has seen", () => {
    const row = rowSvg("ALPH", { name: "Alpha Systems", price: 189.42, prev: 189.0 }, [189.0, 189.42], 0);
    expect(row).toContain('class="row up" data-row="ALPH"');
    expect(row).toContain(">189.42<");
    expect(row).toContain(">+0.42 (0.22%)<");
    expect(row).toContain("<polyline");
    expect(rowSvg("X", { name: "x", price: 1, prev: 2 }, [2, 1], 0)).toContain('class="row down"');
    expect(rowSvg("X", { name: "x", price: 1, prev: 1 }, [1], 0)).toContain('class="row flat"');
    expect(rowSvg("X", { name: "x", price: 1, prev: 0 }, [1], 0)).toContain("(0.00%)");
  });

  test("a sparkline scales to its own range; one price draws nothing", () => {
    expect(sparkline([1])).toBe("");
    expect(sparkline([1, 3, 2], 100, 10)).toBe('<polyline points="0.0,10.0 50.0,0.0 100.0,5.0" fill="none" stroke="currentColor" stroke-width="1.2"/>');
    expect(sparkline([2, 2], 100, 10)).toContain("0.0,10.0 100.0,10.0"); // flat stays flat
  });

  test("the board draws a row per watched symbol the market has, or says nothing is watched", () => {
    const svg = boardSvg(state());
    expect(svg).toStartWith('<svg class="board" viewBox="0 0 640 56"');
    expect(svg).toContain('data-row="ALPH"');
    expect(svg).toContain('data-row="MIKE"');
    expect(boardSvg({ props: { symbols: [], quotes: {} }, history: {} })).toContain("Nothing watched yet");
    expect(boardSvg({ props: { symbols: ["GONE"], quotes: {} }, history: {} })).not.toContain("data-row");
  });

  test("a market patch moves the quote and extends its history, capped; other ops are ignored", () => {
    const s = state();
    const quote = (price: number, prev: number) => ({ id: "x", name: "x", price, prev });
    expect(
      applyOps(s, [
        { op: "replace", path: "/ALPH", value: quote(190, 189.42) },
        { op: "replace", path: "/NOPE", value: quote(1, 1) },
        { op: "remove", path: "/ALPH" },
        { op: "replace", path: "/MIKE/name", value: "x" },
        { op: "replace", path: "/MIKE", value: { name: "x" } },
      ]),
    ).toEqual(["ALPH"]);
    expect(s.props.quotes.ALPH).toEqual({ name: "Alpha Systems", price: 190, prev: 189.42 });
    expect(s.history.ALPH).toEqual([189.0, 189.42, 190]);
    applyOps(s, [{ op: "replace", path: "/MIKE", value: { price: 401 } }]); // no prev said: the last price
    expect(s.props.quotes.MIKE!.prev).toBe(s.history.MIKE![0]!);
    for (let i = 0; i < HISTORY + 5; i++) applyOps(s, [{ op: "replace", path: "/MIKE", value: quote(400 + i, 399 + i) }]);
    expect(s.history.MIKE).toHaveLength(HISTORY);
  });
});
