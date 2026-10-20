import { defineDoc } from "@blueshed/delta/sqlite";
import { read as readDoc } from "dzql/rendering/documents";
import { register } from "../../store";
import { read as market, type Quote } from "../ticker/ticker-api";

// One quote, for a board that watches it (`quote:<id>`): a row of the market as a document of its
// own, so a board is told only the symbols it watches. A tick on the market is told to it too
// (delta's fan-out); nobody writes one from the wire.
register([defineDoc("quote:", { root: "quotes", include: [] })]);

/** A symbol's own document: `quote:<id>`. */
export const quoteDoc = (symbol: string): string => `quote:${market()[symbol]!.id}`;

/** One quote, from its own document (`quote:<id>`): what a board watching it reads, and is told of. */
export function quote(symbol: string): Quote {
  return readDoc<{ quotes: Quote }>(quoteDoc(symbol)).quotes;
}
