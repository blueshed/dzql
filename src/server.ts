import {
  addMessage,
  type ChatMessage,
  clearSession,
  ensureRoom,
  getSessionName,
  getSessionRoom,
  leaveCurrentRoom,
  setSessionName,
  setSessionRoom,
} from "./db";
import { joinRoom, leaveRoom, roomSockets } from "./rooms";
import type { SessionData } from "./session";
import { renderFor, renderMessage } from "./views";
import index from "./index.html";

function pushRender(ws: Bun.ServerWebSocket<SessionData>) {
  ws.send(JSON.stringify({ type: "render", html: renderFor(ws.data.sessionId) }));
}

function broadcastMessage(room: string, message: ChatMessage) {
  const payload = JSON.stringify({ type: "append", selector: ".messages", html: renderMessage(message) });
  for (const ws of roomSockets(room)) ws.send(payload);
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
        const room = getSessionRoom(ws.data.sessionId);
        if (room) joinRoom(room, ws);
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
        } else if (event.name === "join-room") {
          const room = String(event.payload?.room ?? "").trim();
          if (room) {
            const previousRoom = getSessionRoom(ws.data.sessionId);
            if (previousRoom) leaveRoom(previousRoom, ws);
            ensureRoom(room);
            setSessionRoom(ws.data.sessionId, room);
            joinRoom(room, ws);
          }
        } else if (event.name === "leave-room") {
          const room = getSessionRoom(ws.data.sessionId);
          if (room) {
            leaveRoom(room, ws);
            leaveCurrentRoom(ws.data.sessionId);
          }
        } else if (event.name === "send-message") {
          const name = getSessionName(ws.data.sessionId);
          const room = getSessionRoom(ws.data.sessionId);
          const text = String(event.payload?.text ?? "").trim();
          if (name && room && text) {
            broadcastMessage(room, addMessage(room, name, text));
            return;
          }
        } else if (event.name === "logout") {
          const room = getSessionRoom(ws.data.sessionId);
          if (room) leaveRoom(room, ws);
          clearSession(ws.data.sessionId);
        }

        pushRender(ws);
      },
      close(ws) {
        const room = getSessionRoom(ws.data.sessionId);
        if (room) leaveRoom(room, ws);
      },
    },
    development: process.env.NODE_ENV !== "production",
  });

  return server;
}
