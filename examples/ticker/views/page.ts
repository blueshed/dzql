// The desk, drawn as the bento mock-up draws a page (examples/bento): a box with three
// compartments -- the board, big, with two readings; the market; the clock, a thing whose drawer
// holds the city -- each growing into the window when opened, the tools on the rail, the page's
// at the bottom right. A row is a symbol: its drawer holds what it is and what it can carry, watch
// or drop. Watching is the plus and a modal; dropping asks in one too.

import { tray, type Tray } from "../../../src/tray";
import type { ClockDocument } from "../documents/clock";
import { ZONES, cityOf, offsetOf } from "../documents/clock";
import type { Ui } from "../documents/desk";
import type { MarketDocument, Quote } from "../documents/market";
import type { WatchlistDocument } from "../documents/watchlist";
import { esc, join, write } from "./html";
import { icon, type IconName } from "./icons";

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

// ───────────────────────────── the tools ─────────────────────────────

interface ToolOptions { icon?: IconName; kind?: "quiet" | "add" | "danger"; write: string; pressed?: boolean; iconOnly?: boolean; submit?: boolean; label?: string }

function tool(text: string, o: ToolOptions): string {
  const word = o.iconOnly ? `<span class="sr-only">${esc(text)}</span>` : esc(text);
  const label = o.label ?? (o.iconOnly ? text : undefined);
  return `<button type="${o.submit ? "submit" : "button"}" class="tool${o.kind ? ` ${o.kind}` : ""}"${label ? ` aria-label="${esc(label)}"` : ""}${o.pressed === undefined ? "" : ` aria-pressed="${o.pressed}"`}${o.write}>${o.icon ? icon(o.icon) : ""}${word}</button>`;
}

/** Undo and redo: one stack, at the bottom right of the window, across beside the trail on the box. There is no leave: nobody signed in. */
const pageTools = (lay: "down" | "across"): string =>
  `<div class="stack page-tools${lay === "across" ? " across" : ""}" aria-label="Tools">${tool("Undo", { icon: "undo", iconOnly: true, write: write("ledger", "remove", "/latest") })}${tool("Redo", { icon: "redo", iconOnly: true, write: write("ledger", "add", "/latest") })}</div>`;

/** The reading switch: the same symbols drawn another way, the current one pressed. */
const readingSwitch = (key: string, current: string, options: [string, IconName][]): string =>
  `<div class="stack" role="radiogroup" aria-label="Read as">${options.map(([value, mark]) => `<button type="button" class="tool" role="radio" aria-checked="${current === value}" aria-pressed="${current === value}" aria-label="${esc(value)}"${write("desk", "replace", `/reading/${key}`, value)}>${icon(mark)}<span class="sr-only">${esc(value)}</span></button>`).join("")}</div>`;

export const matches = (text: string, word: string | undefined): boolean => word === undefined || !word.trim() || text.toLowerCase().includes(word.trim().toLowerCase());

function findControl(key: string, ui: Ui, shown: number, total: number): { tool: string; filter?: string } {
  const word = ui.filter?.[key];
  const open = word !== undefined;
  const hide = !!ui.hide?.[key];
  const button = tool("Find", { icon: "search", iconOnly: true, pressed: open, write: open ? write("desk", "remove", `/filter/${key}`) : write("desk", "replace", `/filter/${key}`, "") });
  if (!open) return { tool: button };
  const eye = tool(hide ? "Show what misses" : "Hide what misses", { icon: hide ? "eye-off" : "eye", iconOnly: true, pressed: hide, write: hide ? write("desk", "remove", `/hide/${key}`) : write("desk", "replace", `/hide/${key}`, true) });
  return { tool: button, filter: `<div class="filter"><form data-write-on="input"><input name="q" type="search" value="${esc(word)}" placeholder="Find" aria-label="Find" autocomplete="off" autofocus${write("desk", "replace", `/filter/${key}`)}></form><span class="tally">${shown} of ${total}</span>${eye}</div>` };
}

