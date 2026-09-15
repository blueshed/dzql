import type { Example } from "../../src/example";
import { clock } from "./compartments/clock";
import { ticker } from "./compartments/ticker";
import { watchlist } from "./compartments/watchlist";
import index from "./client/index.html";

export const example: Example = {
  name: "ticker",
  // The ticker renders the page; the watchlist and the clock are written within it.
  compartments: [ticker, watchlist, clock],
  // No sign-in: a visitor's watchlist is their session's, and anyone may type a tick.
  active: () => true,
  index,
};
