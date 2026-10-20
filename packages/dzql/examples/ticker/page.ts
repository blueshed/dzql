import { layers, type Crumb } from "dzql/rendering/bento";
import { toldAt } from "dzql/rendering/refusal";
import { surfaces } from "./surfaces";
import { read as deskOf, where, type Ui } from "./resources/desk/desk-api";
import { read as marketOf, type MarketDocument } from "./resources/ticker/ticker-api";
import { marketCell, marketOpen, symbolDrawer } from "./resources/ticker/ticker-view";
import { read as watchlistOf, type WatchlistDocument } from "./resources/watchlist/watchlist-api";
import { boardCell, boardOpen, modals } from "./resources/watchlist/watchlist-view";
import { read as clockOf, type ClockDocument } from "./resources/clock/clock-api";
import { clockCell, clockDrawer } from "./resources/clock/clock-view";

// The desk, drawn to the bento (docs/bento/README.md) by the server for whoever is looking, from
// the parts each resource draws (`resources/<name>/<name>-view.ts`): a box with three cells -- the
// board, big, with two readings (the watchlist's); the market (the ticker's); the clock, a thing
// whose drawer holds the city -- each growing into the window when opened, the tools on the rail,
// the page's at the bottom right. A row is a symbol: its drawer holds what it is and what it can
// carry, watch or drop. Watching is the plus and a modal; dropping asks in one too.

const { boxPage, go, site } = surfaces;

export type View = {
  list: WatchlistDocument;
  market: MarketDocument;
  clock: ClockDocument;
  ui: Ui;
  /** Why the last watch was refused, drawn beside the ask's field (src/rendering/refusal.ts `toldAt`), or "". */
  said?: string;
};

/** The drawer over the desk: a symbol's, or the clock's time zone. */
function openDrawer(v: View): string {
  const { path, what, which = "" } = where(v.ui);
  const close = go(path);
  if (what === "clock") return clockDrawer(v.clock, close);
  return what === "symbol" ? symbolDrawer(v, path, which, close) : "";
}

/** The desk: the box, or one cell grown into the window; the drawer and the modal over it. */
export function page(v: View): string {
  const at = where(v.ui);
  const cells = [boardCell(v.list, v.market), marketCell(v.market), clockCell(v.clock, at.what === "clock")];
  const opened = at.path === "board" ? boardOpen(v) : at.path === "market" ? marketOpen(v) : undefined;
  const desk: Crumb = { label: "The desk", back: go("") };
  const trail = opened ? [desk, { label: `the ${opened.key}` }] : [desk];
  const modal = modals(v);
  const over = openDrawer(v);
  // the page's address goes in the URL, so the back button closes a drawer and a link opens one
  return site(v.ui.page ?? "", layers(boxPage(trail, [], cells, opened), over, modal));
}

/** The desk: the whole page, from every document a session has, where its tab stands (`address`), and why its last watch was refused, if it was. */
export const render = (sessionId: string, address: string): string =>
  page({ list: watchlistOf(sessionId), market: marketOf(), clock: clockOf(sessionId), ui: { ...deskOf(sessionId), page: address }, said: toldAt(sessionId, "watchlist", "/symbols/-") });
