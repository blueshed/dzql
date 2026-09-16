// The ticker, told as stories. See stories.md at the root. The market is one document everyone
// sees; a watchlist and a clock are each session's own. Two things here that chat and the wedding
// did not have: a tick is seen through an applet (the board takes the ops itself; no render
// follows), so "seen" means a fresh render from the tables differs, not that HTML crossed the
// wire; and a tick is a fact -- recorded with undoable = false -- so the undo the harness runs
// after every `does` must find the ledger says so and leave the price where it is. One page, so
// `seen` lists who notices.
import type { PatchOp } from "../../src/json-patch";
import { story, type Stories, type Write } from "../../src/stories";

const watch = (symbol: string): Write => ({ doc: "watchlist", ops: [{ op: "add", path: "/symbols/-", value: symbol }] });
const drop = (index: number): Write => ({ doc: "watchlist", ops: [{ op: "remove", path: `/symbols/${index}` }] });
const tick = (symbol: string, price: number): Write => ({ doc: "ticker", ops: [{ op: "replace", path: `/${symbol}/price`, value: price }] });
const city = (tz: string): Write => ({ doc: "clock", ops: [{ op: "replace", path: "/tz", value: tz }] });

/** "@ key=value, ..." as one desk write: what the tray holds -- `open=board`, `reading.board=list`, `focus=BRVO`. One page, so no page. */
function at(where: string): Write {
  const rest = where.replace(/^\s*@\s*/, "");
  const ops: PatchOp[] = [];
  for (const pair of rest ? rest.split(", ") : []) {
    const [key, raw] = pair.split("=") as [string, string];
    ops.push({ op: "replace", path: `/${key.split(".").join("/")}`, value: raw === "true" ? true : raw });
  }
  return { doc: "desk", ops };
}

export const stories: Stories = {
  cast: {
    ann: [watch("ALPH"), watch("BRVO")],
    bo: [watch("BRVO")],
    feed: [], // the market's author: a session that is nobody, typing ticks as the feed would
    fresh: [], // just arrived: an empty watchlist, the default city
  },
  at,
  stories: [
    // ── A watchlist is one person's ──
    story("Ann watches Charlie Metals, and only her board grows", { as: "ann", does: watch("CHRL"), seen: ["ann"] }),
    story("Ann drops Alpha, and her board loses a row", { as: "ann", does: drop(0), seen: ["ann"] }),
    story("Ann cannot watch a symbol the market does not quote", { as: "ann", cannot: watch("ZZZZ") }),
    story("Ann cannot watch Alpha twice", { as: "ann", cannot: watch("ALPH") }),
    story("Ann cannot drop a row she does not have", { as: "ann", cannot: drop(5) }),

    // ── The market is everyone's, through the applet ──
    story("Bravo ticks, and every board watching it moves; nobody's page is rendered", { as: "feed", does: tick("BRVO", 65.01), seen: ["ann", "bo"] }),
    story("Alpha ticks, and Bo, not watching it, notices nothing", { as: "feed", does: tick("ALPH", 190.0), seen: ["ann"] }),
    story("A tick is a fact: it stays on the ledger and Undo passes over it", { as: "feed", does: tick("BRVO", 63.5), seen: ["ann", "bo"] }),
    story("Nobody can invent a symbol from the wire", { as: "feed", cannot: tick("ZZZZ", 1) }),
    story("A price cannot be taken away, only moved", { as: "feed", cannot: { doc: "ticker", ops: [{ op: "remove", path: "/BRVO/price" }] } }),

    // ── A clock is one person's, and nothing crosses the wire but the city ──
    story("Ann sets her clock to Tokyo, and only her clock's face changes", { as: "ann", does: city("Asia/Tokyo"), seen: ["ann"] }),
    story("A newcomer's clock shows the default city until they choose", { as: "fresh", does: city("America/Vancouver"), seen: ["fresh"] }),
    story("Ann cannot set her clock to a city nobody has", { as: "ann", cannot: city("Mars/Olympus") }),

    // ── The desk as a box: the board's two readings, find on the market, the drawers, the modals ──
    story("Ann opens the board, and only her page shows the window", { as: "ann", does: at("@ open=board"), seen: ["ann"] }),
    story("Ann reads her board as a list, and only her page changes", { as: "ann", does: at("@ open=board, reading.board=list"), seen: { ann: "@ open=board" } }),
    story("Bravo ticks, and Ann, reading her board as a list, sees the row move", { as: "feed", does: tick("BRVO", 66.6), seen: { ann: "@ open=board, reading.board=list", bo: "@ open=market" } }),
    story("Ann finds CH in the market; Charlie Metals stays lit, the rest dim, the tally says one of all", { as: "ann", does: at("@ open=market, filter.market=CH"), seen: { ann: "@ open=market" } }),
    story("Ann presses the eye, and the symbols that miss are gone from the list", { as: "ann", does: at("@ open=market, filter.market=CH, hide.market=true"), seen: { ann: "@ open=market, filter.market=CH" } }),
    story("Ann asks to watch, and the modal asks which symbol", { as: "ann", does: at("@ open=board, new=board"), seen: { ann: "@ open=board" } }),
    story("Ann opens Bravo's row; her board shows it chosen and its drawer opens", { as: "ann", does: at("@ open=board, reading.board=list, focus=BRVO"), seen: { ann: "@ open=board, reading.board=list" } }),
    story("Ann asks to stop watching Bravo, and the modal asks first", { as: "ann", does: at("@ open=board, reading.board=list, focus=BRVO, confirm=BRVO"), seen: { ann: "@ open=board, reading.board=list, focus=BRVO" } }),
    story("Ann opens the clock, and its drawer offers the city", { as: "ann", does: at("@ focus=clock"), seen: ["ann"] }),
    story("Nobody can open a compartment the desk does not have", { as: "ann", cannot: at("@ open=attic") }),
  ],
};
