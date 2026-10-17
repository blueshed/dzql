import type { ServerWebSocket } from "bun";
import type { ConnectionData } from "./connection";
import { prefixDoc } from "./names";
import { drawParts, type Drawn } from "./parts";

// What a connection sees is what its page read. While the kernel draws a page for a connection,
// every document the drawing reads says so (`reading`, called by the document's own `read()`), and
// the set is kept for that connection: those are the documents it is told about, and may write.
// Show two months side by side and both are seen; stop showing one and it is not. Outside a
// drawing -- a write, a permit, a test's fresh render -- `reading` does nothing.

const drawings: Set<string>[] = [];
const shown = new WeakMap<ServerWebSocket<ConnectionData>, Set<string>>();

/** A document's `read()` calls this: `<docType>:<docId>` is on the page being drawn, if one is. */
export function reading(doc: string): void {
  drawings.at(-1)?.add(doc);
}

/** Draws the page for `ws`, in parts (src/parts.ts), and keeps what the drawing read in place of what its page read before. */
export function drawing(ws: ServerWebSocket<ConnectionData>, draw: () => string): Drawn {
  const read = new Set<string>();
  drawings.push(read);
  try {
    return drawParts(draw);
  } finally {
    drawings.pop();
    shown.set(ws, read);
  }
}

/** Did the page last drawn for `ws` read this document? */
export function shows(ws: ServerWebSocket<ConnectionData>, docType: string, docId: string): boolean {
  return shown.get(ws)?.has(prefixDoc(docType, docId)) ?? false;
}

/** Every document the page last drawn for `ws` read, as `<docType>:<docId>`, in the order read. */
export function shownTo(ws: ServerWebSocket<ConnectionData>): string[] {
  return [...(shown.get(ws) ?? [])];
}
