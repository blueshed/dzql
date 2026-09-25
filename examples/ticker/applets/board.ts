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
export function rowSvg(symbol: string, quote: Quote, history: number[]): string {
  const change = quote.price - quote.prev;
  const dir = change > 0 ? "up" : change < 0 ? "down" : "flat";
  const pct = quote.prev ? ((change / quote.prev) * 100).toFixed(2) : "0.00";
  return (
    `<svg class="board" viewBox="0 0 ${W} ${ROW}" width="100%" aria-label="${esc(symbol)}">` +
    `<g class="row ${dir}" data-row="${esc(symbol)}">` +
    `<text class="symbol" x="0" y="18">${esc(symbol)}</text>` +
    `<text class="name" x="70" y="18">${esc(quote.name)}</text>` +
    `<text class="price" x="330" y="18" text-anchor="end">${quote.price.toFixed(2)}</text>` +
    `<text class="change" x="480" y="18" text-anchor="end">${change >= 0 ? "+" : ""}${change.toFixed(2)} (${pct}%)</text>` +
    `<g class="spark" transform="translate(510 4)">${sparkline(history)}</g>` +
    `</g></svg>`
  );
}

/** The row as its state draws it. */
export const drawRow = (s: RowState): string => rowSvg(s.props.symbol, s.props.quote, s.history);

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
