import { concepts, renderFor } from "./concepts";
import type { ConnectionData } from "./connection";
import index from "./index.html";

function pushRender(ws: Bun.ServerWebSocket<ConnectionData>) {
  ws.send(JSON.stringify({ type: "render", html: renderFor(ws.data.sessionId) }));
}

const eventHandlers = new Map(concepts.flatMap((concept) => Object.entries(concept.events)));

export function createServer(port: number | string = process.env.PORT ?? 3000) {
  const server = Bun.serve<ConnectionData>({
    port,
    routes: {
      "/": index,
      "/api/health": () => Response.json({ ok: true }),
      "/ws": (req: Bun.BunRequest, server: Bun.Server<ConnectionData>) => {
        const sessionId = req.cookies.get("session_id") ?? crypto.randomUUID();
        if (!req.cookies.has("session_id")) {
          req.cookies.set("session_id", sessionId, {
            path: "/",
            httpOnly: true,
            sameSite: "lax",
            secure: process.env.NODE_ENV === "production",
          });
        }

        const headers = new Headers();
        for (const setCookie of req.cookies.toSetCookieHeaders()) {
          headers.append("Set-Cookie", setCookie);
        }

        if (server.upgrade(req, { data: { sessionId }, headers })) return;
        return new Response("Upgrade failed", { status: 400 });
      },
    },
    websocket: {
      open(ws) {
        for (const concept of concepts) concept.onOpen?.(ws);
        pushRender(ws);
      },
      message(ws, message) {
        let event: { name?: string; payload?: Record<string, unknown> };
        try {
          event = JSON.parse(String(message));
        } catch {
          return;
        }

        const handler = event.name ? eventHandlers.get(event.name) : undefined;
        const skipRender = handler?.(ws, event.payload ?? {});
        if (!skipRender) pushRender(ws);
      },
      close(ws) {
        for (const concept of concepts) concept.onClose?.(ws);
      },
    },
    development: process.env.NODE_ENV !== "production",
  });

  return server;
}
