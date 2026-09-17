import * as clockDoc from "../documents/clock";
import * as market from "../documents/market";
import * as watchlistDoc from "../documents/watchlist";
import type { PatchOp } from "../../../src/json-patch";
import type { Compartment, WriteResult } from "../../../src/compartments/compartment";
import { audienceFor, notify } from "../../../src/compartments/audience";
import * as deskDoc from "../documents/desk";
import { boardList, marketRows, page, reading } from "../views/page";
import type { HtmlOp } from "../../../src/compartments/render";

// The market, and the page. A tick -- from the feed below, or typed by anyone through the wire
// or the CLI -- is a write to the market document, echoed to every connection; the board applet
// on each page takes the ops itself (Applet.patch), so `fragments` answers that nothing on the
// page needs rendering. The feed runs only while someone is connected: the market moves while
// it is watched, and a test suite that never opens a socket never starts it. "Everyone" is the
// kernel's own open-connection registry (change-request.md item 1), not a set this module keeps
// itself -- `resolveDoc` below already names the one market for any socket, which is `sees`'s
// default, so audienceFor("ticker", MARKET) already answers "who's open" for free.

let feed: ReturnType<typeof setInterval> | undefined;

/** How often the feed ticks, in milliseconds (TICK_MS), and how far a price may move each time. */
const TICK_MS = Number(process.env.TICK_MS ?? 500);
const MAX_MOVE = 0.006;

/** One tick, from wherever it comes: applied, echoed to everyone, the pages told (and answered with nothing to render). */
export function tick(ops: PatchOp[], sessionId: string): WriteResult {
  const result = market.patch(ops, sessionId);
  notify("ticker", market.MARKET, result);
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
    return page({ list: watchlistDoc.read(sessionId), market: market.read(), clock: clockDoc.read(sessionId), ui: deskDoc.read(sessionId) });
  },
  resolveDoc() {
    return market.MARKET; // everyone sees the one market
  },
  // Anyone may type a tick: this is a demo of the wire, not an exchange.
  permit(_ws, op) {
    return op.op === "replace" && TICK_PATH.test(op.path);
  },
  write(ws, _docId, ops) {
    return tick(ops, ws.data.sessionId);
  },
  // No replay(): a tick is recorded as not undoable, so the ledger's cursor never lands here.
  // The board applet took the ops, so on the box there is nothing to render; a session reading
  // the market's rows, or the board as a list, has those rows redrawn and nothing else.
  fragments(ws): HtmlOp[] | undefined {
    const ui = deskDoc.read(ws.data.sessionId);
    // a symbol's drawer says its price too: rather than list one more target that has to be right
    // for every state the desk can be in, decline, and the kernel redraws this compartment whole
    if (ui.focus && ui.focus !== "clock") return undefined;
    const v = { list: watchlistDoc.read(ws.data.sessionId), market: market.read(), clock: clockDoc.read(ws.data.sessionId), ui };
    const ops: HtmlOp[] = [];
    if (ui.open === "market") ops.push({ op: "replace", target: "#market-rows", html: marketRows(v) });
    if (ui.open === "board" && reading(ui) === "list") ops.push({ op: "replace", target: "#board-list", html: boardList(v) });
    return ops;
  },
  onOpen() {
    startFeed();
  },
  onClose() {
    // The kernel deregisters a closing socket before calling onClose, so an empty audience here
    // means this was the last one.
    if (audienceFor("ticker", market.MARKET).length === 0) stopFeed();
  },
};
