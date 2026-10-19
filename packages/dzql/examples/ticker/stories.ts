// The ticker, told as stories. See docs/stories.md. The market is one document everyone
// sees; a watchlist and a clock are each session's own. Two things here that chat and the wedding
// did not have: a tick is seen through an applet (the board takes the ops itself; no render
// follows), so "seen" means a fresh render from the tables differs, not that HTML crossed the
// wire; and a tick is never undone -- recorded with undoable = false -- so the undo the harness runs
// after every `does` must find the ledger says so and leave the price where it is. Whoever a story
// does not say sees it must not: Bo, on his board, watches only Bravo, and his board is told only
// the quotes it shows (a row per symbol, each on `quote:<id>`).
import { goTo as goToOn, story, type Stories, type Write } from "dzql/modelling/stories";

const watch = (symbol: string): Write => ({ doc: "watchlist", ops: [{ op: "add", path: "/symbols/-", value: symbol }] });
const drop = (index: number): Write => ({ doc: "watchlist", ops: [{ op: "remove", path: `/symbols/${index}` }] });
const tick = (symbol: string, price: number): Write => ({ doc: "ticker", ops: [{ op: "replace", path: `/${symbol}/price`, value: price }] });
const city = (tz: string): Write => ({ doc: "clock", ops: [{ op: "replace", path: "/tz", value: tz }] });

/** Where someone stands, as one write to the desk (`goTo`, src/stories.ts). */
const goTo = goToOn("desk");

export const stories: Stories = {
  cast: {
    ann: [watch("ALPH"), watch("BRVO")],
    bo: [watch("BRVO"), goTo("board")], // on his board, where only what he watches moves
    feed: [goTo("board")], // the market's author: a session that is nobody, typing ticks as the feed would, its own board empty
    fresh: [goTo("board")], // just arrived: an empty watchlist, the default city
  },
  goTo,
  stories: [
    // ── A watchlist is one person's ──
    story("Ann watches Charlie Metals, and only her board grows", { as: "ann", from: "board?new", does: watch("CHRL"), seen: ["ann"] }),
    story("Ann, on her board, watches Charlie Metals, and it joins the board in front of her", { as: "ann", from: "board?new", does: watch("CHRL"), seen: { ann: "board" } }),
    story("Ann drops Alpha, and her board loses a row", { as: "ann", from: "market?confirm=ALPH", does: drop(0), seen: ["ann"] }),
    story("Ann cannot watch a symbol the market does not quote, and is told so", { as: "ann", from: "board?new", cannot: watch("ZZZZ"), told: "The market does not quote ZZZZ." }),
    story("Ann cannot watch Alpha twice, and is told it is on her board", { as: "ann", from: "board?new", cannot: watch("ALPH"), told: "ALPH is on your board already." }),
    story("Ann cannot drop a row she does not have", { as: "ann", cannot: drop(5) }),

    // ── The market is everyone's, through the applet ──
    story("Bravo ticks, and every board watching it moves; nobody's page is rendered", { as: "feed", offPage: true, does: tick("BRVO", 65.01), seen: ["ann", "bo"] }),
    story("Alpha ticks, and Bo, not watching it, notices nothing", { as: "feed", offPage: true, does: tick("ALPH", 190.0), seen: ["ann"] }),
    story("A tick is never undone: it stays on the ledger and Undo passes over it", { as: "feed", offPage: true, does: tick("BRVO", 63.5), seen: ["ann", "bo"] }),
    story("Nobody can invent a symbol from the wire", { as: "feed", cannot: tick("ZZZZ", 1) }),
    story("A price cannot be taken away, only moved", { as: "feed", cannot: { doc: "ticker", ops: [{ op: "remove", path: "/BRVO/price" }] } }),

    // ── A clock is one person's, and nothing crosses the wire but the city ──
    story("Ann sets her clock to Tokyo, and only her clock's face changes", { as: "ann", from: "?clock", does: city("Asia/Tokyo"), seen: ["ann"] }),
    story("A newcomer's clock shows the default city until they choose", { as: "fresh", from: "?clock", does: city("America/Vancouver"), seen: ["fresh"] }),
    story("Ann cannot set her clock to a city nobody has", { as: "ann", from: "?clock", cannot: city("Mars/Olympus") }),

    // ── Where you stand decides what you see ──
    story("Bravo ticks; Ann, reading her board as a list, and Bo, in the market, each see the row move", { as: "feed", offPage: true, does: tick("BRVO", 66.6), seen: { ann: "board @ reading.board=list", bo: "market" } }),
    story("Bravo ticks while Ann has its drawer open: her drawer says how it moved, and so does Bo's board", { as: "feed", offPage: true, does: tick("BRVO", 66.7), seen: { ann: "market?symbol=BRVO", bo: "board" } }),
    story("Nobody can go to a window the desk does not have", { as: "ann", cannot: goTo("attic") }),
  ],
};
