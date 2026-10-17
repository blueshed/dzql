/**
 * Kanban: the page and its server.
 *
 * Makes the tables in SQLite and seeds a board, registers the "board:"
 * document, serves the HTML page that drives `client.tsx`. `run` is the
 * process around it: Ctrl-C stops the server and closes the database.
 *
 * Run:
 *   bun examples/kanban/serve.ts        # default port 3100
 *   PORT=3199 bun examples/kanban/serve.ts
 *
 * Open http://localhost:3100 in two tabs: a card moved in one moves in the other.
 */
import index from "./index.html";
import { openBoard, DB_PATH } from "./setup";
import { run } from "../../src/server/serve";
import { startServer } from "./server";

await run(() => startServer(openBoard(), { "/": index }, { port: Number(process.env.PORT ?? 3100) }));

console.log(`kanban (railroad UX), DB: ${DB_PATH}`);
console.log(`  open two tabs · click a card to cycle columns · double-click a header to rename`);
