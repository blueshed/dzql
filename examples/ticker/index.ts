import type { Example } from "../../src/example";
import { ticker } from "./concepts/ticker";
import { watchlist } from "./concepts/watchlist";
import index from "./client/index.html";

export const example: Example = {
  name: "ticker",
  // The ticker renders the page; the watchlist is written within it.
  concepts: [ticker, watchlist],
  // No sign-in: a visitor's watchlist is their session's, and anyone may type a tick.
  active: () => true,
  index,
};
