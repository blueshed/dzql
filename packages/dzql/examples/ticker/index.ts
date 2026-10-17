import type { Example } from "dzql/rendering/example";
import { clock } from "./resources/clock";
import { desk } from "./resources/desk";
import { quote, render, ticker } from "./resources/ticker";
import { watchlist } from "./resources/watchlist";
import index from "./client/index.html";
import { delta, sessions } from "./delta";

export const example: Example = {
  name: "ticker",
  // The ticker renders the page; the watchlist and the clock are written within it.
  // The desk first: what is open, whose drawer, how the board is read -- the session's own.
  resources: [desk, ticker, quote, watchlist, clock],
  render,
  // No sign-in: a visitor's watchlist is their session's, and anyone may type a tick.
  active: () => true,
  index,
  delta, // the documents are delta's (./delta.ts)
  session: sessions.of, // a visit is a desk
};
