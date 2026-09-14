import { clearSession, setSessionName } from "./db";
import { renderFor } from "./views";
import index from "./index.html";

type SessionData = { sessionId: string };

function pushRender(ws: Bun.ServerWebSocket<SessionData>) {
  ws.send(JSON.stringify({ type: "render", html: renderFor(ws.data.sessionId) }));
}

export function createServer(port: number | string = process.env.PORT ?? 3000) {
  const server = Bun.serve<SessionData>({
    port,
    routes: {
      "/": index,
      "/api/health": () => Response.json({ ok: true }),
      "/ws": (req: Bun.BunRequest, server: Bun.Server<SessionData>) => {
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
        pushRender(ws);
      },
      message(ws, message) {
        let event: { name?: string; payload?: Record<string, unknown> };
        try {
          event = JSON.parse(String(message));
        } catch {
          return;
        }

        if (event.name === "set-name") {
          const name = String(event.payload?.name ?? "").trim();
          if (name) setSessionName(ws.data.sessionId, name);
        } else if (event.name === "logout") {
          clearSession(ws.data.sessionId);
        }

        pushRender(ws);
      },
    },
    development: process.env.NODE_ENV !== "production",
  });

  return server;
}
