/**
 * The jobs on the page: the list (`#/`), a job's own page (`#/jobs/:id`) and a new job's form
 * (`#/jobs/new`). Each component runs once and returns real nodes; what changes later is a signal
 * or a function bound in the JSX, never a re-render. What comes later, from the server, is a
 * signal too: `resolved(promise)`, shown by `when()`.
 */
import { batch, computed, inject, list, navigate, resolved, signal, when, type JSX, type ReadonlySignal, type Row } from "@blueshed/railroad";
import type { Job } from "./jobs-api";
import { detail, failedCount, FEED, jobs, logOf } from "./jobs";
import { runners } from "../runners/runners";

const STATUSES = ["all", "queued", "running", "passed", "failed"];

/** Every job, live: filtered by name and status, sorted by id or progress. */
export function JobsPage(): JSX.Element {
  const search = signal("");
  const status = signal("all");
  const sort = signal({ by: "id", desc: false });

  // Derived in the component body, beside what reads it. A changed job is a new object and the
  // others are as they were, so list() below updates that one row however these are sorted
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
        {list(shown, jobs.key, (job) => <JobRow job={job} />)}
      </ul>
      {when(() => shown.get().length === 0, () => <p class="empty">No jobs match.</p>)}
    </section>
  );
}

/** A row: its fields, each a signal, so it is taken apart and each field bound where it shows. */
function JobRow({ job }: { job: Row<Job> }): JSX.Element {
  const feed = inject(FEED);
  const { name, status, progress } = job;
  const id = job.id.peek(); // the key: it never changes, so read once
  return (
    <li class={status.map((s) => `job ${s}`)} data-id={id} style={progress.map((p) => `--progress: ${p}%`)}>
      <a href={`#/jobs/${id}`}>#{id}</a>
      {/* onchange: on commit (Enter, or leaving the field), not per keystroke */}
      <input class="name" aria-label="name" value={name}
             onchange={(e) => feed.send({ op: "rename", id, name: e.currentTarget.value })} />
      <span class="status">{status}</span>
      <span class="progress">{() => (status.get() === "running" ? `${progress.get()}%` : null)}</span>
      <button class="retry" disabled={status.map((s) => s !== "failed")}
              onclick={() => feed.send({ op: "retry", id })}>retry</button>
      <button class="remove" onclick={() => feed.send({ op: "remove", id })}>remove</button>
    </li>
  );
}

/**
 * `#/jobs/:id`: keyed, as a route is, so each id runs it again and the last run is disposed.
 * The job comes later, so it is a signal: `resolved()` is null until it settles, and `when()`
 * shows it. The handler stays synchronous, so what the branch builds is in the route's scope
 * however late the job comes. Routes match segments only, so `#/jobs/3?log` gives the id `3?log`:
 * the query is split off here.
 */
export function JobPage({ id: param = "" }: Record<string, string>): JSX.Element {
  const [id = "", query] = param.split("?");
  if (!/^\d+$/.test(id)) throw new Error(`#${id} is not a job's number.`); // routes()' onError draws it
  return when(resolved(detail(id)), (r$) => {
    const r = r$.peek(); // settled: it never changes again
    if ("error" in r) return <p class="error">{r.error instanceof Error ? r.error.message : "Something went wrong."}</p>;
    const d = r.value;
    return (
      <article class="detail" data-id={d.id}>
        <h2>#{d.id} {d.name}</h2>
        <JobLive id={d.id} />
        <input class="command" readonly value={d.command} aria-label="command" />
        {query === "log" ? <JobLog id={d.id} /> : <a class="show-log" href={`#/jobs/${d.id}?log`}>show the log</a>}
      </article>
    );
  }, () => <p class="loading">Loading #{id}…</p>);
}

/** The job as the feed has it now, or word that it has gone. */
function JobLive({ id }: { id: number }): JSX.Element {
  // told when this job changes, and not when another does
  return when(jobs.at(id), (j$) => (
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

/** The log, once the job has ended: waiting until the server answers, then the lines. */
function JobLog({ id }: { id: number }): JSX.Element {
  return when(resolved(logOf(id)), (r$) => {
    const r = r$.peek();
    if ("error" in r) return <p class="error">The log is not there.</p>;
    // fetched once and never changed: a plain .map is right for a static array
    return <pre class="log" tabindex="0">{r.value.map((l) => <div>{l}</div>)}</pre>;
  }, () => <p class="waiting">The log comes when the job ends…</p>);
}

/** `#/jobs/new`, declared before `#/jobs/:id` so "new" is not an id. The form waits for the runners. */
export function NewJobPage(): JSX.Element {
  const feed = inject(FEED);
  let name!: HTMLInputElement;
  let runner!: HTMLSelectElement;
  return when(resolved(runners()), (r$) => {
    const r = r$.peek();
    if ("error" in r) return <p class="error">The runners could not be loaded.</p>;
    const all = r.value;
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
          {all.map((one) => <option value={one.name}>{one.name}</option>)}
        </select>
        <button>add</button>
      </form>
    );
  });
}
