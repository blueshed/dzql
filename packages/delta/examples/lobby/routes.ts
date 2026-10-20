/**
 * Lobby: who is here now, and the server's load. Nothing is stored: each document is a kind
 * whose truth is elsewhere. Who is here is this process's (memory), the colours are the
 * release's (static), the load is the machine's (source). The app is its routes and its
 * resources: here (resources/here/) and load (resources/load/).
 *
 *   bun examples/lobby/routes.ts               # port 3100
 *
 * Open http://localhost:3100 in two tabs and join in one: the other sees you; close it, and you go.
 */
import { createWs } from "@blueshed/delta/server";
import { run, serve, type ServeOptions, type Served } from "@blueshed/delta/serve";
import index from "./index.html";
import { hereApi } from "./resources/here/here-api";
import { loadApi } from "./resources/load/load-api";

/** The lobby's server, on `port` (`$PORT`, else 3100; 0 for any free one). */
export function startServer({ port = Number(process.env.PORT ?? 3100), dev }: ServeOptions = {}): Served {
  // The documents, on one WebSocket: a page that opens one is told every change to it
  const ws = createWs();
  hereApi(ws);
  const load = loadApi(ws);

  return serve({ ws, routes: { "/": index }, close: [() => load.stopAll()] }, { port, dev });
}

// The pid file (`delta stop`), the signals, and `bun --hot` serving again
if (import.meta.main) await run(() => startServer());
