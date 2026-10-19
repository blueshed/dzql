import { run, serve } from "@blueshed/delta/serve";
import { appOf } from "dzql/rendering/server";
import type { Example } from "dzql/rendering/example";
import { clock } from "./resources/clock";
import { desk } from "./resources/desk";
import { quote, render, ticker } from "./resources/ticker";
import { watchlist } from "./resources/watchlist";
import index from "./client/index.html";
import { delta, sessions } from "./delta";

export const app: Example = {
  name: "ticker",
  // The ticker renders the page; the watchlist and the clock are written within it.
  // The desk first: what is open, whose drawer, how the board is read -- the session's own.
  resources: [desk, ticker, quote, watchlist, clock],
  render,
  // No sign-in: a visitor's watchlist is their session's, and anyone may type a tick.
  active: () => true,
  index,
  address: { doc: "desk", path: "/page" }, // a screen's URL is where the desk goes (the server routes it)
  delta, // the documents are delta's (./delta.ts)
  session: sessions.of, // a visit is a desk
};

/** The server: on `PORT` (3000); `bun examples/ticker/routes.ts` runs it. */
export async function startServer({ port = Number(process.env.PORT ?? 3000) } = {}) {
  return serve(appOf(app), { port });
}

if (import.meta.main) await run(startServer);
