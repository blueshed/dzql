import type { Resource } from "dzql/rendering/resources/resource";

/**
 * One symbol of the market, as its own document (`quote:<SYMBOL>`): what a board row reads, so a
 * board is told only the symbols it watches. Written only through the market, whose ticks delta
 * tells it; nobody writes one from the wire.
 */
export const quote: Resource = {
  docType: "quote",
  undoable: false,
  under: "/quotes", // the document is the row: eta's paths start at it
  resolveDoc: () => undefined,
};
