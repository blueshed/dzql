// The desk, drawn by the bento's rules (docs/bento.md): a box with three
// cells -- the board, big, with two readings; the market; the clock, a thing whose drawer
// holds the city -- each growing into the window when opened, the tools on the rail, the page's
// at the bottom right. A row is a symbol: its drawer holds what it is and what it can carry, watch
// or drop. Watching is the plus and a modal; dropping asks in one too.

import { address, bento, layers, matches, parseAddress, prop, rows, type Crumb, type OpenOptions } from "../../../src/bento";
import { appletWrites, esc, write } from "../../../src/html";
import { part } from "../../../src/parts";
import type { ClockDocument } from "../documents/clock";
import { ZONES, cityOf, offsetOf } from "../documents/clock";
import type { Ui } from "../documents/desk";
import { quote, type MarketDocument, type Quote } from "../documents/market";
import type { WatchlistDocument } from "../documents/watchlist";
import { icon } from "./icons";

const { tool, readingSwitch, addTool, findControl, cell, boxPage, row, drawer, addModal, confirmModal, go, site, readAs } = bento({ icon, session: "desk" });

/** Going somewhere on the desk -- a window, a drawer over it, a modal -- is one write: the address. */
/** Where this session is: the window, and the one thing open over it. */
export const where = (ui: Ui) => parseAddress(ui.page);

export type View = {
  list: WatchlistDocument;
  market: MarketDocument;
  clock: ClockDocument;
  ui: Ui;
  /** Why the last watch was refused, drawn beside the ask's field (src/refusal.ts `toldAt`), or "". */
  said?: string;
};

// ───────────────────────────── the applets' mounts ─────────────────────────────

/** What the board says with nothing on it: once, where the plus that fills it is. */
const NOTHING_WATCHED = "Nothing watched yet. The plus asks which symbol.";

/**
 * The board: a row per watched symbol, each an applet on that symbol's own document, so a board is
 * told only the symbols it watches and each row takes its own ticks. Empty, the window says so; the
 * box's cell has said it already. On the box the cell is the one tap. In the window (`ui`), a row is
 * a figure, as a list's is (rule 13): a button over the whole line opens its drawer, from a finger
 * or the keyboard (rule 19), and says it is expanded while that is open. The button is named by the
 * line it lies over, which a reader then hears once, as the button. It is beside the applet's
 * mount, not around it, so the mount stands in the same place on the box and in the window and
 * keeps the ticks it has seen as the cell opens; and it is a part, so opening a drawer sends its
 * tag alone, never the mount's, whose props follow the patches (src/parts.ts).
 */
export function boardMount(list: WatchlistDocument, market: MarketDocument, ui?: Ui): string {
  const symbols = list.symbols.filter((s) => market[s]);
  if (!symbols.length) return `<div id="board" class="board"><p class="note">${NOTHING_WATCHED}</p></div>`;
  const tap = (symbol: string): string => {
    if (!ui) return "";
    const chosen = where(ui).what === "symbol" && where(ui).which === symbol;
    return part(`tap-${symbol}`, `<button type="button" class="board-tap" aria-labelledby="line-${esc(symbol)}"${go(address("board", "symbol", symbol))} aria-expanded="${chosen}"${chosen ? " data-reveal" : ""}></button>`);
  };
  const line = (symbol: string): string =>
    `<div id="line-${esc(symbol)}" data-applet="board" data-doc="quote:${esc(symbol)}" data-under="/quote"${ui ? ' aria-hidden="true"' : ""} data-props="${esc(JSON.stringify({ symbol, quote: quote(symbol) }))}"></div>`;
  const rowOf = (symbol: string) => part(`quote-${symbol}`, `<div id="quote-${esc(symbol)}" class="board-row">${line(symbol)}${tap(symbol)}</div>`);
  return `<div id="board" class="board">${symbols.map(rowOf).join("")}</div>`;
}

/** How many are watched, on the board's head -- nothing while none are, which the summary says; replaced with the board when the list changes. */
export const boardCount = (list: WatchlistDocument): string | null => (list.symbols.length ? `<span id="board-count">${list.symbols.length}</span>` : null);

// Every zone as "City (UTC+02:00)" -- or "City, Region (UTC-03:00)" where the zone names one --
// the options the city picker reads at mount. Offsets move with the clocks twice a year, so the
// list is rebuilt when a minute has passed.
let zoneOptions = "";
let zoneOptionsAt = 0;
export function zoneLabel(tz: string, now = new Date()): string {
  const parts = tz.split("/");
  const region = parts.length > 2 ? parts[1]!.replaceAll("_", " ") : "";
  return `${cityOf(tz)}${region ? `, ${region}` : ""} (UTC${offsetOf(tz, now)})`;
}
export function zoneOptionsHtml(now = Date.now()): string {
  if (now - zoneOptionsAt > 60_000) {
    zoneOptions = ZONES.map((tz) => `<option value="${esc(tz)}">${esc(zoneLabel(tz, new Date(now)))}</option>`).join("");
    zoneOptionsAt = now;
  }
  return zoneOptions;
}

