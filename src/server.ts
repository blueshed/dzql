import * as roomDoc from "./documents/room";
import * as sessionDoc from "./documents/session";
import { joinRoom, leaveRoom, roomSockets } from "./rooms";
import type { SessionData } from "./session";
import { renderFor, renderMessage, renderPeople } from "./views";
import index from "./index.html";

function pushRender(ws: Bun.ServerWebSocket<SessionData>) {
  ws.send(JSON.stringify({ type: "render", html: renderFor(ws.data.sessionId) }));
}

function broadcastMessage(room: string, message: roomDoc.ChatMessage) {
  const payload = JSON.stringify({ type: "append", selector: ".messages", html: renderMessage(message) });
  for (const ws of roomSockets(room)) ws.send(payload);
}

function broadcastPeople(room: string) {
  const html = renderPeople(roomDoc.read(room).people);
  const payload = JSON.stringify({ type: "render", selector: ".people", html });
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
        const { room } = sessionDoc.read(ws.data.sessionId);
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
          sessionDoc.patch(ws.data.sessionId, [{ op: "replace", path: "/name", value: event.payload?.name }]);
        } else if (event.name === "join-room") {
          const previousRoom = sessionDoc.read(ws.data.sessionId).room;
          sessionDoc.patch(
            ws.data.sessionId,
            [{ op: "replace", path: "/room", value: event.payload?.room }],
            ws,
          );
          if (previousRoom) broadcastPeople(previousRoom);
          const { room } = sessionDoc.read(ws.data.sessionId);
          if (room) broadcastPeople(room);
        } else if (event.name === "leave-room") {
          const { room } = sessionDoc.read(ws.data.sessionId);
          sessionDoc.patch(ws.data.sessionId, [{ op: "remove", path: "/room" }], ws);
          if (room) broadcastPeople(room);
        } else if (event.name === "send-message") {
          const { name, room } = sessionDoc.read(ws.data.sessionId);
          const text = String(event.payload?.text ?? "").trim();
          if (name && room && text) {
            const added = roomDoc.patch(room, [{ op: "add", path: "/transcript/-", value: { name, text } }]);
            if (added) broadcastMessage(room, added);
            return;
          }
        } else if (event.name === "logout") {
          const { room } = sessionDoc.read(ws.data.sessionId);
          sessionDoc.patch(ws.data.sessionId, [{ op: "remove", path: "/name" }], ws);
          if (room) broadcastPeople(room);
        }

        pushRender(ws);
      },
      close(ws) {
        const { room } = sessionDoc.read(ws.data.sessionId);
        if (room) {
          leaveRoom(room, ws);
          broadcastPeople(room);
        }
      },
    },
    development: process.env.NODE_ENV !== "production",
  });

  return server;
}
