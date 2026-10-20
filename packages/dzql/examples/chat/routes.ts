import { run, serve } from "@blueshed/delta/serve";
import { appOf } from "dzql/rendering/server";
import type { Example } from "dzql/rendering/example";
import index from "./client/index.html";
import { delta, sessions } from "./store";
import { render } from "./page";
import { read as sessionOf } from "./resources/session/session-api";
import { session } from "./resources/session/session";
import { room } from "./resources/room/room";
import { here } from "./resources/here/here";
import { lobby } from "./resources/lobby/lobby";

// Chat: your name, a room, say something. The app is its routes and its resources, each document
// a folder of ./resources/ (its api, its resource, its part of the page), its store ./store.ts, its
// page ./page.ts, its stories ./stories.ts.

export const app: Example = {
  name: "chat",
  resources: [session, room, here, lobby],
  delta,
  session: sessions.of,
  render,
  // Same guard every write path already needs: a stale, logged-out tab
  // shouldn't be able to write (including undo) as if it were still active.
  active: (sessionId) => sessionOf(sessionId).name !== null,
  index,
};

/** The server: on `PORT` (3000); `bun examples/chat/routes.ts` runs it. */
export async function startServer({ port = Number(process.env.PORT ?? 3000) } = {}) {
  return serve(await appOf(app), { port });
}

if (import.meta.main) await run(startServer);
