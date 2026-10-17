/**
 * Kanban: the page and its server.
 *
 * Makes the tables in SQLite and seeds a board, registers the "board:"
 * document, serves the HTML page that drives `client.tsx`.
 *
 * Run:
 *   bun examples/kanban/serve.ts        # default port 3100
 *   PORT=3199 bun examples/kanban/serve.ts
 *
 * Open http://localhost:3100 in two tabs: a card moved in one moves in the other.
 */
import index from "./index.html";
import { openBoard, DB_PATH } from "./setup";
import { createWs } from "../../src/server/server";
import { serve } from "../../src/server/serve";
import { registerDocs } from "../../src/server/sqlite";
import { schema, docs } from "./schema";

const db = openBoard();

const ws = createWs();
registerDocs(ws, db, schema, docs);

const { server } = serve({ ws, routes: { "/": index } }, { port: Number(process.env.PORT ?? 3100) });

console.log(`kanban (railroad UX) on http://localhost:${server.port}  (DB: ${DB_PATH})`);
console.log(`  open two tabs · click a card to cycle columns · double-click a header to rename`);

const shutdown = async () => {
  server.stop(true);
  db.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
