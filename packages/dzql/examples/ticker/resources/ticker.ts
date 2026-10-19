import * as clockDoc from "../documents/clock";
import * as market from "../documents/market";
import * as watchlistDoc from "../documents/watchlist";
import type { PatchOp } from "dzql/rendering/json-patch";
import type { Resource } from "dzql/rendering/resources/resource";
import { audienceFor } from "dzql/rendering/resources/audience";
import { activeDocuments, serverWrite, settled } from "dzql/rendering/documents";
import { toldAt } from "dzql/rendering/refusal";
import * as deskDoc from "../documents/desk";
import { page } from "../views/page";

// The market, and the page. A tick -- from the feed below, or typed by anyone through the wire
// or the CLI -- is a write to the market document, echoed to every connection; the board applet
// on each page takes the ops itself (Applet.patch), and a page is sent only the parts of it that
// show a price. The feed runs only while someone is connected: the market moves while
// it is watched, and a test suite that never opens a socket never starts it. "Everyone" is the
// kernel's own open-connection registry, not a set this module keeps
// itself -- `resolveDoc` below names the one market for any socket, so every connection sees it
// and audienceFor("ticker", MARKET) already answers "who's open" for free.

let feed: ReturnType<typeof setInterval> | undefined;

/** How often the feed ticks, in milliseconds (TICK_MS), and how far a price may move each time. */
const TICK_MS = Number(process.env.TICK_MS ?? 500);
const MAX_MOVE = 0.006;

/** A tick from the feed -- the market's own, nobody's: applied, echoed to everyone, each page sent what changed on it. */
export async function tick(ops: PatchOp[]): Promise<void> {
  const shaped = await settled(activeDocuments(), () => market.ticks(ops));
  if (shaped.length > 0) await serverWrite(`ticker:${market.MARKET}`, shaped.map((op) => ({ ...op, path: `/quotes${op.path}` })));
}

/** A random walk: one symbol, a move within MAX_MOVE either way. */
export function randomTick(quotes = market.read()): PatchOp[] {
  const symbols = Object.keys(quotes);
  const symbol = symbols[Math.floor(Math.random() * symbols.length)]!;
  const price = quotes[symbol]!.price * (1 + (Math.random() * 2 - 1) * MAX_MOVE);
  return [{ op: "replace", path: `/${symbol}/price`, value: Math.round(price * 100) / 100 }];
}

/** Starts the feed at `ms` between ticks (TICK_MS by default; 0 means no feed at all), if it is not already running. */
export function startFeed(ms = TICK_MS): void {
  if (feed || ms <= 0) return;
  feed = setInterval(() => {
    if (activeDocuments()) void settled(activeDocuments(), () => randomTick()).then(tick);
  }, ms);
}

export function stopFeed(): void {
  if (!feed) return;
  clearInterval(feed);
  feed = undefined;
}

const TICK_PATH = /^\/[A-Z0-9.]+\/price$/;

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

/** The desk: the whole page, from every document a session has, and why its last watch was refused, if it was. */
export const render = (sessionId: string): string =>
  page({ list: watchlistDoc.read(sessionId), market: market.read(), clock: clockDoc.read(sessionId), ui: deskDoc.read(sessionId), said: toldAt(sessionId, "watchlist", "/symbols/-") });

export const ticker: Resource = {
  docType: "ticker",
  undoable: false, // on the ledger, never undone
  under: "/quotes", // eta's `/ALPH/price` is the document's `/quotes/ALPH/price`
  resolveDoc() {
    return market.MARKET; // everyone sees the one market
  },
  // Anyone may type a tick: this is a demo of the wire, not an exchange.
  permit(_ws, op) {
    return op.op === "replace" && TICK_PATH.test(op.path);
  },
  shape: (_ws, _docId, ops) => market.ticks(ops),
  // A tick is never undone, so the ledger's cursor never lands here. What each page
  // is sent after one is worked out from its parts: the board applet takes the ops, so on the box
  // nothing; the market's rows, the board as a list, a symbol's drawer -- whatever shows a price.
  onOpen() {
    startFeed();
  },
  onClose() {
    // The kernel deregisters a closing socket before calling onClose, so an empty audience here
    // means this was the last one.
    if (audienceFor("ticker", market.MARKET).length === 0) stopFeed();
  },
};
