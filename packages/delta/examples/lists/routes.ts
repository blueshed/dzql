/**
 * Lists: shared lists, each person signed in by a link, seeing only the lists they are on, and
 * undoing their own changes, never another's. The app is its routes and its resources: people
 * (who is here, and signing in by link) and lists (each list, who is on it and its items, on the
 * ledger). One SQLite file keeps them, each resource's tables made by its history of migrations.
 *
 *   bun examples/lists/routes.ts                       # port 3100, examples/lists/lists.db
 *   bunx @blueshed/delta link examples/lists/lists.db 1 --origin http://localhost:3100   # Ann's link
 */
import { Database } from "bun:sqlite";
import { upgradeWithAuth } from "@blueshed/delta/auth";
import { createWs } from "@blueshed/delta/server";
import { run, serve, type ServeOptions, type Served } from "@blueshed/delta/serve";
import index from "./index.html";
import { peopleApi } from "./resources/people/people-api";
import { listsApi } from "./resources/lists/lists-api";

/** LISTS_DB names the file; by default it is kept beside this one, so a link made for it works. */
export const DB_PATH = process.env.LISTS_DB ?? `${import.meta.dir}/lists.db`;

/** The server, on `port` (`$PORT`, else 3100; 0 for any free one); stopping it closes the database. */
export async function startServer({ port = Number(process.env.PORT ?? 3100), dev }: ServeOptions = {}): Promise<Served> {
  const db = new Database(DB_PATH, { create: true });

  // The documents, on one WebSocket, each resource's tables brought up to date by its migrations first
  const ws = createWs();
  const auth = await peopleApi(ws, db);   // who is at the socket
  await listsApi(ws, db, auth);

  return serve({
    ws,
    routes: {
      ...auth.routes,                          // the link's tap, sign out, and in development "Who are you?"
      [ws.path]: upgradeWithAuth(ws, auth),    // the socket, signed in by the session cookie
      "/": index,
    },
    close: [() => db.close()],
  }, { port, dev });
}

// The pid file (`delta stop`), the signals, and `bun --hot` serving again
if (import.meta.main) await run(() => startServer());
