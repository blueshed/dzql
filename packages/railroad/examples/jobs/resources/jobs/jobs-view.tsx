/**
 * The jobs on the page: the list (`#/`), a job's own page (`#/jobs/:id`) and a new job's form
 * (`#/jobs/new`). Each component runs once and returns real nodes; what changes later is a signal
 * or a function bound in the JSX, never a re-render.
 */
import { batch, computed, inject, list, navigate, signal, when, type JSX, type ReadonlySignal } from "@blueshed/railroad";
import type { Job } from "./jobs-api";
import { detail, failedCount, FEED, job, jobs, logOf } from "./jobs";
import { runners } from "../runners/runners";

const STATUSES = ["all", "queued", "running", "passed", "failed"];

/** Every job, live: filtered by name and status, sorted by id or progress. */
export function JobsPage(): JSX.Element {
  const search = signal("");
  const status = signal("all");
  const sort = signal({ by: "id", desc: false });

  // Derived in the component body, beside what reads it: a fresh array on every change, so it
  // follows the feed's touch()
  const shown = computed(() => {
    const q = search.get().toLowerCase();
    const s = status.get();
    const { by, desc } = sort.get();
    const out = jobs.get().filter((j) => (s === "all" || j.status === s) && j.name.toLowerCase().includes(q));
    const key = (j: Job) => (by === "progress" ? j.progress : j.id);
    return out.sort((a, b) => (key(a) - key(b)) * (desc ? -1 : 1));
  });

  return (
    <section class="jobs">
      <form class="filters" onsubmit={(e) => e.preventDefault()}>
        {/* oninput: per keystroke */}
        <input type="search" placeholder="filter by name" value={search} oninput={(e) => search.set(e.currentTarget.value)} />
        {/* the value is applied after the options, so it finds its own */}
        <select class="status" value={status} onchange={(e) => status.set(e.currentTarget.value)}>
          {STATUSES.map((s) => <option value={s}>{s}</option>)}
        </select>
        <select class="sort" onchange={(e) => sort.update((s) => ({ ...s, by: e.currentTarget.value }))}>
          <option value="id">by id</option>
          <option value="progress">by progress</option>
        </select>
        <button type="button" class="direction" onclick={() => sort.mutate((s) => { s.desc = !s.desc; })}>
          {sort.map((s) => (s.desc ? "↓" : "↑"))}
        </button>
        {/* two writes, one pass: what reads both runs once */}
        <button type="button" class="clear" onclick={() => batch(() => { search.set(""); status.set("all"); })}>
          clear
        </button>
      </form>
      {when(failedCount, (n$) => <p class="banner">{n$.map((n) => `${n} failed`)}</p>)}
      <p class="summary">{() => `${shown.get().length} of ${jobs.get().length} jobs`}</p>
      <ul class="rows">
        {list(shown, (j) => j.id, (job$) => <JobRow job$={job$} />, { equals: () => false })}
      </ul>
      {when(() => shown.get().length === 0, () => <p class="empty">No jobs match.</p>)}
    </section>
  );
}

/** A row: everything read through `job$`, the row's signal. */
function JobRow({ job$ }: { job$: ReadonlySignal<Job> }): JSX.Element {
  const feed = inject(FEED);
  const id = job$.peek().id; // the key: it never changes, so read once
  // A string style, not an object: every row's projections re-run on each patch (equals: () =>
  // false), and an unchanged string stops there, where a fresh object would set every row's style
  return (
    <li class={job$.map((j) => `job ${j.status}`)} data-id={id}
        style={job$.map((j) => `--progress: ${j.progress}%`)}>
      <a href={`#/jobs/${id}`}>#{id}</a>
      {/* onchange: on commit (Enter, or leaving the field), not per keystroke */}
      <input class="name" aria-label="name" value={job$.map((j) => j.name)}
             onchange={(e) => feed.send({ op: "rename", id, name: e.currentTarget.value })} />
      <span class="status">{job$.map((j) => j.status)}</span>
      <span class="progress">{job$.map((j) => (j.status === "running" ? `${j.progress}%` : null))}</span>
      <button class="retry" disabled={job$.map((j) => j.status !== "failed")}
              onclick={() => feed.send({ op: "retry", id })}>retry</button>
      <button class="remove" onclick={() => feed.send({ op: "remove", id })}>remove</button>
    </li>
  );
}

