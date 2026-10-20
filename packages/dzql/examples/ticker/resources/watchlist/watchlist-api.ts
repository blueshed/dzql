import { defineDoc } from "@blueshed/delta/sqlite";
import { read as readDoc } from "dzql/rendering/documents";
import type { PatchOp } from "dzql/rendering/json-patch";
import { splitPath } from "@blueshed/delta/core";
import { refuse } from "dzql/rendering/refusal";
import { register } from "../../store";

// A session's watchlist, kept in delta (`watchlist:<id>`, the session's row's `symbols`): the symbols its board
// shows, in the order added. The wire says `add /symbols/-` and `remove /symbols/<index>`; the
// document takes the list whole, so an undo puts back exactly the list that was. On the ledger.
register([defineDoc("watchlist:", { root: "desks", include: [], columns: { desks: ["symbols"] } })]);

export type WatchlistDocument = { symbols: string[] };

export function read(sessionId: string): WatchlistDocument {
  return { symbols: readDoc<{ desks?: { symbols: string[] | null } }>(`watchlist:${sessionId}`)?.desks?.symbols ?? [] };
}

/**
 * The list after `ops`: a symbol the market quotes (`has`) and the list lacks, added at the end; a
 * row it has, taken out. An add that cannot be is refused with why, which the ask draws beside its
 * field; a row it lacks is nothing, since no control offers one.
 */
export function after(symbols: string[], ops: PatchOp[], has: (symbol: string) => boolean): string[] {
  const next = [...symbols];
  for (const op of ops) {
    const [field, key] = splitPath(op.path);
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
