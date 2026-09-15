import { db } from "../db";
import type { PatchOp } from "../../../src/json-patch";
import { parsePointer } from "../../../src/json-pointer";
import { prefixDoc, record } from "../../../src/ledger";

// The market: one document, a quote per symbol. A tick is `replace /<SYMBOL>/price`, from the
// feed or from anyone the concept permits, and every tick is on the ledger with its inverse --
// so the last minute can be replayed, and a hand-typed tick can be undone.

export type Quote = { name: string; price: number; prev: number };
export type MarketDocument = Record<string, Quote>;

/** The market's one document id. */
export const MARKET = "market";

const quotesStmt = db.query<{ symbol: string; name: string; price: number; prev: number }, []>(
  "SELECT symbol, name, price, prev FROM quotes ORDER BY symbol",
);
const quoteStmt = db.query<{ price: number }, [string]>("SELECT price FROM quotes WHERE symbol = ?");
const tickStmt = db.query<unknown, [number, number, string]>("UPDATE quotes SET prev = price, price = ?, updated_at = ? WHERE symbol = ?");

export function read(): MarketDocument {
  return Object.fromEntries(quotesStmt.all().map(({ symbol, ...quote }) => [symbol, quote]));
}

export function symbols(): string[] {
  return quotesStmt.all().map((q) => q.symbol);
}

export function has(symbol: string): boolean {
  return quoteStmt.get(symbol) !== null;
}

export type MarketPatchResult = { version: number; applied: PatchOp[] };

/** Applies ticks: `replace /<SYMBOL>/price` with a positive number, to a symbol the market has. */
export function patch(ops: PatchOp[], sessionId: string, undoes?: number): MarketPatchResult {
  const applied: PatchOp[] = [];
  const inverse: PatchOp[] = [];

  for (const op of ops) {
    const [symbol, field] = parsePointer(op.path);
    if (op.op !== "replace" || !symbol || field !== "price") continue;
    const price = Number(op.value);
    if (!Number.isFinite(price) || price <= 0) continue;
    const before = quoteStmt.get(symbol);
    if (!before) continue;
    const rounded = Math.round(price * 100) / 100;
    if (rounded === before.price) continue;
    tickStmt.run(rounded, Date.now(), symbol);
    applied.push({ ...op, value: rounded });
    inverse.unshift({ op: "replace", path: op.path, value: before.price });
  }

  const version = record(prefixDoc("ticker", MARKET), applied, inverse, sessionId, undoes);
  return { version, applied };
}