/**
 * `#/jobs/:id`, a keyed route: each id its own run, the last one disposed. Async, so it resolves
 * to a thunk, which railroad runs under a scope it owns. Routes match segments only, so
 * `#/jobs/3?log` gives the id `3?log`: the query is split off here.
 */
export async function JobPage({ id: param = "" }: Record<string, string>): Promise<() => JSX.Element> {
  const [id = "", query] = param.split("?");
  const d = await detail(id); // a 404 throws: routes()' onError draws it
  return () => (
    <article class="detail" data-id={d.id}>
      <h2>#{d.id} {d.name}</h2>
      <JobLive id={d.id} />
      <input class="command" readonly value={d.command} aria-label="command" />
      {query === "log"
        ? <JobLog id={d.id} fallback={() => <p class="waiting">The log comes when the job ends…</p>} />
        : <a class="show-log" href={`#/jobs/${d.id}?log`}>show the log</a>}
    </article>
  );
}

/** The job as the feed has it now, or word that it has gone. */
function JobLive({ id }: { id: number }): JSX.Element {
  // job(id) changes in place, so its projection says equals: () => false (jobs.ts)
  return when(job(id), (j$) => (
    <div class="live" style={j$.map((j) => ({ "--accent": `var(--${j.status})` }))}>
      <Ring progress$={j$.map((j) => j.progress)} />
      <p class="status">{j$.map((j) => j.status)}</p>
    </div>
  ), () => <p class="gone">This job has been removed.</p>);
}

/** Progress as a ring: SVG tags get their namespace wherever they are made; `<title>` is adopted. */
function Ring({ progress$ }: { progress$: ReadonlySignal<number> }): JSX.Element {
  return (
    <svg class="ring" viewBox="0 0 36 36" width="72" height="72">
      <title>{progress$.map((p) => `${p}% done`)}</title>
      <circle class="track" cx="18" cy="18" r="16" />
      <circle class="done" cx="18" cy="18" r="16" pathLength="100"
              stroke-dasharray={progress$.map((p) => `${p} 100`)} />
    </svg>
  );
}

/** An async component: shown by its fallback until the log comes, then by the thunk it resolves to. */
async function JobLog({ id }: { id: number }): Promise<() => JSX.Element> {
  const lines = await logOf(id);
  // fetched once and never changed: a plain .map is right for a static array
  return () => <pre class="log" tabindex="0">{lines.map((l) => <div>{l}</div>)}</pre>;
}

/** `#/jobs/new`, declared before `#/jobs/:id` so "new" is not an id. Async: it loads the runners first. */
export async function NewJobPage(): Promise<() => JSX.Element> {
  const all = await runners();
  return () => {
    const feed = inject(FEED);
    let name!: HTMLInputElement;
    let runner!: HTMLSelectElement;
    const roomiest = all.reduce((a, b) => (b.slots > a.slots ? b : a)).name;
    return (
      <form class="new" onsubmit={(e) => {
        e.preventDefault();
        feed.send({ op: "add", name: name.value, runner: runner.value });
        navigate("/"); // synchronous: the list is drawn when it returns
      }}>
        <input ref={(el) => (name = el)} required placeholder="name" aria-label="name" />
        {/* value after children: the roomiest runner is chosen, not the first */}
        <select ref={(el) => (runner = el)} value={roomiest} aria-label="runner">
          {all.map((r) => <option value={r.name}>{r.name}</option>)}
        </select>
        <button>add</button>
      </form>
    );
  };
}
