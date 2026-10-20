/**
 * The jobs, the client's handle: one signal over every job, kept by the feed.
 *
 * The list can be long, so the feed changes it in place: a known job is changed where it is
 * (`Object.assign`), a new one pushed, and `jobs.touch()` tells whoever reads it. Nothing is
 * cloned. A touch keeps the same references, so whatever reads a job through a projection that
 * returns the job itself says `{ equals: () => false }`: `job(id)` here, and the views' `list()`
 * over these rows (the railroad skill's realtime reference).
 */
import { effect, key, signal, tryInject, type Dispose, type ReadonlySignal } from "@blueshed/railroad";
import type { Command, Feed, Job, JobDetail } from "./jobs-api";

/** Every job, in the order the server made them. Read it; only the feed changes it. */
export const jobs = signal<Job[]>([]);
const byId = new Map<number, Job>();

/** How many have failed: a number, so it follows every touch. Lives as long as the page. */
export const failedCount = jobs.map((all) => all.filter((j) => j.status === "failed").length);

/** What the page sends the feed. Exported once: a second `key("feed")` would be another key. */
export const FEED = key<{ send(cmd: Command): void }>("feed");

/** Told when a job fails, if the page provides it (the toasts do; a unit test need not). */
export const FAILED = key<(id: number) => void>("failed");

/** One job, live, or null once it is removed. A fresh projection: make it in a scope. */
export function job(id: number): ReadonlySignal<Job | null> {
  // The job is the same object after an in-place change, which Object.is would call unchanged
  return jobs.map(() => byId.get(id) ?? null, { equals: () => false });
}

/** Applies what the feed says, in place, and notifies once. */
export function apply(msg: Feed): void {
  const all = jobs.peek(); // peek: changing it is not reading it
  if ("snapshot" in msg) {
    all.splice(0, all.length, ...msg.snapshot);
    byId.clear();
    for (const j of all) byId.set(j.id, j);
  } else if ("removed" in msg) {
    const i = all.findIndex((j) => j.id === msg.removed);
    if (i >= 0) all.splice(i, 1);
    byId.delete(msg.removed);
  } else {
    const known = byId.get(msg.job.id);
    if (!known) {
      all.push(msg.job);
      byId.set(msg.job.id, msg.job);
    } else {
      const was = known.status;
      Object.assign(known, msg.job); // in place: no clone of the list
      if (was !== "failed" && known.status === "failed") tryInject(FAILED)?.(known.id);
    }
  }
  jobs.touch(); // notify, same reference
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
