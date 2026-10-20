/**
 * Jobs: a live list of build jobs, railroad's worked example. The app is its routes and its
 * resources: this file gives the routes to Bun.serve, and each resource is a folder in resources/.
 * railroad has no server of its own, so this is a plain Bun.serve with a WebSocket feed.
 *
 *   bun examples/jobs/routes.ts                # http://localhost:3000, simulated runners
 *   PORT=3199 bun examples/jobs/routes.ts
 *   JOBS=5000 bun examples/jobs/routes.ts      # a long list, patched in place
 *   TICK_MS=0 bun examples/jobs/routes.ts      # no simulated runners: report with POST /api/jobs/:id
 */
import { createLogger } from "@blueshed/railroad/logger";
import index from "./index.html";
import { jobsApi } from "./resources/jobs/jobs-api";
import { runnersApi } from "./resources/runners/runners-api";

const log = createLogger("[jobs]");

/** The app's server, on `port` (`$PORT`, else 3000; 0 for any free one). */
export function startServer({
  port = Number(process.env.PORT ?? 3000),
  tick = Number(process.env.TICK_MS ?? 1000),
  seed = Number(process.env.JOBS ?? 6),
} = {}) {
  const jobs = jobsApi({ tick, seed });

  const server = Bun.serve({
    port,
    routes: {
      "/": index,
      "/api/jobs/:id": { GET: jobs.get, POST: jobs.report },
      "/api/jobs/:id/log": { GET: jobs.log },
      "/api/runners": { GET: runnersApi.list },
      "/api/runners/:name": { GET: runnersApi.get },
      // The feed every page watches (resources/jobs/jobs-api.ts)
      "/ws": (req, server) => (server.upgrade(req) ? undefined : new Response("a WebSocket only", { status: 400 })),
    },
    websocket: jobs.websocket,
    // Always on in development, and gated: Bun keeps HMR under NODE_ENV=production if it is set
    development: process.env.NODE_ENV !== "production" && { hmr: true, console: true },
  });
  jobs.attach(server);
  return server;
}

if (import.meta.main) log.info(`Listening on ${startServer().url}`);
