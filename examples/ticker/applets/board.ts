// The board applet: the watched symbols as an SVG table with a sparkline each, drawn in the
// browser from the market it was handed as props, and kept current from the market's own
// patches -- a tick is `replace /<SYMBOL>/price`, and the applet redraws that row. Nothing
// about a price is rendered on the server twice: the page carries the board once, and after
// that only the ops cross the wire. The history behind each sparkline is the applet's own,
// derived from the ticks it has seen.

import { registerApplet } from "../../../src/applets";
import type { PatchOp } from "../../../src/json-patch";

export type Quote = { name: string; price: number; prev: number };

export interface BoardProps {
  symbols: string[];
  quotes: Record<string, Quote>;
}

export interface BoardState {
  props: BoardProps;
  /** The last prices seen per symbol, oldest first, for the sparkline. */
  history: Record<string, number[]>;
}

export const HISTORY = 40;
const ROW = 28;
const W = 640;

const esc = (s: string) => s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;");

/** A polyline of the recent prices, scaled to its own range, so a flat line is a flat line and a move is visible whatever the price. */
export function sparkline(prices: number[], w = 120, h = 18): string {
  if (prices.length < 2) return "";
  const lo = Math.min(...prices);
  const hi = Math.max(...prices);
  const span = hi - lo || 1;
  const points = prices.map((p, i) => `${((i / (prices.length - 1)) * w).toFixed(1)},${(h - ((p - lo) / span) * h).toFixed(1)}`);
  return `<polyline points="${points.join(" ")}" fill="none" stroke="currentColor" stroke-width="1.2"/>`;
}

/** One row: symbol, name, price, the change since the last tick, the sparkline. `up`/`down` on the row is what the stylesheet flashes. */
export function rowSvg(symbol: string, quote: Quote, history: number[], y: number): string {
  const change = quote.price - quote.prev;
  const dir = change > 0 ? "up" : change < 0 ? "down" : "flat";
  const pct = quote.prev ? ((change / quote.prev) * 100).toFixed(2) : "0.00";
  return (
    `<g class="row ${dir}" data-row="${esc(symbol)}" transform="translate(0 ${y})">` +
    `<text class="symbol" x="0" y="18">${esc(symbol)}</text>` +
    `<text class="name" x="70" y="18">${esc(quote.name)}</text>` +
    `<text class="price" x="330" y="18" text-anchor="end">${quote.price.toFixed(2)}</text>` +
    `<text class="change" x="480" y="18" text-anchor="end">${change >= 0 ? "+" : ""}${change.toFixed(2)} (${pct}%)</text>` +
    `<g class="spark" transform="translate(510 4)">${sparkline(history)}</g>` +
    `</g>`
  );
}

export function boardSvg(state: BoardState): string {
  const { symbols, quotes } = state.props;
  if (!symbols.length) return `<p class="empty">Nothing watched yet. Add a symbol.</p>`;
  const rows = symbols.map((s, i) => (quotes[s] ? rowSvg(s, quotes[s]!, state.history[s] ?? [quotes[s]!.price], i * ROW) : "")).join("");
  return `<svg class="board" viewBox="0 0 ${W} ${symbols.length * ROW}" width="100%" aria-label="the board">${rows}</svg>`;
}

const state = new WeakMap<HTMLElement, BoardState>();

/** Applies a market patch to the state: a tick moves a quote and extends its history. Returns the symbols touched. */
export function applyOps(s: BoardState, ops: PatchOp[]): string[] {
  const touched: string[] = [];
  for (const op of ops) {
    const m = /^\/([A-Z0-9.]+)\/price$/.exec(op.path);
    if (!m || op.op !== "replace") continue;
    const symbol = m[1]!;
    const quote = s.props.quotes[symbol];
    if (!quote) continue;
    quote.prev = quote.price;
    quote.price = Number(op.value);
    s.history[symbol] = [...(s.history[symbol] ?? [quote.prev]), quote.price].slice(-HISTORY);
    touched.push(symbol);
  }
  return touched;
}

const draw = (el: HTMLElement) => {
  el.innerHTML = boardSvg(state.get(el)!);
};

registerApplet("board", {
  mount(el, ctx) {
    const props = ctx.props as BoardProps;
    state.set(el, { props, history: Object.fromEntries(Object.entries(props.quotes).map(([s, q]) => [s, [q.prev, q.price]])) });
    draw(el);
    return () => state.delete(el);
  },
  // The watchlist changed: new symbols, the same market; the histories seen so far are kept.
  update(el, props) {
    const s = state.get(el);
    if (!s) return;
    const next = props as BoardProps;
    for (const [symbol, quote] of Object.entries(next.quotes)) if (!s.history[symbol]) s.history[symbol] = [quote.prev, quote.price];
    s.props = next;
    draw(el);
  },
  // A tick: the market's own op, straight from the echo. The row it touches is redrawn, and its
  // `up`/`down` class arriving fresh is what makes it flash.
  patch(el, ops) {
    const s = state.get(el);
    if (!s) return;
    if (applyOps(s, ops).length) draw(el);
  },
});
