import { run, serve } from "@blueshed/delta/serve";
import { createLocal } from "@blueshed/delta/local";
import type { Example } from "dzql/rendering/example";
import { appOf, compose } from "dzql/rendering/server";
import homepage from "./index.html";
import { render } from "./page";

// Starter: the app is its routes and its resources. The server is delta's: `serve` puts these
// routes and the socket on Bun.serve (with /health and a 404); `run`, at the bottom, is the process
// around it. The page is drawn here, on the server, from the documents the resources look after.
//
// Nothing yet but its page. Its stories come first (./stories.ts), modelled as they are told (the
// modelling skill, and the model's page at /model), then built here, the least that makes each pass
// (the eta-app skill): each document a resource of its own in `resources/<name>/` -- its document
// (`<name>-api.ts`, registered on `delta` below), its rules (`<name>.ts`, listed in `resources`) and
// its part of the page (`<name>-view.ts`, drawn by ./page.ts).

/** The documents, in delta, in this process: each resource registers its own on it. */
export const delta = createLocal();

/** The page and its resources: one per document, and the page they draw. */
export const app: Example = {
  name: "starter",
  index: homepage,
  delta,
  resources: [],
  render,
  active: () => false, // nobody writes anything yet
};

/** The server: on `PORT` (3000), and with `--model` (`bun dev`) the model's page beside the app. */
export async function startServer({ port = Number(process.env.PORT ?? 3000), model = process.argv.includes("--model") } = {}) {
  // in development (`bun dev`), the model's page beside the app at /model; production never registers it
  const modelling = model && (await (await import("dzql/model")).modelRoute({ port: String(port) }));
  return serve(
    compose(
      appOf(app), // "/", its socket "/ws", and the documents on it
      // what isn't communication is an HTTP route: { routes: { "/api/<name>": { GET: ... } } }, from its resource
      modelling,
    ),
    { port },
  );
}

if (import.meta.main) await run(startServer);
