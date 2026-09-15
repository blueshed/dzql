import type { ClockDocument } from "../documents/clock";
import { ZONES, cityOf, offsetOf } from "../documents/clock";
import type { MarketDocument } from "../documents/market";
import type { WatchlistDocument } from "../documents/watchlist";

// The one page: the clock with its city (a form to choose another, the browser's own typeahead
// over every zone), the watchlist (a form to add, a row per symbol with its remove, Undo and
// Redo), and the board (an applet: given the market once, kept current by the market's own
// patches). HTML is the only vocabulary; every gesture is a data-write.

const esc = (s: string) => s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");

/** The board applet's mount: the watched symbols and every quote they need, keyed so a watchlist change replaces just this. */
export function boardMount(list: WatchlistDocument, market: MarketDocument): string {
  const quotes = Object.fromEntries(list.symbols.filter((s) => market[s]).map((s) => [s, market[s]!]));
  const props = JSON.stringify({ symbols: list.symbols.filter((s) => market[s]), quotes });
  return `<div id="board" data-applet="board" data-doc="ticker" data-props="${esc(props)}"></div>`;
}

// Every zone as "City, Area (UTC+02:00)", for the datalist. Offsets move with the clocks twice a
// year, so the list is rebuilt when a minute has passed, not on every render.
let zoneOptions = "";
let zoneOptionsAt = 0;
export function zoneDatalist(now = Date.now()): string {
  if (now - zoneOptionsAt > 60_000) {
    zoneOptions = ZONES.map((tz) => {
      const area = tz.includes("/") ? tz.slice(0, tz.indexOf("/")).replaceAll("_", " ") : "";
      return `<option value="${esc(tz)}">${esc(cityOf(tz))}${area ? `, ${esc(area)}` : ""} (UTC${offsetOf(tz, new Date(now))})</option>`;
    }).join("");
    zoneOptionsAt = now;
  }
  return `<datalist id="zones">${zoneOptions}</datalist>`;
}

export function clockSection(c: ClockDocument): string {
  return (
    `<section class="clock-section">` +
    `<div id="clock" data-applet="clock" data-doc="clock" data-props="${esc(JSON.stringify({ tz: c.tz }))}"></div>` +
    `<form class="city" data-write='{"doc":"clock","op":"replace","path":"/tz"}'>` +
    `<input name="tz" list="zones" placeholder="${esc(c.city)}" aria-label="Show the time in" autocomplete="off" required>` +
    `<button type="submit">Show</button></form>` +
    zoneDatalist() +
    `</section>`
  );
}

export function watchlistSection(list: WatchlistDocument): string {
  const rows = list.symbols
    .map(
      (symbol, i) =>
        `<li><span class="symbol">${esc(symbol)}</span><button type="button" class="drop" aria-label="Stop watching ${esc(symbol)}" data-write='{"doc":"watchlist","op":"remove","path":"/symbols/${i}"}'>×</button></li>`,
    )
    .join("");
  return (
    `<section id="watchlist" class="watchlist">` +
    `<h2>Watching</h2>` +
    `<ul>${rows}</ul>` +
    `<form data-write='{"doc":"watchlist","op":"add","path":"/symbols/-"}'>` +
    `<input name="symbol" placeholder="Symbol" autocomplete="off" autocapitalize="characters" required maxlength="6">` +
    `<button type="submit">Watch</button></form>` +
    `<p class="tools">` +
    `<button type="button" data-write='{"doc":"ledger","op":"remove","path":"/latest"}'>Undo</button>` +
    `<button type="button" data-write='{"doc":"ledger","op":"add","path":"/latest"}'>Redo</button>` +
    `</p>` +
    `</section>`
  );
}

export function page(list: WatchlistDocument, market: MarketDocument, c: ClockDocument): string {
  const all = Object.keys(market).join(" · ");
  return (
    `<header><h1>The board</h1>${clockSection(c)}</header>` +
    watchlistSection(list) +
    `<section class="market"><h2>The market</h2>${boardMount(list, market)}<p class="note">Symbols: ${esc(all)}. A tick is <code>replace /SYMBOL/price</code>; type one from the CLI and watch it land.</p></section>`
  );
}
