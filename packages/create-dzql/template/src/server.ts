import { Pool } from "pg";
import { createWs } from "@blueshed/delta/server";
import { upgradeWithAuth } from "@blueshed/delta/auth";
import { createDocListener } from "dzql/postgres";
import homepage from "./index.html";
import { prepare } from "./db";
import { signInOn } from "./resources/auth/auth-api";
import { peopleTypes } from "./resources/people/people-api";
import { postsTypes } from "./resources/posts/posts-api";

/** The Postgres server: DATABASE_URL (compose.yml's in development). */
export const databaseUrl = () => process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/{{name}}";

export async function startServer({
  port = Number(process.env.PORT ?? 3000),
  dev = process.env.NODE_ENV !== "production",
  // The tests pass one of their own
  pool = undefined as Pool | undefined,
} = {}) {
  const db = pool ?? new Pool({ connectionString: databaseUrl() });

  // What a resource opens that must be closed (the documents' listener, the pool), closed once the server stops
  const closing: (() => Promise<void>)[] = [];
  if (!pool) closing.push(() => db.end()); // the pool this server made; one passed in is its giver's

  // The documents, on one WebSocket: a page that opens one is subscribed to every change.
  // Who is at the socket: their session cookie, from the link they tapped (or, in development, picked)
  await prepare(db);
  const ws = createWs();
  const auth = await signInOn(ws, db);
  const listener = await createDocListener(ws, db, { auth, types: [...peopleTypes(db, auth), ...postsTypes(db, auth)] });
  closing.unshift(() => listener.destroy()); // the listener closes before the pool

  const server = Bun.serve({
    port,

    development: dev && {
      hmr: true,      // hot reload in the browser
      console: true,  // echo browser console.log to the terminal
    },

    routes: {
      "/": homepage,

      // Link sign-in: the tap, sign out, and in development "Who are you?"
      ...auth.routes,

      // Every document rides this socket, signed in by its cookie
      "/ws": upgradeWithAuth(ws, auth),

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
    auth,
    close,
    /** Stop serving (`force` drops open connections, as Bun's `stop` does), then close what the resources opened. */
    async stop(force?: boolean) {
      await server.stop(force);
      await close();
    },
  };
}