// ───────────────────────────── the rows ─────────────────────────────

/** A quote's price and its move since the last tick, as the row's state. */
function priceState(q: Quote): string {
  const change = q.price - q.prev;
  const dir = change > 0 ? "up" : change < 0 ? "down" : "flat";
  return `<span class="price ${dir}">${q.price.toFixed(2)}<small>${change >= 0 ? "+" : ""}${change.toFixed(2)}</small></span>`;
}

interface RowOptions { id: string; tap: string; chosen: boolean; hushed?: boolean; hidden?: boolean; symbol: string; quote: Quote; state?: string }

/** A row of a list: the symbol leads, the name is the words, the price is the state, ✎ its drawer. */
function row(o: RowOptions): string {
  return join(
    `<div class="row tap${o.hushed ? " hushed" : ""}" id="${esc(o.id)}" role="button" tabindex="0" aria-pressed="${o.chosen}"${o.chosen ? " data-reveal" : ""}${o.hidden ? " hidden" : ""}${o.tap}>`,
    `<span class="lead symbol">${esc(o.symbol)}</span>`,
    `<span class="words"><span class="what">${esc(o.quote.name)}</span>${o.state ? `<span class="note">${esc(o.state)}</span>` : ""}</span>`,
    `<span class="state">${priceState(o.quote)}</span>`,
    `<span class="mark">${icon("pencil", 16)}</span>`,
    "</div>",
  );
}

const rows = (items: string[], empty: string): string => (items.length ? `<div class="rows">${items.join("")}</div>` : `<p class="note">${esc(empty)}</p>`);

/** The board as a list: a row per watched symbol. Replaced alone on a tick, when it is open. */
export function boardList(v: View): string {
  const items = v.list.symbols.filter((s) => v.market[s]).map((s) => row({ id: `b-${s}`, tap: write("desk", "replace", "/focus", s), chosen: v.ui.focus === s, symbol: s, quote: v.market[s]! }));
  return `<div id="board-list">${rows(items, "Nothing watched yet. The plus asks which symbol.")}</div>`;
}

/** The market as a list: every quote, watched ones said so; find dims what the word misses. Replaced alone on a tick, when it is open. */
export function marketRows(v: View): string {
  const word = v.ui.filter?.market;
  const hide = v.ui.hide?.market;
  const items = Object.entries(v.market).map(([s, q]) => {
    const miss = !matches(`${s} ${q.name}`, word);
    return row({ id: `m-${s}`, tap: write("desk", "replace", "/focus", s), chosen: v.ui.focus === s, hushed: miss, hidden: miss && hide, symbol: s, quote: q, state: v.list.symbols.includes(s) ? "watching" : undefined });
  });
  return `<div id="market-rows">${rows(items, "The market is closed.")}</div>`;
}

// ───────────────────────────── the page ─────────────────────────────

const COLUMNS = 3;
interface Cell { key: string; name: string; mark: IconName; count?: string; summary?: string; body?: string; big?: boolean; span?: number; opens?: boolean; thing?: { open: string; chosen: boolean } }

function cellHtml(c: Cell, wide: Tray, narrow: Tray): string {
  const corners = (t: Tray) => t.cells.find((p) => p.key === c.key)!.corners.join(" ");
  const opens = c.opens ? ` role="button" tabindex="0" data-moving="${c.key}"${write("desk", "replace", "/open", c.key)}` : c.thing ? ` role="button" tabindex="0" aria-pressed="${c.thing.chosen}"${c.thing.open}` : "";
  const chev = c.opens ? `<span class="chev">${icon("chevron-right", 18)}</span>` : c.thing ? `<span class="chev pencil">${icon("pencil", 16)}</span>` : "";
  return join(
    `<div class="cell${c.big ? " big" : ""}${c.thing ? " thing" : ""}" data-key="${c.key}" data-corners="${corners(wide)}" data-corners-phone="${corners(narrow)}" style="grid-area: ${c.key}"${opens}>`,
    `<div class="cell-head cap"><span class="cell-icon">${icon(c.mark, 18)}</span><span class="cell-name">${esc(c.name)}${c.count !== undefined ? ` · ${c.count}` : ""}</span>${chev}</div>`,
    c.summary && `<p class="cell-summary">${esc(c.summary)}</p>`,
    c.body && `<div class="cell-body">${c.body}</div>`,
    "</div>",
  );
}

