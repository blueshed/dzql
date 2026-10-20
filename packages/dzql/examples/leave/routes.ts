import { run, serve } from "@blueshed/delta/serve";
import { appOf } from "dzql/rendering/server";
import type { Example } from "dzql/rendering/example";
import index from "./client/index.html";
import { delta, sessions } from "./store";
import { render } from "./page";
import { read as sessionOf } from "./resources/session/session-api";
import { session } from "./resources/session/session";
import { team } from "./resources/team/team";
import { identify, signIn } from "./signin";

// leave: a small team asks for days off, and a manager answers. The example whose people sign in:
// the sign-in page posts to /login (./signin.ts), and from then on a session is a person. The app
// is its routes and its resources, each document a folder of ./resources/ (its api, its resource,
// its part of the page), its store ./store.ts, its page ./page.ts, its stories ./stories.ts; the
// sign-in is no document's, a route of its own (./signin.ts).
export const app: Example = {
  name: "leave",
  // The session first: who you are, and your draft.
  resources: [session, team],
  render,
  // Signed in or not: a signed-out tab writes nothing, Undo included.
  active: (sessionId) => sessionOf(sessionId).person !== null,
  // The ledger's who is the person, not the visit.
  who: (sessionId) => sessionOf(sessionId).person?.id ?? sessionId,
  index,
  address: { doc: "session", path: "/page" }, // a tab's URL is where it stands: the session says where it may, the kernel moves the tab
  identify, // a trusted proxy's header, or the CLI's token (./signin.ts)
  routes: { "/login": signIn },
  delta, // the documents are delta's (./store.ts)
  session: sessions.of,
};

/** The server: on `PORT` (3000); `bun examples/leave/routes.ts` runs it. */
export async function startServer({ port = Number(process.env.PORT ?? 3000) } = {}) {
  return serve(appOf(app), { port });
}

if (import.meta.main) await run(startServer);
