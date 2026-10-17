import { read as readDoc } from "dzql/rendering/documents";
import type { PatchOp } from "dzql/rendering/json-patch";
import { splitPath } from "@blueshed/delta/core";

// The market: one document, a quote per symbol, kept in delta (`ticker:1`, ../delta.ts), and
// each quote as its own document too (`quote:<id>`), for a board that watches it. A quote is a
// numbered row that says its symbol; people and the page name it by the symbol. A tick is
// `replace /<SYMBOL>/price`, from the feed or from anyone the resource permits, which the market
// keeps as `/<id>/price`. It is a fact, not the person's doing: on the ledger with its inverse, so
// the last minute can be read back, and never undone -- nobody's Undo can move the market.

export type Quote = { symbol: string; name: string; price: number; prev: number; id: number; markets_id?: number };
/** The quotes, by symbol. */
export type MarketDocument = Record<string, Quote>;

/** The market's one document id. */
export const MARKET = "1";

/** The quotes as delta holds them -- each a row, its id and the market's with it -- by symbol. */
export function read(): MarketDocument {
  const rows = readDoc<{ quotes?: Record<string, Quote> }>(`ticker:${MARKET}`)?.quotes ?? {};
  return Object.fromEntries(Object.values(rows).map((q) => [q.symbol, q]));
}

/** A symbol's own document: `quote:<id>`. */
export const quoteDoc = (symbol: string): string => `quote:${read()[symbol]!.id}`;

/** One quote, from its own document (`quote:<id>`): what a board watching it reads, and is told of. */
export function quote(symbol: string): Quote {
  return readDoc<{ quotes: Quote }>(quoteDoc(symbol)).quotes;
}

export function has(symbol: string): boolean {
  return symbol in read();
}

/**
 * Ticks as the market takes them: `replace /<SYMBOL>/price` with a positive number, to a symbol
 * the market has, rounded to the cent, and only if it moves; kept at the quote's id. A tick moves two fields -- the last
 * price becomes `prev` -- and the ops say both, so what follows the stream (the board) holds what
 * the market does without knowing how it ticks.
 */
export function ticks(ops: PatchOp[]): PatchOp[] {
  const quotes = read();
  const shaped: PatchOp[] = [];
  for (const op of ops) {
    const [symbol, field] = splitPath(op.path);
    if (op.op !== "replace" || !symbol || field !== "price") continue;
    const price = Number(op.value);
    const before = quotes[symbol];
    if (!Number.isFinite(price) || price <= 0 || !before) continue;
    const rounded = Math.round(price * 100) / 100;
    if (rounded === before.price) continue;
    shaped.push({ op: "replace", path: `/${before.id}/prev`, value: before.price }, { op: "replace", path: `/${before.id}/price`, value: rounded });
    quotes[symbol] = { ...before, prev: before.price, price: rounded };
  }
  return shaped;
}
