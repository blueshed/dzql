import { run, serve } from "@blueshed/delta/serve";
import { appOf, compose } from "../../rendering/server";
import type { Example } from "dzql/rendering/example";
import index from "./client/index.html";
import { delta, sessions } from "./store";
import { render } from "./page";
import { read as sessionOf } from "./resources/session/session-api";
import { session } from "./resources/session/session";
import { model } from "./resources/model/model";
import { links } from "./signin";

// modeling: a description of an application, kept by two people as they talk -- Peter tells the
// stories, Claude writes them down and describes the documents they need, from the CLI -- and
// watched live on the page. The entities are worked out from the documents (./heart.ts). The app is
// its routes and its resources, each document a folder of ./resources/ (its api, its resource, its
// part of the page), its store ./store.ts, its page ./page.ts, its stories ./stories.ts. What the
// modeller draws and checks (./heart.ts, ./closure.ts, ./site.ts), the CLI's verbs (./cli.ts), the
// sign-in links (./signin.ts) and the loader that reads an app (./loader/) are no document's, and
// sit beside them.
export const app: Example = {
  name: "modeling",
  // The session first: who you are, and what you have picked.
  resources: [session, model],
  render,
  // Signed in or not: a signed-out tab writes nothing, Undo included.
  active: (sessionId) => sessionOf(sessionId).person !== null,
  // The ledger's who is the person, not the visit.
  who: (sessionId) => sessionOf(sessionId).person?.id ?? sessionId,
  index,
  at: "/model", // a route of whatever app it is served beside, in development: never registered in production
  routes: { "/in/:token": links.route as never },
  delta, // the documents are delta's (./store.ts)
  session: sessions.of, // a session is a numbered row, named by its cookie
};

/** The model's page on its own, on `PORT`: served at /model, the root sending you there (`dzql model`, `bun run dev:modeling`). */
export async function startServer({ port = Number(process.env.PORT ?? 3001) } = {}) {
  return serve(compose(appOf(app), { routes: { "/": Response.redirect(app.at!, 302) } }), { port });
}

if (import.meta.main) await run(startServer);
