// The ticker, told as stories. See stories.md at the root. The market is one document everyone
// sees; a watchlist and a clock are each session's own. Two things here that chat and the wedding
// did not have: a tick is seen through an applet (the board takes the ops itself; no render
// follows), so "seen" means a fresh render from the tables differs, not that HTML crossed the
// wire; and a tick is a fact -- recorded with undoable = false -- so the undo the harness runs
// after every `does` must find the ledger says so and leave the price where it is.
import { story, type Stories, type Write } from "../../src/stories";

const watch = (symbol: string): Write => ({ doc: "watchlist", ops: [{ op: "add", path: "/symbols/-", value: symbol }] });
const drop = (index: number): Write => ({ doc: "watchlist", ops: [{ op: "remove", path: `/symbols/${index}` }] });
const tick = (symbol: string, price: number): Write => ({ doc: "ticker", ops: [{ op: "replace", path: `/${symbol}/price`, value: price }] });
const city = (tz: string): Write => ({ doc: "clock", ops: [{ op: "replace", path: "/tz", value: tz }] });

export const stories: Stories = {
  cast: {
    ann: [watch("ALPH"), watch("BRVO")],
    bo: [watch("BRVO")],
    feed: [], // the market's author: a session that is nobody, typing ticks as the feed would
    fresh: [], // just arrived: an empty watchlist, the default city
  },
  stories: [
    // ── A watchlist is one person's ──
    story("Ann watches Charlie Metals, and only her board grows", { as: "ann", does: watch("CHRL"), seen: { ann: "watchlist" } }),
    story("Ann drops Alpha, and her board loses a row", { as: "ann", does: drop(0), seen: { ann: "watchlist" } }),
    story("Ann cannot watch a symbol the market does not quote", { as: "ann", cannot: watch("ZZZZ") }),
    story("Ann cannot watch Alpha twice", { as: "ann", cannot: watch("ALPH") }),
    story("Ann cannot drop a row she does not have", { as: "ann", cannot: drop(5) }),

    // ── The market is everyone's, through the applet ──
    story("Bravo ticks, and every board watching it moves; nobody's page is rendered", { as: "feed", does: tick("BRVO", 65.01), seen: { ann: "ticker", bo: "ticker" } }),
    story("Alpha ticks, and Bo, not watching it, notices nothing", { as: "feed", does: tick("ALPH", 190.0), seen: { ann: "ticker" } }),
    story("A tick is a fact: it stays on the ledger and Undo passes over it", { as: "feed", does: tick("BRVO", 63.5), seen: { ann: "ticker", bo: "ticker" } }),
    story("Nobody can invent a symbol from the wire", { as: "feed", cannot: tick("ZZZZ", 1) }),
    story("A price cannot be taken away, only moved", { as: "feed", cannot: { doc: "ticker", ops: [{ op: "remove", path: "/BRVO/price" }] } }),

    // ── A clock is one person's, and nothing crosses the wire but the city ──
    story("Ann sets her clock to Tokyo, and only her clock's face changes", { as: "ann", does: city("Asia/Tokyo"), seen: { ann: "clock" } }),
    story("A newcomer's clock shows the default city until they choose", { as: "fresh", does: city("America/Vancouver"), seen: { fresh: "clock" } }),
    story("Ann cannot set her clock to a city nobody has", { as: "ann", cannot: city("Mars/Olympus") }),
  ],
};
