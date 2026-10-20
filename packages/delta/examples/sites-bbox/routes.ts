/**
 * sites-bbox on SQLite (in memory): the app is its routes and its resources, `world:1`
 * to read and write every site (resources/world/) and
 * `sites-in-bbox:<minLng>,<minLat>,<maxLng>,<maxLat>` for the sites in a box
 * (resources/box/). No page: a client opens them on the socket.
 *
 *   PORT=3100 bun examples/sites-bbox/routes.ts
 */
import { Database } from "bun:sqlite";
import { createWs } from "@blueshed/delta/server";
import { run, serve, type ServeOptions, type Served } from "@blueshed/delta/serve";
import { worldApi } from "./resources/world/world-api";
import { boxApi } from "./resources/box/box-api";

/** The server, on `port` (`$PORT`, else 3000; 0 for any free one); stopping it closes the database. */
export function startServer({ port, dev }: ServeOptions = {}): Served {
  const db = new Database(":memory:");   // a path keeps it

  // The documents, on one WebSocket, over the same rows: the world first, as it makes the tables
  const ws = createWs();
  worldApi(ws, db);
  boxApi(ws, db);

  return serve({ ws, routes: {}, close: [() => db.close()] }, { port, dev });
}

// The pid file (`delta stop`), the signals, and `bun --hot` serving again
if (import.meta.main) {
  const { port } = await run(() => startServer());
  console.log(`sites-bbox (SQLite) on ws://localhost:${port}/ws`);
  console.log(`  open "world:1" to read and write every site`);
  console.log(`  open "sites-in-bbox:0,0,50,50" for the sites in that box`);
}
