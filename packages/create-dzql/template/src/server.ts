import { Pool } from "pg";
import { createWs } from "@blueshed/delta/server";
import homepage from "./index.html";
import { signInOn } from "./resources/auth/auth-api";
import { postsDocs } from "./resources/posts/posts-api";

/** What signs the tokens people sign in with: JWT_SECRET, which production (`bun run start`) must set. */
function secret(): string {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  if (process.env.NODE_ENV === "production") throw new Error("JWT_SECRET is required in production: a long random string");
  return "a development secret: set JWT_SECRET in production";
}

export async function startServer({
  port = Number(process.env.PORT ?? 3000),
  dev = process.env.NODE_ENV !== "production",
  // The Postgres server (DATABASE_URL); the tests pass one of their own
  pool = undefined as Pool | undefined,
} = {}) {
  const db = pool ?? new Pool({ connectionString: process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/{{name}}" });

  // What a resource opens that must be closed (the documents' listener, the pool), closed once the server stops
  const closing: (() => Promise<void>)[] = [];
  if (!pool) closing.push(() => db.end()); // the pool this server made; one passed in is its giver's

  // The documents, on one WebSocket: a page that opens one is subscribed to every change.
  // Who is at the socket first: register, sign in, sign out, sign in again with a token
  const ws = createWs();
  const auth = await signInOn(ws, db, secret());
  closing.unshift(await postsDocs(ws, db, auth)); // the listener closes before the pool

  const server = Bun.serve({
    port,

    development: dev && {
      hmr: true,      // hot reload in the browser
      console: true,  // echo browser console.log to the terminal
    },

    routes: {
      "/": homepage,

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
