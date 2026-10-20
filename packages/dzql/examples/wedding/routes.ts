import { run, serve } from "@blueshed/delta/serve";
import { appOf } from "dzql/rendering/server";
import type { Example } from "dzql/rendering/example";
import index from "./client/index.html";
import { delta, sessions } from "./store";
import { render } from "./page";
import { read as sessionOf } from "./resources/session/session-api";
import { session } from "./resources/session/session";
import { household } from "./resources/household/household";
import { board } from "./resources/board/board";
import { wedding } from "./resources/wedding/wedding";
import { welcome } from "./resources/welcome/welcome";
import { everyone } from "./resources/everyone/everyone";
import { routes } from "./http";

// The wedding: a save-the-date that becomes each household's page once its code is entered, and
// the couple's board. The app is its routes and its resources, each document a folder of
// ./resources/ (its api, its resource, and its part of the page where it has one), its store
// ./store.ts, its page ./page.ts, its stories ./stories.ts; the pictures are plain HTTP (./http.ts).

export const app: Example = {
  name: "wedding",
  resources: [session, household, board, wedding, welcome, everyone],
  // The welcome until a code says who you are, then whichever of the two it makes you (./page.ts).
  render,
  // The same guard every write path already needs: a tab that has left (or whose code no longer
  // exists) shouldn't be able to write, undo included, as if it were still in.
  active: (sessionId) => sessionOf(sessionId).code !== null,
  index,
  address: { doc: "session", path: "/page" }, // a tab's URL is where it stands: the visit says where it may, the kernel moves the tab
  routes,
  delta, // the documents are delta's (./store.ts)
  session: sessions.of, // a visit is a numbered row, named by its cookie
};

/** The server: on `PORT` (3000); `bun examples/wedding/routes.ts` runs it. */
export async function startServer({ port = Number(process.env.PORT ?? 3000) } = {}) {
  return serve(appOf(app), { port });
}

if (import.meta.main) await run(startServer);
