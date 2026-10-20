/**
 * The jobs, the client's handle: a collection of every job, keyed by id, kept by the feed.
 *
 * The list can be long, and the feed changes one job at a time: `put` replaces that job and
 * leaves the others as they were, so a keyed `list()` over them updates that row and no other,
 * and `jobs.at(id)` follows one job, told only when it changes (the railroad skill's realtime
 * reference).
 */
import { collection, effect, key, tryInject, type Dispose } from "@blueshed/railroad";
import type { Command, Feed, Job, JobDetail } from "./jobs-api";

/** Every job, in the order the server made them. Read it; only the feed changes it. */
export const jobs = collection((j: Job) => j.id);

/** How many have failed. Lives as long as the page. */
export const failedCount = jobs.map((all) => all.filter((j) => j.status === "failed").length);

/** What the page sends the feed. Exported once: a second `key("feed")` would be another key. */
export const FEED = key<{ send(cmd: Command): void }>("feed");

/** Told when a job fails, if the page provides it (the toasts do; a unit test need not). */
export const FAILED = key<(id: number) => void>("failed");

/** Applies what the feed says: one change, one notification. */
export function apply(msg: Feed): void {
  if ("snapshot" in msg) jobs.set(msg.snapshot);
  else if ("removed" in msg) jobs.remove(msg.removed);
  else {
    const was = jobs.put(msg.job); // the job it replaced, if it was known
    if (was && was.status !== "failed" && msg.job.status === "failed") tryInject(FAILED)?.(msg.job.id);
  }
}

/** Opens the feed at `path`: what it says goes to apply(), what the page sends goes to it. */
export function connect(path: string) {
  const url = new URL(path, location.href);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  const waiting: string[] = []; // sent before the socket is open
  let ws: WebSocket;
  const open = () => {
    ws = new WebSocket(url);
    ws.onopen = () => waiting.splice(0).forEach((m) => ws.send(m));
    ws.onmessage = (ev) => apply(JSON.parse(ev.data));
    ws.onclose = () => setTimeout(open, 1000); // the snapshot on reconnecting puts it right
  };
  open();
  return {
    send(cmd: Command) {
      const m = JSON.stringify(cmd);
      if (ws.readyState === WebSocket.OPEN) ws.send(m);
      else waiting.push(m);
    },
  };
}

async function read<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(res.status === 404 ? "There is no such job." : `${res.url} answered ${res.status}`);
  return (await res.json()) as T;
}

/** A job, and what does not change about it. */
export const detail = (id: string) => fetch(`/api/jobs/${encodeURIComponent(id)}`).then((r) => read<JobDetail>(r));

/** A job's log: the server answers once the job has ended. */
export const logOf = (id: number) => fetch(`/api/jobs/${id}/log`).then((r) => read<string[]>(r));

/** The tab's title says how many have failed. At module level an effect is never disposed: keep its disposer. */
export function watchTitle(): Dispose {
  return effect(() => {
    const n = failedCount.get();
    document.title = n ? `(${n} failed) jobs` : "jobs";
  });
}
