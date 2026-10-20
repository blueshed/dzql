/**
 * Kanban: the app is its routes and its resources. The server is delta's: `serve`
 * puts the page and the socket on Bun.serve (with /health and a 404), and stopping
 * it closes the database; `run`, at the bottom, is the process around it.
 *
 *   bun examples/kanban/routes.ts               # port 3100
 *   PORT=3199 bun examples/kanban/routes.ts
 *
 * Open http://localhost:3100 in two tabs: a card moved in one moves in the other.
 */
import { createWs } from "@blueshed/delta/server";
import { run, serve, type ServeOptions, type Served } from "@blueshed/delta/serve";
import index from "./index.html";
import { boardApi } from "./resources/board/board-api";

/** The board's server, on `port` (`$PORT`, else 3100; 0 for any free one). */
export function startServer({ port = Number(process.env.PORT ?? 3100), dev }: ServeOptions = {}): Served {
  // The documents, on one WebSocket: a page that opens one is subscribed to every change
  const ws = createWs();
  const db = boardApi(ws);

  return serve({ ws, routes: { "/": index }, close: [() => db.close()] }, { port, dev });
}

// The pid file (`delta stop`), the signals, and `bun --hot` serving again
if (import.meta.main) await run(() => startServer());
