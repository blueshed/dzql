import { assemble } from "./compartments";
import { closeConnection, openConnection, resolveName, sees, setActiveCompartments } from "./compartments/audience";
import { fragmentsMessage, renderMessage, renderRequested } from "./compartments/render";
import type { ConnectionData } from "./connection";
import type { Example } from "./example";
import type { PatchOp } from "./json-patch";
import { drawing } from "./reading";

// One example per process is an invariant: a running eta process serves
// exactly one example, and this tracks which (so the renderRequested
// listener below -- registered once, not once per createServer call -- knows
// what to render through no matter which compartment's code fired it). It's
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
    // The owning compartment may say exactly what changed on this page (HTML ops), or that
    // nothing did (`[]`); when it does not answer, the page goes whole, and the morph finds what
    // changed.
    // Whatever the drawing reads is what this connection sees from now on (src/reading.ts): the
    // page replaces what it saw; a fragment adds to it.
    const ops = write && drawing(ws, false, () => owner?.fragments?.(ws, write.docId, write.result));
    if (ops) {
      if (ops.length > 0) ws.send(fragmentsMessage(ops));
      continue;
    }
    ws.send(renderMessage(drawing(ws, true, () => active!.assembled.renderFor(ws.data.sessionId))));
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
  const { compartments, byDocType, inspectFor, renderFor } = assembled;
  setActiveCompartments(byDocType);

  function pushRender(ws: Bun.ServerWebSocket<ConnectionData>) {
    ws.send(renderMessage(drawing(ws, true, () => renderFor(ws.data.sessionId))));
  }

  const server = Bun.serve<ConnectionData>({
    port,
    routes: {
      ...example.routes,
      "/": example.index,
      // A page an example puts in the URL (change-request.md item 3) is a path the server has
      // never heard of -- it doesn't resolve one, it just hands back the same shell for any path
      // that isn't an exact route above, and the client reads the URL itself once it connects.
      "/*": example.index,
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
        openConnection(ws);
        for (const compartment of compartments) compartment.onOpen?.(ws);
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

        // A write names its document: whole (`room:general`), or by type alone for the one of that
        // type this connection is on. Whichever, a connection writes only what it sees, and then only
        // what the owner permits.
        const target = message.doc ? resolveName(byDocType, message.doc, ws) : undefined;
        const ops = message.ops ?? [];
        let wrote = false;

        if (target && ops.length > 0 && sees(target.owner, ws, target.docId)) {
          const { owner, docId } = target;
          if (ops.every((op) => owner.permit(ws, op, docId))) {
            wrote = owner.write(ws, docId, ops).applied.length > 0;
          }
        }

        // A write that actually applied something is responsible for asking its own connection
        // to be brought up to date, same as any other connection that sees the document (rule
        // 2's write() doc comment) -- rendering it again here would be the second time. Nothing
        // applied (rejected, unknown doc, empty ops) means nothing asked, so this is the only render.
        if (!wrote) pushRender(ws);
      },
      close(ws) {
        closeConnection(ws);
        for (const compartment of compartments) compartment.onClose?.(ws);
      },
    },
    development: process.env.NODE_ENV !== "production",
  });

  const stop = server.stop.bind(server);
  server.stop = ((...args: Parameters<typeof server.stop>) => {
    if (active?.example === example) {
      active = undefined;
      setActiveCompartments(undefined);
    }
    return stop(...args);
  }) as typeof server.stop;

  return server;
}
