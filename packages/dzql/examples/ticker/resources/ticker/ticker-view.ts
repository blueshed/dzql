import { address, matches, prop, rows, type OpenOptions, type Placeable } from "dzql/rendering/bento";
import { esc, write } from "dzql/rendering/html";
import { part } from "dzql/rendering/parts";
import { icon } from "../../icons";
import { surfaces } from "../../surfaces";
import type { View } from "../../page";
import { reading, where, type Ui } from "../desk/desk-api";
import { quote, quoteDoc } from "../quote/quote-api";
import type { MarketDocument, Quote } from "./ticker-api";

// The market's part of the page: every quote, a row each, live, and a symbol's drawer -- what its
// lit row does not say, and what it carries, watch or drop.

const { tool, findControl, cell, row, drawer, go } = surfaces;

// A symbol's drawer shows how its price is moving, beside a row that says what it is and what it costs:
// the move in per cent, and a sparkline of the ticks seen while the drawer is open, an applet on the
// quote's own document, as a board row is.
const sparkMount = (symbol: string): string => `<div id="spark-${esc(symbol)}" class="spark" data-applet="spark" data-doc="${esc(quoteDoc(symbol))}" data-under="/quote" data-props="${esc(JSON.stringify({ symbol, quote: quote(symbol) }))}"></div>`;

const direction = (q: Quote): "up" | "down" | "flat" => (q.price > q.prev ? "up" : q.price < q.prev ? "down" : "flat");

/** A quote's price and its move since the last tick, as the row's state. */
function priceState(q: Quote): string {
  const change = q.price - q.prev;
  return `<span class="price ${direction(q)}">${q.price.toFixed(2)}<small>${change >= 0 ? "+" : ""}${change.toFixed(2)}</small></span>`;
}

/** The move since the last tick, in per cent: what a row, which gives it in money, does not. */
function percentMove(q: Quote): string {
  const pct = q.prev ? ((q.price - q.prev) / q.prev) * 100 : 0;
  return `<span class="move ${direction(q)}">${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%</span>`;
}

/** A row of a list: the symbol leads, the name is the words, the price is the state, ✎ its drawer. One on your board carries the board's mark. */
export const symbolRow = (id: string, symbol: string, quote: Quote, ui: Ui, o: { hushed?: boolean; hidden?: boolean; watched?: boolean } = {}): string => {
  const { watched, ...shown } = o;
  const mark = watched ? icon("board", 14, "on your board") : "";
  return row({ id, tap: go(address(where(ui).path, "symbol", symbol)), chosen: where(ui).what === "symbol" && where(ui).which === symbol, lead: `<span class="symbol${watched ? " watched" : ""}">${esc(symbol)}${mark}</span>`, what: quote.name, state: priceState(quote), mark: "pencil", ...shown });
};

/** The market as a list: every quote, the watched ones marked; find dims what the word misses. Each row a part, so a tick sends the row it moved. */
function marketRows(v: View): string {
  const word = v.ui.filter?.market;
  const items = Object.entries(v.market).map(([s, q]) => {
    const miss = !matches(`${s} ${q.name}`, word);
    return symbolRow(`m-${s}`, s, q, v.ui, { hushed: miss, hidden: miss && v.ui.hide?.market, watched: v.list.symbols.includes(s) });
  });
  return part("market-rows", `<div id="market-rows">${rows(items, "The market is closed.")}</div>`);
}

/** The market on the box: how many it quotes. */
export const marketCell = (market: MarketDocument): Placeable => cell({ key: "market", name: "the market", mark: "market", count: Object.keys(market).length, span: 2, opens: go("market"), summary: "every quote, live" });

/** The market in the window: find, and every quote. */
export function marketOpen(v: View): OpenOptions {
  const word = v.ui.filter?.market;
  const symbols = Object.keys(v.market);
  const find = findControl("market", { word, hide: v.ui.hide?.market, shown: symbols.filter((s) => matches(`${s} ${v.market[s]!.name}`, word)).length, total: symbols.length });
  return { key: "market", tools: [find.tool], filter: find.filter, body: marketRows(v), note: "A tick is replace /SYMBOL/price; type one from the CLI and watch it land." };
}

/**
 * A symbol's drawer: what its lit row does not say, and what it carries -- watch, or drop. A list's
 * row (the market's, the board read as a list) has the name and the price, so its drawer gives the
 * move in per cent and a sparkline; a board row has those, and on a narrow board (a phone, or
 * beside this drawer) hides the name, so its drawer gives the name. The button says whether it is
 * watched.
 */
export function symbolDrawer(v: View, path: string, which: string, close: string): string {
  const q = v.market[which];
  if (!q) return "";
  const watched = v.list.symbols.includes(which);
  const carry = watched
    ? tool("Stop watching", { icon: "trash", kind: "danger", write: go(address(path, "confirm", which)) })
    : tool("Watch", { icon: "plus", kind: "add", write: write("watchlist", "add", "/symbols/-", which) });
  const fromBoardRow = path === "board" && reading(v.ui) === "sparkline";
  const props = fromBoardRow ? prop("Name", `<span>${esc(q.name)}</span>`) : prop("Moved", percentMove(q)) + prop("Lately", sparkMount(which));
  return drawer("drawer", which, `<div class="props">${props}</div><div class="drawer-foot">${carry}</div>`, close);
}
