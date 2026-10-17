/**
 * Server -- a real delta-doc server, 100% library surface.
 *
 *   createWs()                                  -- WS action router + pub/sub
 *   registerDocs(ws, db, schema, docs)          -- the "board:" document over SQLite
 *   serve({ ws, routes })                       -- delta's one server: HTTP + WebSocket
 *
 * No hand-written SQL in the write path: a write is applied to the tables its
 * paths name, and `ws.publish(docName, {doc, ops})` reaches every subscriber.
 */
import type { Database } from "bun:sqlite";
import type { Server } from "bun";
import { createWs } from "../../src/server/server";
import { serve } from "../../src/server/serve";
import { registerDocs } from "../../src/server/sqlite";
import { schema, docs } from "./schema";

export interface KanbanServer {
  server: Server<unknown>;
  port:   number;
  wsUrl:  string;
  stop(): Promise<void>;
}

export async function startServer(db: Database): Promise<KanbanServer> {
  const ws = createWs();
  registerDocs(ws, db, schema, docs);

  const { server } = serve({ ws, routes: {} }, { port: 0, dev: false }); // port 0: the OS picks

  const port  = server.port!;
  const wsUrl = `ws://localhost:${port}${ws.path}`;

  return {
    server,
    port,
    wsUrl,
    async stop() {
      server.stop(true);
    },
  };
}
