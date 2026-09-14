import { clearSession, getSessionName, setSessionName } from "./db";
import { addMessage, DEFAULT_ROOM, joinRoom, leaveRoom, roomSockets } from "./rooms";
import type { SessionData } from "./session";
import { renderFor } from "./views";
import index from "./index.html";

function pushRender(ws: Bun.ServerWebSocket<SessionData>) {
  ws.send(JSON.stringify({ type: "render", html: renderFor(ws.data.sessionId) }));
}

function broadcastRoom() {
  for (const ws of roomSockets(DEFAULT_ROOM)) pushRender(ws);
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
        if (getSessionName(ws.data.sessionId)) joinRoom(DEFAULT_ROOM, ws);
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
          if (name) {
            setSessionName(ws.data.sessionId, name);
            joinRoom(DEFAULT_ROOM, ws);
          }
        } else if (event.name === "send-message") {
          const name = getSessionName(ws.data.sessionId);
          const text = String(event.payload?.text ?? "").trim();
          if (name && text) {
            addMessage(DEFAULT_ROOM, name, text);
            broadcastRoom();
            return;
          }
        } else if (event.name === "logout") {
          leaveRoom(DEFAULT_ROOM, ws);
          clearSession(ws.data.sessionId);
        }

        pushRender(ws);
      },
      close(ws) {
        leaveRoom(DEFAULT_ROOM, ws);
      },
    },
    development: process.env.NODE_ENV !== "production",
  });

  return server;
}
