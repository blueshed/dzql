import { defineDoc } from "@blueshed/delta/sqlite";
import { read as readDoc } from "dzql/rendering/documents";
import { register, WEDDING } from "../../store";
import { weddingOf, type Row, type Wedding } from "../wedding/wedding-api";

// What a visitor without a code reads (`welcome:<id>`), on the ledger: the wedding's own row, no
// more. The couple write it through the board; nobody from the wire.
register([defineDoc("welcome:", { root: "weddings", include: [] })]);

/** The wedding as a visitor without a code reads it: its own row, nothing beneath it. */
export function read(): Wedding {
  return weddingOf(readDoc<{ weddings: Row }>(`welcome:${WEDDING}`).weddings);
}