interface Open { key: string; name: string; reading?: string; tools?: string[]; filter?: string; body: string; note?: string }

function windowHtml(o: Open): string {
  return join(
    `<div class="cell open" data-key="${o.key}" data-moving="${o.key}">`,
    `<div class="cell-head cap"><a class="cell-back" href="#"${write("desk", "remove", "/open")}>The desk</a><span class="chev">${icon("chevron-right", 14)}</span><span class="cell-name">${esc(o.name)}</span></div>`,
    `<div class="rail work">${o.reading ?? ""}${o.tools && o.tools.length > 0 ? `<div class="stack">${o.tools.join("")}</div>` : ""}</div>`,
    o.filter,
    `<div class="full">${o.body}${o.note ? `<p class="note">${esc(o.note)}</p>` : ""}</div>`,
    pageTools("down"),
    "</div>",
  );
}

export const reading = (ui: Ui): string => ui.reading?.board ?? "sparkline";

function boardOpen(v: View): Open {
  const list = reading(v.ui) === "list";
  return {
    key: "board",
    name: "the board",
    reading: readingSwitch("board", reading(v.ui), [["sparkline", "board"], ["list", "list"]]),
    tools: [tool("Watch a symbol", { icon: "plus", iconOnly: true, write: write("desk", "replace", "/new", "board") })],
    body: list ? boardList(v) : `<div class="reading sparkline">${boardMount(v.list, v.market)}</div>`,
  };
}

function marketOpen(v: View): Open {
  const word = v.ui.filter?.market;
  const symbols = Object.keys(v.market);
  const find = findControl("market", v.ui, symbols.filter((s) => matches(`${s} ${v.market[s]!.name}`, word)).length, symbols.length);
  return { key: "market", name: "the market", tools: [find.tool], filter: find.filter, body: marketRows(v), note: "A tick is replace /SYMBOL/price; type one from the CLI and watch it land." };
}

/** The drawer: a symbol's properties and what it carries -- watch, or drop -- or the clock's city. */
function sheet(v: View): string {
  const who = v.ui.focus;
  if (!who) return "";
  const close = write("desk", "remove", "/focus");
  const shell = (title: string, body: string, foot?: string) =>
    join(
      `<div class="scrim"${close}></div>`,
      `<div class="sheet" role="dialog" aria-label="${esc(title)}">`,
      `<div class="sheet-head"><h2>${esc(title)}</h2><button type="button" class="tool quiet sheet-close" aria-label="Close"${close}>${icon("x", 18)}</button></div>`,
      `<div class="sheet-body"><div class="props">${body}</div>${foot ? `<div class="sheet-foot">${foot}</div>` : ""}</div></div>`,
    );
  const prop = (name: string, value: string) => `<div class="prop"><span class="prop-name cap">${esc(name)}</span><div class="prop-value">${value}</div></div>`;
  if (who === "clock") return shell("The clock", prop("City", cityMount(v.clock)) + prop("Now", `<span>${esc(v.clock.city)} (UTC${esc(v.clock.offset)})</span>`));
  const q = v.market[who];
  if (!q) return "";
  const at = v.list.symbols.indexOf(who);
  const carry =
    at >= 0
      ? tool("Stop watching", { icon: "trash", kind: "danger", write: write("desk", "replace", "/confirm", who) })
      : tool("Watch", { icon: "plus", kind: "add", write: write("watchlist", "add", "/symbols/-", who) });
  return shell(who, prop("Name", `<span>${esc(q.name)}</span>`) + prop("Price", priceState(q)) + prop("Watched", `<span>${at >= 0 ? "yes" : "no"}</span>`), carry);
}

