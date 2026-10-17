/**
 * Server -- a real delta-doc server, 100% library surface.
 *
 *   createWs()                                  -- WS action router + pub/sub
 *   registerDocs(ws, db, schema, docs)          -- the "board:" document over SQLite
 *   serve({ ws, routes, close })                -- delta's one server: HTTP + WebSocket
 *
 * No hand-written SQL in the write path: a write is applied to the tables its
 * paths name, and `ws.publish(docName, {doc, ops})` reaches every subscriber.
 */
import type { Database } from "bun:sqlite";
import { createWs } from "../../src/server/server";
import { serve, type App, type ServeOptions, type Served } from "../../src/server/serve";
import { registerDocs } from "../../src/server/sqlite";
import { schema, docs } from "./schema";

/** The board's server: `routes` beside delta's socket, on any free port unless `options` says; stopping it closes `db`. */
export function startServer(db: Database, routes: App["routes"] = {}, options: ServeOptions = { port: 0, dev: false }): Served {
  const ws = createWs();
  registerDocs(ws, db, schema, docs);
  return serve({ ws, routes, close: [() => db.close()] }, options);
}
