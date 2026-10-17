import { createWs } from "@blueshed/delta/server";
import homepage from "./index.html";
import { messageDoc } from "./resources/message/message-api";
import { statusApi } from "./resources/status/status-api";

export async function startServer({
  port = Number(process.env.PORT ?? 3000),
  dev = process.env.NODE_ENV !== "production",
  dataDir = process.env.DATA_PATH ?? `${import.meta.dir}/../data`,
} = {}) {
  const status = statusApi();

  // What a resource opens that must be closed (a database), closed once the server stops
  const closing: (() => Promise<void>)[] = [];

  // The documents, on one WebSocket: a page that opens one is subscribed to every change
  const ws = createWs();
  await messageDoc(ws, dataDir);

  const server = Bun.serve({
    port,

    development: dev && {
      hmr: true,      // hot reload in the browser
      console: true,  // echo browser console.log to the terminal
    },

    routes: {
      "/": homepage,

      // What isn't communication is an HTTP route (see src/resources/)
      "/api/status": { GET: status.get },

      // Every document rides this socket (a literal key, so routes keep their typed params)
      "/ws": ws.upgrade,

      // Railway healthcheck
      "/health": new Response("ok"),
    },

    websocket: ws.websocket,

    // Anything not matched by a route
    fetch() {
      return new Response("Not found", { status: 404 });
    },
  });
  ws.setServer(server); // so a change reaches every page holding the document

  // Close what the resources opened; once only (bun --hot runs startServer again on the same server)
  const close = async () => {
    for (const done of closing.splice(0)) await done();
  };
  return {
    url: server.url,
    port: server.port,
    close,
    /** Stop serving (`force` drops open connections, as Bun's `stop` does), then close what the resources opened. */
    async stop(force?: boolean) {
      await server.stop(force);
      await close();
    },
  };
}
