// The desk, drawn as the bento mock-up draws a page (examples/bento): a box with three
// compartments -- the board, big, with two readings; the market; the clock, a thing whose drawer
// holds the city -- each growing into the window when opened, the tools on the rail, the page's
// at the bottom right. A row is a symbol: its drawer holds what it is and what it can carry, watch
// or drop. Watching is the plus and a modal; dropping asks in one too.

import { bento, inertWhile, matches, prop, rows, type Crumb, type OpenOptions } from "../../../src/bento";
import { esc, write } from "../../../src/html";
import type { ClockDocument } from "../documents/clock";
import { ZONES, cityOf, offsetOf } from "../documents/clock";
import type { Ui } from "../documents/desk";
import type { MarketDocument, Quote } from "../documents/market";
import type { WatchlistDocument } from "../documents/watchlist";
import { icon } from "./icons";

const { tool, readingSwitch, addTool, findControl, cell, boxPage, row, sheet, addModal, confirmModal } = bento({ icon, tray: "desk" });

export type View = { list: WatchlistDocument; market: MarketDocument; clock: ClockDocument; ui: Ui };

// ───────────────────────────── the applets' mounts ─────────────────────────────

/** The board applet's mount: the watched symbols and every quote they need, keyed so a watchlist change replaces just this. */
export function boardMount(list: WatchlistDocument, market: MarketDocument): string {
  const symbols = list.symbols.filter((s) => market[s]);
  const quotes = Object.fromEntries(symbols.map((s) => [s, market[s]!]));
  return `<div id="board" data-applet="board" data-doc="ticker" data-props="${esc(JSON.stringify({ symbols, quotes }))}"></div>`;
}

/** How many are watched, on the board's head; replaced with the board when the list changes. */
export const boardCount = (list: WatchlistDocument): string => `<span id="board-count">${list.symbols.length}</span>`;

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

const clockMount = (c: ClockDocument): string => `<div id="clock" data-applet="clock" data-doc="clock" data-props="${esc(JSON.stringify({ tz: c.tz }))}"></div>`;
// the picker's zones are its children, HTML the server wrote; the applet reads them once and draws its own field
const cityMount = (c: ClockDocument): string => `<div id="city" class="city" data-applet="city-picker" data-doc="clock" data-props="${esc(JSON.stringify({ city: c.city }))}"><datalist>${zoneOptionsHtml()}</datalist></div>`;

// ───────────────────────────── the rows ─────────────────────────────

/** A quote's price and its move since the last tick, as the row's state. */
function priceState(q: Quote): string {
  const change = q.price - q.prev;
  const dir = change > 0 ? "up" : change < 0 ? "down" : "flat";
  return `<span class="price ${dir}">${q.price.toFixed(2)}<small>${change >= 0 ? "+" : ""}${change.toFixed(2)}</small></span>`;
}

/** A row of a list: the symbol leads, the name is the words, the price is the state, ✎ its drawer. */
const symbolRow = (id: string, symbol: string, quote: Quote, ui: Ui, o: { hushed?: boolean; hidden?: boolean; note?: string } = {}): string =>
  row({ id, tap: write("desk", "replace", "/focus", symbol), chosen: ui.focus === symbol, lead: `<span class="symbol">${esc(symbol)}</span>`, what: quote.name, state: priceState(quote), mark: "pencil", ...o });

/** The board as a list: a row per watched symbol. Replaced alone on a tick, when it is open. */
export function boardList(v: View): string {
  const items = v.list.symbols.filter((s) => v.market[s]).map((s) => symbolRow(`b-${s}`, s, v.market[s]!, v.ui));
  return `<div id="board-list">${rows(items, "Nothing watched yet. The plus asks which symbol.")}</div>`;
}

/** The market as a list: every quote, watched ones said so; find dims what the word misses. Replaced alone on a tick, when it is open. */
export function marketRows(v: View): string {
  const word = v.ui.filter?.market;
  const items = Object.entries(v.market).map(([s, q]) => {
    const miss = !matches(`${s} ${q.name}`, word);
    return symbolRow(`m-${s}`, s, q, v.ui, { hushed: miss, hidden: miss && v.ui.hide?.market, note: v.list.symbols.includes(s) ? "watching" : undefined });
  });
  return `<div id="market-rows">${rows(items, "The market is closed.")}</div>`;
}

