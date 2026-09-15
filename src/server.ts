import { assemble } from "./concepts";
import { fragmentsMessage, renderMessage, renderRequested } from "./concepts/render";
import type { ConnectionData } from "./connection";
import type { Example } from "./example";
import type { PatchOp } from "./json-patch";

// One example per process is an invariant: a running eta process serves
// exactly one example, and this tracks which (so the renderRequested
// listener below -- registered once, not once per createServer call -- knows
// what to render through no matter which concept's code fired it). It's
// cleared when that example's server(s) are all stopped, so a test suite
// that creates one example's server, stops it, then creates a *different*
// example's server (as the kernel's own generic tests and an example's own
// tests do, in the same process) doesn't trip the guard below.
let active: { example: Example; assembled: ReturnType<typeof assemble> } | undefined;

renderRequested.on((request) => {
  if (!active) return; // unreachable in practice: nothing can fire this before a server exists
  const { sockets, write } = "sockets" in request ? request : { sockets: request, write: undefined };
  const owner = write ? active.assembled.byDocType.get(write.docType) : undefined;
  for (const ws of sockets) {
    // The owning concept may say exactly what changed on this page (HTML ops), or that nothing
    // did; only when it declines does the whole page go out.
    const ops = write && owner?.fragments?.(ws, write.docId, write.result);
    if (ops) {
      if (ops.length > 0) ws.send(fragmentsMessage(ops));
    } else {
      ws.send(renderMessage(active.assembled.renderFor(ws.data.sessionId)));
    }
  }
});

export function createServer(example: Example, port: number | string = process.env.PORT ?? 3000) {
  if (active && active.example !== example) {
    throw new Error(
      `createServer was already called with a different example ("${active.example.name}"); ` +
        `a process may only ever serve one example at a time.`,
    );
  }
  const assembled = assemble(example);
  active = { example, assembled };
  const { concepts, byDocType, inspectFor, renderFor } = assembled;

  function pushRender(ws: Bun.ServerWebSocket<ConnectionData>) {
    ws.send(renderMessage(renderFor(ws.data.sessionId)));
  }

  const server = Bun.serve<ConnectionData>({
    port,
    routes: {
      ...example.routes,
      "/": example.index,
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
        let message: { type?: string; doc?: string; ops?: PatchOp[]; limit?: number };
        try {
          message = JSON.parse(String(raw));
        } catch {
          return;
        }

        if (message.type === "inspect") {
          ws.send(JSON.stringify({ type: "inspect", ...inspectFor(ws, message.limit) }));
          return;
        }

        const concept = message.doc ? byDocType.get(message.doc) : undefined;
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

  const stop = server.stop.bind(server);
  server.stop = ((...args: Parameters<typeof server.stop>) => {
    if (active?.example === example) active = undefined;
    return stop(...args);
  }) as typeof server.stop;

  return server;
}
