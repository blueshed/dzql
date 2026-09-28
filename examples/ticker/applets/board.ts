// The board applet's drawing and patch logic: one watched symbol, a row with a sparkline, and how a
// tick moves its quote and extends its history. The board is a row per watched symbol, each an
// applet on that symbol's own document (`quote:<SYMBOL>`), so a board is told only what it shows.
// Both are pure functions over a RowState, tested here without a browser; the mounting that owns
// that state per element is board-applet.ts, imported only by client/main.ts.

import type { PatchOp } from "../../../src/json-patch";

export type Quote = { name: string; price: number; prev: number };

export interface RowProps {
  symbol: string;
  /** The quote as its document holds it (`quote:<SYMBOL>`): the patches land here. */
  quote: Quote;
}

export interface RowState {
  props: RowProps;
  /** The last prices seen, oldest first, for the sparkline. */
  history: number[];
}

export const HISTORY = 40;

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

const signed = (n: number, digits = 2): string => `${n >= 0 ? "+" : ""}${n.toFixed(digits)}`;

/**
 * One row, in HTML, so its words are the page's own size on any screen and a reader hears them:
 * symbol, name, price, the change since the last tick in money and in per cent, the sparkline.
 * `up`/`down` on the row is what the stylesheet flashes; a narrow board keeps the name and the
 * change in money for a reader only (styles.css).
 */
export function rowHtml(symbol: string, quote: Quote, history: number[]): string {
  const change = quote.price - quote.prev;
  const dir = change > 0 ? "up" : change < 0 ? "down" : "flat";
  const pct = quote.prev ? (change / quote.prev) * 100 : 0;
  return (
    `<div class="quote ${dir}" data-row="${esc(symbol)}">` +
    `<span class="symbol">${esc(symbol)}</span>` +
    `<span class="name">${esc(quote.name)}</span>` +
    `<span class="price">${quote.price.toFixed(2)}</span>` +
    `<span class="change"><span class="abs">${signed(change)}</span> <span class="pct">${signed(pct)}%</span></span>` +
    `<svg class="spark" viewBox="0 0 120 18" preserveAspectRatio="none" aria-hidden="true">${sparkline(history)}</svg>` +
    `</div>`
  );
}

/** The row as its state draws it. */
export const drawRow = (s: RowState): string => rowHtml(s.props.symbol, s.props.quote, s.history);

/** The sparkline alone, in a symbol's drawer: coloured by the last move, and said as the range it spans. */
export function sparkSvg(quote: Quote, history: number[]): string {
  const dir = quote.price > quote.prev ? "up" : quote.price < quote.prev ? "down" : "flat";
  const said = `${history.length} prices, from ${Math.min(...history).toFixed(2)} to ${Math.max(...history).toFixed(2)}`;
  return `<svg class="sparkline ${dir}" viewBox="-1 -1 122 20" width="122" height="20" role="img" aria-label="${said}">${sparkline(history)}</svg>`;
}

/** The drawer's sparkline as its state draws it. */
export const drawSpark = (s: RowState): string => sparkSvg(s.props.quote, s.history);

/**
 * Applies the quote's own patch to the state: a tick is the row it leaves, whole (`replace ""`,
 * `{price, prev, ...}`), which moves the quote and extends its history. True when it moved.
 */
export function applyOps(s: RowState, ops: PatchOp[]): boolean {
  let moved = false;
  for (const op of ops) {
    const value = op.value as { price?: unknown; prev?: unknown } | undefined;
    if (op.path !== "" || op.op !== "replace" || typeof value?.price !== "number") continue;
    const quote = s.props.quote;
    quote.prev = Number(value.prev ?? quote.price);
    quote.price = value.price;
    s.history = [...s.history, quote.price].slice(-HISTORY);
    moved = true;
  }
  return moved;
}
