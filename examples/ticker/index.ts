import type { Example } from "../../src/example";
import { clock } from "./concepts/clock";
import { ticker } from "./concepts/ticker";
import { watchlist } from "./concepts/watchlist";
import index from "./client/index.html";

export const example: Example = {
  name: "ticker",
  // The ticker renders the page; the watchlist and the clock are written within it.
  concepts: [ticker, watchlist, clock],
  // No sign-in: a visitor's watchlist is their session's, and anyone may type a tick.
  active: () => true,
  index,
};
