import type { Example } from "../../src/example";
import { clock } from "./compartments/clock";
import { desk } from "./compartments/desk";
import { ticker } from "./compartments/ticker";
import { watchlist } from "./compartments/watchlist";
import index from "./client/index.html";

export const example: Example = {
  name: "ticker",
  // The ticker renders the page; the watchlist and the clock are written within it.
  compartments: [ticker, watchlist, clock],
  // The tray: what is open on the desk, whose drawer, how the board is read -- a session's own,
  // reached only by docType (item 10's rule 3).
  tray: desk,
  // No sign-in: a visitor's watchlist is their session's, and anyone may type a tick.
  active: () => true,
  index,
};
