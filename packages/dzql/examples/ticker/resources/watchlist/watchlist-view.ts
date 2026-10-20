import { address, rows, type OpenOptions, type Placeable } from "dzql/rendering/bento";
import { esc, write } from "dzql/rendering/html";
import { part } from "dzql/rendering/parts";
import { surfaces } from "../../surfaces";
import type { View } from "../../page";
import { reading, where, type Ui } from "../desk/desk-api";
import { quote, quoteDoc } from "../quote/quote-api";
import type { MarketDocument } from "../ticker/ticker-api";
import { symbolRow } from "../ticker/ticker-view";
import type { WatchlistDocument } from "./watchlist-api";

// The watchlist's part of the page: the board, big, with two readings, its rows applets on each
// symbol's own document; watching is the plus and a modal, and dropping asks in one too.

const { readingSwitch, addTool, cell, addModal, confirmModal, go, readAs } = surfaces;

/** What the board says with nothing on it: once, where the plus that fills it is. */
const NOTHING_WATCHED = "Nothing watched yet. The plus asks which symbol.";

/**
 * The board: a row per watched symbol, each an applet on that symbol's own document, so a board is
 * told only the symbols it watches and each row takes its own ticks. Empty, the window says so; the
 * box's cell has said it already. On the box the cell is the one tap. In the window (`ui`), a row is
 * a figure, as a list's is: a button over the whole line opens its drawer, from a finger
 * or the keyboard, and says it is expanded while that is open. The button is named by the
 * line it lies over, which a reader then hears once, as the button. It is beside the applet's
 * mount, not around it, so the mount stands in the same place on the box and in the window and
 * keeps the ticks it has seen as the cell opens; and it is a part, so opening a drawer sends its
 * tag alone, never the mount's, whose props follow the patches (src/rendering/parts.ts).
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
    `<div id="line-${esc(symbol)}" data-applet="board" data-doc="${esc(quoteDoc(symbol))}" data-under="/quote"${ui ? ' aria-hidden="true"' : ""} data-props="${esc(JSON.stringify({ symbol, quote: quote(symbol) }))}"></div>`;
  const rowOf = (symbol: string) => part(`quote-${symbol}`, `<div id="quote-${esc(symbol)}" class="board-row">${line(symbol)}${tap(symbol)}</div>`);
  return `<div id="board" class="board">${symbols.map(rowOf).join("")}</div>`;
}

/** How many are watched, on the board's head -- nothing while none are, which the summary says; replaced with the board when the list changes. */
export const boardCount = (list: WatchlistDocument): string | null => (list.symbols.length ? `<span id="board-count">${list.symbols.length}</span>` : null);

/** The board as a list: a row per watched symbol, each a part, so a tick sends the row it moved. */
function boardList(v: View): string {
  const items = v.list.symbols.filter((s) => v.market[s]).map((s) => symbolRow(`b-${s}`, s, v.market[s]!, v.ui));
  return part("board-list", `<div id="board-list">${rows(items, NOTHING_WATCHED)}</div>`);
}

/** The symbols the board lacks: what the plus may offer. */
const unwatched = (v: View): string[] => Object.keys(v.market).filter((s) => !v.list.symbols.includes(s));

/** The board on the box: big, its sparklines live. */
export const boardCell = (list: WatchlistDocument, market: MarketDocument): Placeable =>
  cell({ key: "board", name: "the board", mark: "board", count: boardCount(list), big: true, opens: go("board"), summary: list.symbols.length ? "watched, live" : "nothing watched yet", body: list.symbols.length ? `<div class="mini sparkline">${boardMount(list, market)}</div>` : undefined });

/** The board in the window: its two readings, and the plus while there is something left to watch; once there is not, the note says so in its place. */
export function boardOpen(v: View): OpenOptions {
  const left = unwatched(v).length > 0;
  return {
    key: "board",
    reading: readingSwitch((["sparkline", "list"] as const).map((r) => [r, r === "sparkline" ? "board" : "list", reading(v.ui) === r, readAs("board", r)])),
    tools: left ? [addTool(go(address("board", "new")), "Watch a symbol")] : [],
    body: reading(v.ui) === "list" ? boardList(v) : `<div class="reading sparkline">${boardMount(v.list, v.market, v.ui)}</div>`,
    note: left ? null : "Everything is watched.",
  };
}

/**
 * The modals: which symbol to watch -- chosen from those the board lacks, so the ask sends only what
 * can be; a write that cannot be (from the wire, the CLI) is refused, and while the ask is open it
 * says why beneath its field; with nothing left there is no ask -- and whether to stop watching
 * one. One question each; cancelling goes back to where it was asked from.
 */
export function modals(v: View): string {
  const { path, what, which = "" } = where(v.ui);
  if (what === "new") {
    const options = unwatched(v).map((s) => ({ value: s, text: `${s} · ${v.market[s]!.name}` }));
    return options.length ? addModal("Watch a symbol", [{ name: "symbol", label: "Which symbol", options }], write("watchlist", "add", "/symbols/-"), go(path), "Watch", v.said) : "";
  }
  const at = what === "confirm" ? v.list.symbols.indexOf(which) : -1;
  if (at < 0) return "";
  return confirmModal(`Stop watching ${which}`, "Its row leaves the board. Undo brings it back.", write("watchlist", "remove", `/symbols/${at}`), go(address(path, "symbol", which)), "Stop watching");
}
