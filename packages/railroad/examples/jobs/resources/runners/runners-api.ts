/**
 * Runners, the server side: the machines the jobs run on. Read-only, so plain HTTP: they are
 * looked up, not watched.
 */
import type { BunRequest } from "bun";

export type Runner = { name: string; host: string; slots: number };

/** The runners, in the order a new job's form offers them. */
export const RUNNERS: Runner[] = [
  { name: "mac", host: "ci-mac.local", slots: 1 },
  { name: "linux", host: "ci-linux.local", slots: 2 },
  { name: "windows", host: "ci-win.local", slots: 1 },
];

export const runnersApi = {
  /** GET /api/runners: every runner. */
  list: () => Response.json(RUNNERS),

  /** GET /api/runners/:name: one runner. */
  get: (req: BunRequest<"/api/runners/:name">) => {
    const runner = RUNNERS.find((r) => r.name === req.params.name);
    return runner ? Response.json(runner) : new Response("no such runner", { status: 404 });
  },
};