// ───────────────────────────── the page ─────────────────────────────

export const reading = (ui: Ui): string => ui.reading?.board ?? "sparkline";

function boardOpen(v: View): OpenOptions {
  return {
    key: "board",
    reading: readingSwitch("board", reading(v.ui), [["sparkline", "board"], ["list", "list"]]),
    tools: [addTool("board", "Watch a symbol")],
    body: reading(v.ui) === "list" ? boardList(v) : `<div class="reading sparkline">${boardMount(v.list, v.market)}</div>`,
  };
}

function marketOpen(v: View): OpenOptions {
  const word = v.ui.filter?.market;
  const symbols = Object.keys(v.market);
  const find = findControl("market", { word, hide: v.ui.hide?.market, shown: symbols.filter((s) => matches(`${s} ${v.market[s]!.name}`, word)).length, total: symbols.length });
  return { key: "market", tools: [find.tool], filter: find.filter, body: marketRows(v), note: "A tick is replace /SYMBOL/price; type one from the CLI and watch it land." };
}

/** The drawer: a symbol's properties and what it carries -- watch, or drop -- or the clock's city. */
function drawer(v: View): string {
  const who = v.ui.focus;
  if (!who) return "";
  const close = write("desk", "remove", "/focus");
  if (who === "clock") return sheet("drawer", "The clock", `<div class="props">${prop("City", cityMount(v.clock))}${prop("Now", `<span>${esc(v.clock.city)} (UTC${esc(v.clock.offset)})</span>`)}</div>`, close);
  const q = v.market[who];
  if (!q) return "";
  const watched = v.list.symbols.includes(who);
  const carry = watched
    ? tool("Stop watching", { icon: "trash", kind: "danger", write: write("desk", "replace", "/confirm", who) })
    : tool("Watch", { icon: "plus", kind: "add", write: write("watchlist", "add", "/symbols/-", who) });
  const props = prop("Name", `<span>${esc(q.name)}</span>`) + prop("Price", priceState(q)) + prop("Watched", `<span>${watched ? "yes" : "no"}</span>`);
  return sheet("drawer", who, `<div class="props">${props}</div><div class="sheet-foot">${carry}</div>`, close);
}

/** The modals: which symbol to watch; whether to stop watching one. One question each. */
function modals(v: View): string {
  if (v.ui.new === "board") return addModal("Watch a symbol", [{ name: "symbol", label: "Which symbol", placeholder: "e.g. ALPH" }], write("watchlist", "add", "/symbols/-"), "Watch");
  const at = v.ui.confirm ? v.list.symbols.indexOf(v.ui.confirm) : -1;
  if (at < 0) return "";
  return confirmModal(`Stop watching ${v.ui.confirm}`, "Its row leaves the board. Undo brings it back.", write("watchlist", "remove", `/symbols/${at}`), "Stop watching");
}

/** The desk: the box, or one compartment grown into the window; the drawer and the modal over it. */
export function page(v: View): string {
  const symbols = Object.keys(v.market);
  const opens = (key: string) => write("desk", "replace", "/open", key);
  const cells = [
    cell({ key: "board", name: "the board", mark: "board", count: boardCount(v.list), big: true, opens: opens("board"), summary: v.list.symbols.length ? "watched, live" : "nothing watched yet", body: `<div class="mini sparkline">${boardMount(v.list, v.market)}</div>` }),
    cell({ key: "market", name: "the market", mark: "market", count: symbols.length, span: 2, opens: opens("market"), summary: `${symbols.length} symbols, every quote` }),
    cell({ key: "clock", name: "the clock", mark: "clock", summary: v.clock.city, body: `<div class="mini face">${clockMount(v.clock)}</div>`, thing: { open: write("desk", "replace", "/focus", "clock"), chosen: v.ui.focus === "clock" } }),
  ];
  const opened = v.ui.open === "board" ? boardOpen(v) : v.ui.open === "market" ? marketOpen(v) : undefined;
  const desk: Crumb = { label: "The desk", back: write("desk", "remove", "/open") };
  const trail = opened ? [desk, { label: `the ${opened.key}` }] : [desk];
  const modal = modals(v);
  const body = boxPage(trail, [], cells, opened) + drawer(v);
  return `<div class="site${modal || v.ui.focus ? " locked" : ""}">${inertWhile(!!modal, body)}${modal}</div>`;
}
