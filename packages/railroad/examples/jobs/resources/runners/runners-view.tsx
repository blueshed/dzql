/**
 * The runners on the page: `#/runners/*`, a layout that stays mounted while `route()` picks the
 * runner inside it, so moving from one runner to another rebuilds nothing.
 */
import { computed, effect, list, route, signal, when, type JSX, type ReadonlySignal } from "@blueshed/railroad";
import { jobs } from "../jobs/jobs";
import type { Runner } from "./runners-api";
import { runner } from "./runners";

export function RunnersPage(): JSX.Element {
  const at = route<{ name: string }>("/runners/:name"); // null when no runner is picked
  // The runners the jobs name: an array that changes, so it goes through list(), keyed by name
  const names = jobs.map((all) => [...new Set(all.map((j) => j.runner))].sort());
  return (
    <section class="runners">
      <nav>
        {list(names, (n) => n, (name$) => (
          <a href={name$.map((n) => `#/runners/${n}`)}
             class={() => (at.get()?.name === name$.get() ? "picked" : "")}>{name$}</a>
        ))}
      </nav>
      {/* rebuilt only when a runner is picked or unpicked: from one to another, at$ follows */}
      {when(at, (at$) => <RunnerPanel name$={at$.map((a) => a.name)} />, () => <p class="pick">Pick a runner.</p>)}
    </section>
  );
}

function RunnerPanel({ name$ }: { name$: ReadonlySignal<string> }): JSX.Element {
  const info = signal<Runner | null>(null);

  // An effect is synchronous: it starts the request and writes what comes back to a signal. Each
  // run opens a fresh one, which is the intent (it follows name$), and its cleanup aborts it, so
  // the answer for a runner left behind never lands.
  effect(() => {
    const ctl = new AbortController();
    info.set(null);
    runner(name$.get(), ctl.signal).then((r) => info.set(r), (err) => {
      if (!ctl.signal.aborted) console.error(err);
    });
    return () => ctl.abort();
  });

  // Made beside the effect, not in it: a run disposes what its body made before the next run, and
  // a computed kept from one would read stale (in development, it says so)
  const theirs = computed(() => jobs.get().filter((j) => j.runner === name$.get()));

  return (
    <div class="runner">
      <h2>{name$}</h2>
      {when(info, (i$) => <p class="host">{i$.map((i) => `${i.host} · ${i.slots} slots`)}</p>,
        () => <p class="host">looking it up…</p>)}
      <ul>
        {list(theirs, jobs.key, ({ id, name, status }) => (
          <li><a href={`#/jobs/${id.peek()}`}>#{id} {name}: {status}</a></li>
        ))}
      </ul>
    </div>
  );
}
