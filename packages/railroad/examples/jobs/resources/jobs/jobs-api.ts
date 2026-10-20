/**
 * Jobs, the server side: the jobs, the feed every page watches, and what a runner reports.
 *
 * The feed is one WebSocket topic. A page that connects is sent every job (`{ snapshot }`), then
 * each change as it happens: `{ job }`, the whole changed row, or `{ removed }`. A page sends its
 * commands on the same socket (`Command`). A runner reports by HTTP, `POST /api/jobs/:id` with
 * `{ status?, progress? }`; with `tick` set, simulated runners report every `tick` ms.
 *
 * The types are shared: the client imports them as types only (`import type`), so none of this
 * reaches the page. railroad's logger needs no DOM: it is the server's too.
 */
import type { BunRequest, Server, WebSocketHandler } from "bun";
import { createLogger, loggedRequest } from "@blueshed/railroad/logger";
import { RUNNERS } from "../runners/runners-api";

export type Status = "queued" | "running" | "passed" | "failed";
export type Job = { id: number; name: string; runner: string; status: Status; progress: number };
/** What the job's page loads once: the row, and what does not change. */
export type JobDetail = Job & { command: string };

/** What the feed sends a page. */
export type Feed = { snapshot: Job[] } | { job: Job } | { removed: number };
/** What a page sends the feed. */
export type Command =
  | { op: "add"; name: string; runner: string }
  | { op: "rename"; id: number; name: string }
  | { op: "retry"; id: number }
  | { op: "remove"; id: number };

const NAMES = ["build api", "build web", "test unit", "test e2e (flaky)", "lint", "deploy docs"];

const log = createLogger("[jobs]");

// loggedRequest takes a plain Request, so a Bun route's typed `req.params` is read back by a cast
// (railroad's todo.jsonl has it)
const idOf = (req: Request) => Number((req as BunRequest<"/api/jobs/:id">).params.id);

export function jobsApi({ tick = 1000, seed = NAMES.length } = {}) {
  const jobs = new Map<number, Job>();
  let nextId = 1;
  const add = (name: string, runner: string): Job => {
    const job: Job = { id: nextId++, name, runner, status: "queued", progress: 0 };
    jobs.set(job.id, job);
    return job;
  };
  for (let i = 0; i < seed; i++) add(NAMES[i % NAMES.length]!, RUNNERS[i % RUNNERS.length]!.name);

  // Who waits for a job's log: it is answered when the job has ended
  const waiting = new Map<number, ((job: Job | null) => void)[]>();
  const ended = (job: Job) => job.status === "passed" || job.status === "failed";

  let server: Server<undefined> | undefined;
  const publish = (msg: Feed) => server?.publish("jobs", JSON.stringify(msg));

  /** Changes a job, tells every page, and answers whoever waits for its log once it has ended. */
  function change(job: Job, fields: Partial<Job>) {
    Object.assign(job, fields);
    publish({ job });
    if (ended(job)) for (const answer of waiting.get(job.id)?.splice(0) ?? []) answer(job);
  }

  function remove(id: number) {
    if (!jobs.delete(id)) return;
    publish({ removed: id });
    for (const answer of waiting.get(id)?.splice(0) ?? []) answer(null);
  }

  // Simulated runners: each takes a queued job while it has a free slot, and moves its running
  // ones on; a flaky job fails half way
  if (tick > 0) {
    setInterval(() => {
      for (const runner of RUNNERS) {
        const mine = [...jobs.values()].filter((j) => j.runner === runner.name);
        let free = runner.slots - mine.filter((j) => j.status === "running").length;
        for (const job of mine) {
          if (job.status === "running") {
            const progress = Math.min(100, job.progress + 20);
            if (job.name.includes("flaky") && progress >= 60) change(job, { status: "failed", progress });
            else change(job, progress === 100 ? { status: "passed", progress } : { progress });
          } else if (job.status === "queued" && free > 0) {
            free--;
            change(job, { status: "running", progress: 0 });
          }
        }
      }
    }, tick);
  }

  const websocket: WebSocketHandler<undefined> = {
    open(ws) {
      ws.subscribe("jobs");
      ws.send(JSON.stringify({ snapshot: [...jobs.values()] } satisfies Feed));
    },
    message(_ws, data) {
      const cmd = JSON.parse(String(data)) as Command;
      log.debug(`${cmd.op} ${"id" in cmd ? `#${cmd.id}` : cmd.name}`); // shown at LOG_LEVEL=debug
      if (cmd.op === "add") {
        publish({ job: add(cmd.name, cmd.runner) });
        return;
      }
      const job = jobs.get(cmd.id);
      if (!job) return;
      if (cmd.op === "rename") change(job, { name: cmd.name });
      else if (cmd.op === "retry" && job.status === "failed") change(job, { status: "queued", progress: 0 });
      else if (cmd.op === "remove") remove(job.id);
    },
  };

  return {
    websocket,
    /** The server whose topic the feed publishes on. */
    attach(to: Server<undefined>) {
      server = to;
    },

    /** GET /api/jobs/:id: the job, and its command. */
    get: loggedRequest("[api]", (req) => {
      const job = jobs.get(idOf(req));
      if (!job) return new Response("no such job", { status: 404 });
      return Response.json({ ...job, command: `bun run ${job.name.split(" ")[0]} --runner=${job.runner}` } satisfies JobDetail);
    }),

    /** POST /api/jobs/:id `{ status?, progress? }`: a runner reports. */
    report: loggedRequest("[api]", async (req) => {
      const job = jobs.get(idOf(req));
      if (!job) return new Response("no such job", { status: 404 });
      const { status, progress } = (await req.json()) as Partial<Job>;
      change(job, { ...(status && { status }), ...(progress !== undefined && { progress }) });
      return Response.json(job);
    }),

    /** GET /api/jobs/:id/log: answered once the job has ended, at once if it has. */
    log: loggedRequest("[api]", async (req) => {
      const job = jobs.get(idOf(req));
      const done = !job || ended(job) ? job ?? null : await new Promise<Job | null>((answer) => {
        waiting.set(job.id, [...(waiting.get(job.id) ?? []), answer]);
      });
      if (!done) return new Response("no such job", { status: 404 });
      return Response.json([`$ bun run ${done.name.split(" ")[0]}`, `on ${done.runner}`, `${done.status} at ${done.progress}%`]);
    }),
  };
}