/** The clock's face; the cell's summary names the city. */
const clockMount = (c: ClockDocument): string => `<div id="clock" data-applet="clock" data-doc="clock" data-props="${esc(JSON.stringify({ tz: c.tz }))}"></div>`;
// the picker's zones are its children, HTML the server wrote; the applet reads them once and draws its own field
const cityMount = (c: ClockDocument): string => `<div id="city" class="city" data-applet="city-picker" data-doc="clock"${appletWrites(["clock", "replace", "/tz"])} data-props="${esc(JSON.stringify({ tz: c.tz }))}"><datalist>${zoneOptionsHtml()}</datalist></div>`;

// A symbol's drawer shows how its price is moving, beside a row that says what it is and what it costs:
// the move in per cent, and a sparkline of the ticks seen while the drawer is open, an applet on the
// quote's own document, as a board row is.
const sparkMount = (symbol: string): string => `<div id="spark-${esc(symbol)}" class="spark" data-applet="spark" data-doc="quote:${esc(symbol)}" data-under="/quote" data-props="${esc(JSON.stringify({ symbol, quote: quote(symbol) }))}"></div>`;

// ───────────────────────────── the rows ─────────────────────────────

const direction = (q: Quote): "up" | "down" | "flat" => (q.price > q.prev ? "up" : q.price < q.prev ? "down" : "flat");

/** A quote's price and its move since the last tick, as the row's state. */
function priceState(q: Quote): string {
  const change = q.price - q.prev;
  return `<span class="price ${direction(q)}">${q.price.toFixed(2)}<small>${change >= 0 ? "+" : ""}${change.toFixed(2)}</small></span>`;
}

/** The move since the last tick, in per cent: what a row, which gives it in money, does not. */
function percentMove(q: Quote): string {
  const pct = q.prev ? ((q.price - q.prev) / q.prev) * 100 : 0;
  return `<span class="move ${direction(q)}">${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%</span>`;
}

/** A row of a list: the symbol leads, the name is the words, the price is the state, ✎ its drawer. One on your board carries the board's mark. */
const symbolRow = (id: string, symbol: string, quote: Quote, ui: Ui, o: { hushed?: boolean; hidden?: boolean; watched?: boolean } = {}): string => {
  const { watched, ...shown } = o;
  const mark = watched ? icon("board", 14, "on your board") : "";
  return row({ id, tap: go(address(where(ui).path, "symbol", symbol)), chosen: where(ui).what === "symbol" && where(ui).which === symbol, lead: `<span class="symbol${watched ? " watched" : ""}">${esc(symbol)}${mark}</span>`, what: quote.name, state: priceState(quote), mark: "pencil", ...shown });
};

/** The board as a list: a row per watched symbol, each a part, so a tick sends the row it moved. */
function boardList(v: View): string {
  const items = v.list.symbols.filter((s) => v.market[s]).map((s) => symbolRow(`b-${s}`, s, v.market[s]!, v.ui));
  return part("board-list", `<div id="board-list">${rows(items, NOTHING_WATCHED)}</div>`);
}

/** The market as a list: every quote, the watched ones marked; find dims what the word misses. Each row a part, so a tick sends the row it moved. */
function marketRows(v: View): string {
  const word = v.ui.filter?.market;
  const items = Object.entries(v.market).map(([s, q]) => {
    const miss = !matches(`${s} ${q.name}`, word);
    return symbolRow(`m-${s}`, s, q, v.ui, { hushed: miss, hidden: miss && v.ui.hide?.market, watched: v.list.symbols.includes(s) });
  });
  return part("market-rows", `<div id="market-rows">${rows(items, "The market is closed.")}</div>`);
}

// ───────────────────────────── the page ─────────────────────────────

export const reading = (ui: Ui): string => ui.reading?.board ?? "sparkline";

/** The symbols the board lacks: what the plus may offer. */
const unwatched = (v: View): string[] => Object.keys(v.market).filter((s) => !v.list.symbols.includes(s));

/** The board in the window: its two readings, and the plus while there is something left to watch; once there is not, the note says so in its place. */
function boardOpen(v: View): OpenOptions {
  const left = unwatched(v).length > 0;
  return {
    key: "board",
    reading: readingSwitch((["sparkline", "list"] as const).map((r) => [r, r === "sparkline" ? "board" : "list", reading(v.ui) === r, readAs("board", r)])),
    tools: left ? [addTool(go(address("board", "new")), "Watch a symbol")] : [],
    body: reading(v.ui) === "list" ? boardList(v) : `<div class="reading sparkline">${boardMount(v.list, v.market, v.ui)}</div>`,
    note: left ? null : "Everything is watched.",
  };
}

