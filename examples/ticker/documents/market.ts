import { read as readDoc } from "../../../src/documents";
import type { PatchOp } from "../../../src/json-patch";
import { splitPath } from "@blueshed/delta/core";

// The market: one document, a quote per symbol, kept in delta (`ticker:market`, ../delta.ts), and
// each quote as its own document too (`quote:<SYMBOL>`), for a board that watches it. A
// tick is `replace /<SYMBOL>/price`, from the feed or from anyone the compartment permits. It is a
// fact, not the person's doing: on the ledger with its inverse, so the last minute can be read
// back, and never undone -- nobody's Undo can move the market.

export type Quote = { name: string; price: number; prev: number; id?: string; markets_id?: string };
export type MarketDocument = Record<string, Quote>;

/** The market's one document id. */
export const MARKET = "market";

/** The quotes as delta holds them -- each a row, its id and the market's with it -- so the market's ops land on them as they are. */
export function read(): MarketDocument {
  return readDoc<{ quotes?: MarketDocument }>(`ticker:${MARKET}`)?.quotes ?? {};
}

/** One quote, from its own document (`quote:<SYMBOL>`): what a board watching it reads, and is told of. */
export function quote(symbol: string): Quote {
  return readDoc<{ quotes: Quote }>(`quote:${symbol}`).quotes;
}

export function has(symbol: string): boolean {
  return symbol in read();
}

/**
 * Ticks as the market takes them: `replace /<SYMBOL>/price` with a positive number, to a symbol
 * the market has, rounded to the cent, and only if it moves. A tick moves two fields -- the last
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
    shaped.push({ op: "replace", path: `/${symbol}/prev`, value: before.price }, { op: "replace", path: `/${symbol}/price`, value: rounded });
    quotes[symbol] = { ...before, prev: before.price, price: rounded };
  }
  return shaped;
}