/** The modals: which symbol to watch; whether to stop watching one. One question each. */
function modals(v: View): string {
  if (v.ui.new === "board") {
    const close = write("desk", "remove", "/new");
    return join(
      `<div class="scrim modal-scrim"${close}></div>`,
      `<dialog open class="modal" aria-label="Watch a symbol"><h3>Watch a symbol</h3>`,
      `<form${write("watchlist", "add", "/symbols/-")}><label class="modal-field"><span class="note">Which symbol</span><input name="symbol" placeholder="e.g. ALPH" autocomplete="off" autocapitalize="characters" required autofocus maxlength="6"></label>`,
      `<div class="modal-foot">${tool("Cancel", { kind: "quiet", write: close })}${tool("Watch", { icon: "plus", kind: "add", write: "", submit: true })}</div></form></dialog>`,
    );
  }
  if (v.ui.confirm) {
    const close = write("desk", "remove", "/confirm");
    const at = v.list.symbols.indexOf(v.ui.confirm);
    if (at < 0) return "";
    return join(
      `<div class="scrim modal-scrim"${close}></div>`,
      `<dialog open class="modal" aria-label="Stop watching"><h3>Stop watching ${esc(v.ui.confirm)}</h3><p class="note">Its row leaves the board. Undo brings it back.</p>`,
      `<div class="modal-foot">${tool("Cancel", { kind: "quiet", write: close })}${tool("Stop watching", { icon: "trash", kind: "danger", write: write("watchlist", "remove", `/symbols/${at}`) })}</div></dialog>`,
    );
  }
  return "";
}

/** The desk: the box, or one compartment grown into the window; the drawer and the modal over it. */
export function page(v: View): string {
  const symbols = Object.keys(v.market);
  const cells: Cell[] = [
    { key: "board", name: "the board", mark: "board", count: boardCount(v.list), big: true, opens: true, summary: v.list.symbols.length ? "watched, live" : "nothing watched yet", body: `<div class="mini sparkline">${boardMount(v.list, v.market)}</div>` },
    { key: "market", name: "the market", mark: "market", count: String(symbols.length), span: 2, opens: true, summary: `${symbols.length} symbols, every quote` },
    { key: "clock", name: "the clock", mark: "clock", summary: v.clock.city, body: `<div class="mini face">${clockMount(v.clock)}</div>`, thing: { open: write("desk", "replace", "/focus", "clock"), chosen: v.ui.focus === "clock" } },
  ];
  const spec = cells.map((c) => ({ key: c.key, span: c.big ? COLUMNS : (c.span ?? 1) }));
  const wide = tray(spec, COLUMNS);
  const narrow = tray(spec, 1);
  const opened = v.ui.open === "board" ? boardOpen(v) : v.ui.open === "market" ? marketOpen(v) : undefined;
  const placed = cells.map((c) => (opened && c.key === opened.key ? windowHtml(opened) : cellHtml(c, wide, narrow)));
  const areas = (t: Tray) => t.areas.replace(/\n/g, " ");
  const modal = modals(v);
  const body = join(
    `<header class="page-head"><nav class="crumbs cap" aria-label="Where you are"><span class="crumb"><b aria-current="page">The desk</b></span></nav>${opened ? "" : pageTools("across")}</header>`,
    `<section class="page box${opened ? " windowed" : ""}"><div class="cells" style='--tray-areas: ${areas(wide)}; --tray-areas-phone: ${areas(narrow)}'>${placed.join("")}</div></section>`,
    sheet(v),
  );
  return join(`<div class="site${modal || v.ui.focus ? " locked" : ""}">`, modal ? `<div inert>${body}</div>` : body, modal, "</div>");
}
