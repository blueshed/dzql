import { defineDoc } from "@blueshed/delta/sqlite";
import { read as readDoc } from "dzql/rendering/documents";
import type { PatchOp } from "dzql/rendering/json-patch";
import { splitPath } from "@blueshed/delta/core";
import { db, register } from "../../store";

// The market: one document, a quote per symbol, kept in delta (`ticker:1`), and each quote as its
// own document too (`quote:<id>`, ../quote/quote-api.ts), for a board that watches it. A quote is a
// numbered row that says its symbol; people and the page name it by the symbol. A tick is
// `replace /<SYMBOL>/price`, from the feed or from anyone the resource permits, which the market
// keeps as `/<id>/price`. It is not the person's doing: on the ledger with its inverse, so
// the last minute can be read back, and never undone -- nobody's Undo can move the market.

// The market as it opens: made-up names, made-up prices, so nothing here is anyone's advice.
const OPENING: [string, string, number][] = [
  ["ALPH", "Alpha Systems", 189.42],
  ["BRVO", "Bravo Foods", 64.1],
  ["CHRL", "Charlie Metals", 12.87],
  ["DLTA", "Delta Shipping", 231.05],
  ["ECHO", "Echo Networks", 41.66],
  ["FXTR", "Foxtrot Energy", 98.3],
  ["GOLF", "Golf Leisure", 27.15],
  ["HOTL", "Hotel Holdings", 155.8],
  ["INDA", "India Textiles", 8.92],
  ["JULT", "Juliet Pharma", 312.44],
  ["KILO", "Kilo Freight", 73.21],
  ["LIMA", "Lima Water", 19.48],
  ["MIKE", "Mike Semiconductors", 402.77],
  ["NOVA", "November Air", 56.09],
  ["OSCR", "Oscar Media", 33.6],
  ["PAPA", "Papa Retail", 121.15],
];
db.run("INSERT INTO ticker_markets (id) SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM ticker_markets WHERE id = 1)"); // its one market: kept with its history, so made once, never again
const open = db.query("INSERT INTO ticker_quotes (id, markets_id, symbol, name, price, prev) SELECT ?1, 1, ?2, ?3, ?4, ?4 WHERE NOT EXISTS (SELECT 1 FROM ticker_quotes WHERE symbol = ?2)");
OPENING.forEach(([symbol, name, price], i) => open.run(i + 1, symbol, name, price));

register([defineDoc("ticker:", { root: "markets", include: ["quotes"] })]);

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
