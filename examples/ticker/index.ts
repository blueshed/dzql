import type { Example } from "../../src/example";
import { clock } from "./compartments/clock";
import { desk } from "./compartments/desk";
import { render, ticker } from "./compartments/ticker";
import { watchlist } from "./compartments/watchlist";
import index from "./client/index.html";

export const example: Example = {
  name: "ticker",
  // The ticker renders the page; the watchlist and the clock are written within it.
  // The desk first: what is open, whose drawer, how the board is read -- the session's own.
  compartments: [desk, ticker, watchlist, clock],
  render,
  // No sign-in: a visitor's watchlist is their session's, and anyone may type a tick.
  active: () => true,
  index,
};
