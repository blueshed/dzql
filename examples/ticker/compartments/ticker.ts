import type { ServerWebSocket } from "bun";
import * as clockDoc from "../documents/clock";
import * as market from "../documents/market";
import * as watchlistDoc from "../documents/watchlist";
import type { ConnectionData } from "../../../src/connection";
import { patchMessage, type PatchOp } from "../../../src/json-patch";
import type { Compartment, WriteResult } from "../../../src/compartments/compartment";
import { renderRequested } from "../../../src/compartments/render";
import { page } from "../views/page";

// The market, and the page. A tick -- from the feed below, or typed by anyone through the wire
// or the CLI -- is a write to the market document, echoed to every connection; the board applet
// on each page takes the ops itself (Applet.patch), so `fragments` answers that nothing on the
// page needs rendering. The feed runs only while someone is connected: the market moves while
// it is watched, and a test suite that never opens a socket never starts it.

const sockets = new Set<ServerWebSocket<ConnectionData>>();
let feed: ReturnType<typeof setInterval> | undefined;

/** How often the feed ticks, in milliseconds (TICK_MS), and how far a price may move each time. */
const TICK_MS = Number(process.env.TICK_MS ?? 500);
const MAX_MOVE = 0.006;

/** One tick, from wherever it comes: applied, echoed to everyone, the pages told (and answered with nothing to render). */
export function tick(ops: PatchOp[], sessionId: string): WriteResult {
  const result = market.patch(ops, sessionId);
  if (result.applied.length > 0) {
    const payload = patchMessage("ticker", result.version, result.applied);
    for (const ws of sockets) ws.send(payload);
    renderRequested.emit({ sockets, write: { docType: "ticker", docId: market.MARKET, result } });
  }
  return result;
}

/** A random walk: one symbol, a move within MAX_MOVE either way. */
export function randomTick(): PatchOp[] {
  const quotes = market.read();
  const symbols = Object.keys(quotes);
  const symbol = symbols[Math.floor(Math.random() * symbols.length)]!;
  const price = quotes[symbol]!.price * (1 + (Math.random() * 2 - 1) * MAX_MOVE);
  return [{ op: "replace", path: `/${symbol}/price`, value: Math.round(price * 100) / 100 }];
}

/** Starts the feed at `ms` between ticks (TICK_MS by default; 0 means no feed at all), if it is not already running. */
export function startFeed(ms = TICK_MS): void {
  if (feed || ms <= 0) return;
  feed = setInterval(() => tick(randomTick(), "feed"), ms);
}

export function stopFeed(): void {
  if (!feed) return;
  clearInterval(feed);
  feed = undefined;
}

const TICK_PATH = /^\/[A-Z0-9.]+\/price$/;

export const ticker: Compartment = {
  docType: "ticker",
  render(sessionId) {
    return page(watchlistDoc.read(sessionId), market.read(), clockDoc.read(sessionId));
  },
  resolveDoc() {
    return market.MARKET; // everyone sees the one market
  },
  // Anyone may type a tick: this is a demo of the wire, not an exchange.
  permit(_ws, op) {
    return op.op === "replace" && TICK_PATH.test(op.path);
  },
  write(ws, _docId, ops) {
    const result = tick(ops, ws.data.sessionId);
    return result;
  },
  // No replay(): a tick is recorded as not undoable, so the ledger's cursor never lands here.
  // The board took the ops; there is nothing on the page to render.
  fragments() {
    return [];
  },
  onOpen(ws) {
    sockets.add(ws);
    startFeed();
  },
  onClose(ws) {
    sockets.delete(ws);
    if (sockets.size === 0) stopFeed();
  },
};
