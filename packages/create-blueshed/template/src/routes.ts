import { createWs } from "@blueshed/delta/server";
import { run, serve } from "@blueshed/delta/serve";
import homepage from "./index.html";
import { messageDoc } from "./resources/message/message-api";
import { statusApi } from "./resources/status/status-api";

// The app is its routes and its resources. The server is delta's: `serve` puts these routes and
// the socket on Bun.serve (with /health and a 404); `run`, at the bottom, is the process around it.
export async function startServer({
  port = undefined as number | undefined,
  dev = undefined as boolean | undefined,
  dataDir = process.env.DATA_PATH ?? `${import.meta.dir}/../data`,
} = {}) {
  const status = statusApi();

  // What a resource opens that must be closed (a database), closed once the server stops
  const closing: (() => Promise<void>)[] = [];

  // The documents, on one WebSocket: a page that opens one is subscribed to every change
  const ws = createWs();
  await messageDoc(ws, dataDir);

  return serve(
    {
      ws,
      close: closing,
      routes: {
        "/": homepage,

        // What isn't communication is an HTTP route (see src/resources/)
        "/api/status": { GET: status.get },

        // Every document rides this socket (a literal key, so routes keep their typed params)
        "/ws": ws.upgrade,
      },
    },
    { port, dev },
  );
}

// `bun dev`, `bun start`: the pid file (`bun run stop`), the signals, and `bun --hot` serving again
if (import.meta.main) await run(startServer);
