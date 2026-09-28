import { read as readDoc } from "../../../src/documents";
import type { PatchOp } from "../../../src/json-patch";
import { parsePointer } from "../../../src/json-pointer";
import { refuse } from "../../../src/refusal";

// A session's watchlist, kept in delta (`watchlist:<id>`, ../delta.ts): the symbols its board
// shows, in the order added. The wire says `add /symbols/-` and `remove /symbols/<index>`; the
// document takes the list whole, so an undo puts back exactly the list that was.

export type WatchlistDocument = { symbols: string[] };

export function read(sessionId: string): WatchlistDocument {
  return { symbols: readDoc<{ watchlists?: { symbols: string[] | null } }>(`watchlist:${sessionId}`)?.watchlists?.symbols ?? [] };
}

/**
 * The list after `ops`: a symbol the market quotes (`has`) and the list lacks, added at the end; a
 * row it has, taken out. An add that cannot be is refused with why, which the ask draws beside its
 * field; a row it lacks is nothing, since no control offers one.
 */
export function after(symbols: string[], ops: PatchOp[], has: (symbol: string) => boolean): string[] {
  const next = [...symbols];
  for (const op of ops) {
    const [field, key] = parsePointer(op.path);
    if (field !== "symbols" || key === undefined) continue;
    if (key === "-" && op.op === "add") {
      const symbol = String(op.value ?? "").trim().toUpperCase();
      if (!symbol) throw refuse("Choose a symbol to watch.");
      if (!has(symbol)) throw refuse(`The market does not quote ${symbol}.`);
      if (next.includes(symbol)) throw refuse(`${symbol} is on your board already.`);
      next.push(symbol);
    } else if (op.op === "remove" && /^\d+$/.test(key) && Number(key) < next.length) {
      next.splice(Number(key), 1);
    }
  }
  return next;
}
