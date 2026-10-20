# jobs

A live list of build jobs. Runners report how their jobs are going, and every open page sees it
as it happens: a WebSocket feed sends each change, and the page changes that one row and no other.
Click a job for its own page, with its log once it has ended; pick a runner to see its jobs; a
job that fails says so in the corner until it is dismissed.

It is the `railroad` skill's worked answer: each rule its reference pages prescribe is here,
working, and `tests/webview-examples.test.ts` asserts what each is about in a real browser.

## What is here

The app is its routes and its resources, as every app is (paintbrush's README, *Routes,
resources and documents*). railroad has no server of its own, so the server is a plain
`Bun.serve`:

```
routes.ts               the app: the page, the API and the feed, given to Bun.serve; run, it is the server
index.html, index.css   the page
app.tsx                 the feed every resource reads, and the routes
resources/jobs/
  jobs-api.ts           the server side: the jobs, the feed (a WebSocket topic), what a runner reports
  jobs.ts               the client's handle: a collection of every job, changed a job at a time by the feed
  jobs-view.tsx         the list, a job's page, a new job's form
resources/runners/
  runners-api.ts        the runners, read-only HTTP
  runners.ts            the client's handle: look one up
  runners-view.tsx      a layout that stays mounted while route() picks the runner
resources/toast.tsx     a custom root for each toast: scoped(build)
tests/jobs.test.tsx     the client's unit tests, on happy-dom (bunfig.toml preloads it)
```

## Run it

From `packages/railroad`:

```sh
bun examples/jobs/routes.ts                   # http://localhost:3000, simulated runners
PORT=3199 bun examples/jobs/routes.ts         # if 3000 is busy
JOBS=5000 bun examples/jobs/routes.ts         # a long list, a row at a time
TICK_MS=0 bun examples/jobs/routes.ts         # no simulated runners: report as one would
curl -X POST localhost:3000/api/jobs/2 -d '{"status":"running","progress":40}'
```

Open it in two tabs: what one does (retry, rename, remove, a new job) the other sees. Each run
starts afresh. `LOG_LEVEL=debug` also logs each command the feed is sent.

```sh
cd examples/jobs && bun test                  # the unit tests
bun build ./examples/jobs/index.html --production --outdir=dist   # the page, with no warnings
```

The heart of it is a collection in `jobs.ts` and a row taken apart in `jobs-view.tsx`:

```tsx
// jobs.ts: every job, by id; the feed replaces the one it names, and the rest are as they were
export const jobs = collection((j: Job) => j.id);
jobs.put(msg.job);

// jobs-view.tsx: a row is its fields, each a signal, bound where it shows
{list(shown, jobs.key, (job) => <JobRow job={job} />)}
const { name, status, progress } = job;
```

## Which rule is where

| Reference page | Shown in |
|---|---|
| setup | `tsconfig.json`, `index.html`, `routes.ts` (the gated `development`), `app.tsx` (`routes()`), the production build |
| signals | `jobs-view.tsx` (`computed`, `.map`, `batch`, `.update`, `.mutate`, `.peek`), `jobs.ts` (`collection`, `.put`), `runners-view.tsx` (an effect's cleanup) |
| scopes | `toast.tsx` (`scoped`, `trackDispose`), `runners-view.tsx` (made beside the effect), `jobs.ts` (`watchTitle`'s disposer) |
| jsx | `jobs-view.tsx` (handlers, `oninput`/`onchange`, props after children, `ref`, `readonly`, style, SVG) |
| async | `jobs-view.tsx` (`JobPage`, `JobLog` and its fallback, `NewJobPage`), `runners-view.tsx` (async work from an effect) |
| when-list | `jobs-view.tsx` (a row taken apart, `jobs.at(id)`), `runners-view.tsx`, `toast.tsx` |
| routes | `app.tsx`, `jobs-view.tsx` (the query split off), `runners-view.tsx` (`route()`) |
| realtime | `jobs.ts`, `jobs-view.tsx` |
| testing | `examples/jobs/tests/jobs.test.tsx`, and railroad's `tests/webview-examples.test.ts` |
| shared-logger | `jobs.ts` (`key`, `tryInject`), `app.tsx` (`provide`), `jobs-api.ts` and `routes.ts` (the logger) |

## Left out

- delta: railroad has no dependency on it. The same page over a delta document is delta's
  kanban example (`packages/delta/examples/kanban`).
- Who may see a job: one person, no auth.
