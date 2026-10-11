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

      // Every document rides this socket
      [ws.path]: ws.upgrade,

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
  return server;
}