function marketOpen(v: View): OpenOptions {
  const word = v.ui.filter?.market;
  const symbols = Object.keys(v.market);
  const find = findControl("market", { word, hide: v.ui.hide?.market, shown: symbols.filter((s) => matches(`${s} ${v.market[s]!.name}`, word)).length, total: symbols.length });
  return { key: "market", tools: [find.tool], filter: find.filter, body: marketRows(v), note: "A tick is replace /SYMBOL/price; type one from the CLI and watch it land." };
}

/**
 * The drawer: what a symbol's lit row does not say, and what it carries -- watch, or drop -- or the
 * clock's time zone. A list's row (the market's, the board read as a list) has the name and the
 * price, so its drawer gives the move in per cent and a sparkline; a board row has those, and on a
 * narrow board (a phone, or beside this drawer) hides the name, so its drawer gives the name. The
 * button says whether it is watched; the cell and the picker say the city.
 */
function openDrawer(v: View): string {
  const { path, what, which = "" } = where(v.ui);
  const close = go(path);
  if (what === "clock") return drawer("drawer", "Time zone", `<div class="props">${prop("City", cityMount(v.clock))}${prop("Offset", `<span>UTC${esc(v.clock.offset)}</span>`)}</div>`, close);
  const q = what === "symbol" ? v.market[which] : undefined;
  if (!q) return "";
  const watched = v.list.symbols.includes(which);
  const carry = watched
    ? tool("Stop watching", { icon: "trash", kind: "danger", write: go(address(path, "confirm", which)) })
    : tool("Watch", { icon: "plus", kind: "add", write: write("watchlist", "add", "/symbols/-", which) });
  const fromBoardRow = path === "board" && reading(v.ui) === "sparkline";
  const props = fromBoardRow ? prop("Name", `<span>${esc(q.name)}</span>`) : prop("Moved", percentMove(q)) + prop("Lately", sparkMount(which));
  return drawer("drawer", which, `<div class="props">${props}</div><div class="drawer-foot">${carry}</div>`, close);
}

/**
 * The modals: which symbol to watch -- chosen from those the board lacks, so the ask sends only what
 * can be; a write that cannot be (from the wire, the CLI) is refused, and while the ask is open it
 * says why beneath its field; with nothing left there is no ask -- and whether to stop watching
 * one. One question each; cancelling goes back to where it was asked from.
 */
function modals(v: View): string {
  const { path, what, which = "" } = where(v.ui);
  if (what === "new") {
    const options = unwatched(v).map((s) => ({ value: s, text: `${s} · ${v.market[s]!.name}` }));
    return options.length ? addModal("Watch a symbol", [{ name: "symbol", label: "Which symbol", options }], write("watchlist", "add", "/symbols/-"), go(path), "Watch", v.said) : "";
  }
  const at = what === "confirm" ? v.list.symbols.indexOf(which) : -1;
  if (at < 0) return "";
  return confirmModal(`Stop watching ${which}`, "Its row leaves the board. Undo brings it back.", write("watchlist", "remove", `/symbols/${at}`), go(address(path, "symbol", which)), "Stop watching");
}

/** The desk: the box, or one cell grown into the window; the drawer and the modal over it. */
export function page(v: View): string {
  const at = where(v.ui);
  const symbols = Object.keys(v.market);
  const cells = [
    cell({ key: "board", name: "the board", mark: "board", count: boardCount(v.list), big: true, opens: go("board"), summary: v.list.symbols.length ? "watched, live" : "nothing watched yet", body: v.list.symbols.length ? `<div class="mini sparkline">${boardMount(v.list, v.market)}</div>` : undefined }),
    cell({ key: "market", name: "the market", mark: "market", count: symbols.length, span: 2, opens: go("market"), summary: "every quote, live" }),
    cell({ key: "clock", name: "the clock", mark: "clock", summary: v.clock.city, body: `<div class="mini face">${clockMount(v.clock)}</div>`, thing: { open: go(address("", "clock")), chosen: at.what === "clock" } }),
  ];
  const opened = at.path === "board" ? boardOpen(v) : at.path === "market" ? marketOpen(v) : undefined;
  const desk: Crumb = { label: "The desk", back: go("") };
  const trail = opened ? [desk, { label: `the ${opened.key}` }] : [desk];
  const modal = modals(v);
  const over = openDrawer(v);
  // the page's address goes in the URL, so the back button closes a drawer and a link opens one
  return site(v.ui.page ?? "", layers(boxPage(trail, [], cells, opened), over, modal));
}
