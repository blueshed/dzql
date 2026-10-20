import { run, serve } from "@blueshed/delta/serve";
import { appOf } from "dzql/rendering/server";
import type { Example } from "dzql/rendering/example";
import index from "./client/index.html";
import { delta, sessions } from "./store";
import { render } from "./page";
import { desk } from "./resources/desk/desk";
import { ticker } from "./resources/ticker/ticker";
import { quote } from "./resources/quote/quote";
import { watchlist } from "./resources/watchlist/watchlist";
import { clock } from "./resources/clock/clock";

// The ticker: a market that moves while it is watched, a board of the symbols you watch, and a
// clock. The app is its routes and its resources, each document a folder of ./resources/ (its api,
// its resource, and its part of the page where it has one), its store ./store.ts, its page
// ./page.ts, its stories ./stories.ts.

export const app: Example = {
  name: "ticker",
  // The page is the desk's; the market, the watchlist and the clock are drawn and written within it.
  // The desk first: how the board is read -- the session's own.
  resources: [desk, ticker, quote, watchlist, clock],
  render,
  // No sign-in: a visitor's watchlist is their session's, and anyone may type a tick.
  active: () => true,
  index,
  address: { doc: "desk", path: "/page" }, // a tab's URL is where it stands: the desk says where it may, the kernel moves the tab
  delta, // the documents are delta's (./store.ts)
  session: sessions.of, // a visit is a desk
};

/** The server: on `PORT` (3000); `bun examples/ticker/routes.ts` runs it. */
export async function startServer({ port = Number(process.env.PORT ?? 3000) } = {}) {
  return serve(appOf(app), { port });
}

if (import.meta.main) await run(startServer);
