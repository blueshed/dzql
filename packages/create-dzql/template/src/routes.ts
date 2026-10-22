import { rmSync } from "node:fs";
import { pidFile, run, serve } from "@blueshed/delta/serve";
import type { Example } from "dzql/rendering/example";
import { appOf, compose } from "dzql/rendering/server";
import homepage from "./index.html";
import { render } from "./page";
import { delta, store } from "./store";

// Starter: the app is its routes and its resources. The server is delta's: `serve` puts these
// routes and the socket on Bun.serve (with /health and a 404); `run`, at the bottom, is the process
// around it. The page is drawn here, on the server, from the documents the resources look after,
// kept in Postgres (./store.ts: PGlite in this process, or a server at DATABASE_URL).
//
// Nothing yet but its page. Its stories come first (../stories.ts), modelled as they are told (the
// modelling skill, and the model's page at /model), then built here, the least that makes each pass
// (the dzql-app skill): each document a resource of its own in `resources/<name>/` -- its document
// (`<name>-api.ts`, registered with the store, ./store.ts), its rules (`<name>.ts`, listed in `resources`) and
// its part of the page (`<name>-view.ts`, drawn by ./page.ts).
//
// People come in by a link each, no email and no password: `signInLinks` (dzql/rendering/links)
// makes them, `links.route` is the app's "/in/:token", and `startServer` prints `links.say(...)` as
// it starts (the dzql-app skill's reference/signin.md). Passwords only if a story asks for them.

/** The page and its resources: one per document, and the page they draw. */
export const app: Example = {
  name: "starter",
  index: homepage,
  delta,
  resources: [],
  render,
  active: () => false, // nobody writes anything yet
  store, // opened as a server starts, closed as it stops; the stories begin and end each story on it (./store.ts)
};

/** The server: on `PORT` (3000), its store at `DATABASE_URL` (in development and the tests, PGlite in the data folder: `DATA_PATH`, else data/), and with `--model` (`bun dev`) the model's page beside the app. */
export async function startServer({ port = Number(process.env.PORT ?? 3000), model = process.argv.includes("--model"), dataDir = process.env.DATA_PATH ?? `${import.meta.dir}/../data` } = {}) {
  // in development (`bun dev`), the model's page beside the app at /model; production never registers it
  const modelling = model && (await (await import("dzql/model")).modelRoute({ port: String(port) }));
  return serve(
    compose(
      await appOf(app, { dataDir }), // "/", its socket "/ws", and the documents on it: its store opened in the data folder, and closed as the server stops
      // what isn't communication is an HTTP route: { routes: { "/api/<name>": { GET: ... } } }, from its resource
      modelling,
    ),
    { port },
  );
}

// `run` refuses to start over a live pid in .server.pid (a second `bun dev`); in production the
// platform keeps one server, and a container's file can outlive it, its pid (often 1) reused: no guard
if (import.meta.main && process.env.NODE_ENV === "production") rmSync(pidFile(), { force: true });
if (import.meta.main) await run(startServer);
