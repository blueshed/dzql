import { concepts, conceptsByDocType, inspectFor, renderFor } from "./concepts";
import { renderRequested } from "./concepts/render";
import type { ConnectionData } from "./connection";
import type { PatchOp } from "./json-patch";
import index from "./client/index.html";

function pushRender(ws: Bun.ServerWebSocket<ConnectionData>) {
  ws.send(JSON.stringify({ type: "render", html: renderFor(ws.data.sessionId) }));
}

renderRequested.on((sockets) => {
  for (const ws of sockets) pushRender(ws);
});

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
      message(ws, raw) {
        let message: { type?: string; doc?: string; ops?: PatchOp[] };
        try {
          message = JSON.parse(String(raw));
        } catch {
          return;
        }

        if (message.type === "inspect") {
          ws.send(JSON.stringify({ type: "inspect", ...inspectFor(ws) }));
          return;
        }

        const concept = message.doc ? conceptsByDocType.get(message.doc) : undefined;
        const ops = message.ops ?? [];
        let rendered = false;

        if (concept && ops.length > 0) {
          const docId = concept.resolveDoc(ws);
          if (docId && ops.every((op) => concept.permit(ws, op))) {
            rendered = Boolean(concept.write(ws, docId, ops).rendered);
          }
        }

        if (!rendered) pushRender(ws);
      },
      close(ws) {
        for (const concept of concepts) concept.onClose?.(ws);
      },
    },
    development: process.env.NODE_ENV !== "production",
  });

  return server;
}
