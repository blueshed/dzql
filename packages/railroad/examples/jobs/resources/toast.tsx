/**
 * Toasts: a word in the corner when a job fails, live until it is dismissed.
 *
 * The feed tells of a failure from its socket's onmessage, and an event handler is not a scope:
 * what a toast builds there (its when() over the job) would never be torn down.
 * So each toast is a custom root, `scoped(build)`: what it makes is in a scope of its own, which
 * dismissing it disposes. (`mount()` would do too, but it appends; the newest toast goes first.)
 */
import { inject, scoped, trackDispose, when, type JSX } from "@blueshed/railroad";
import { FEED, jobs } from "./jobs/jobs";

/** What the feed calls when job `id` fails: a toast in `host`, newest first. */
export function toasts(host: Element): (id: number) => void {
  return (id) => {
    const toast = scoped(() => <Toast id={id} dismiss={() => dismiss()} />);
    const dismiss = () => {
      toast.dispose(); // its effects stop
      toast.value.parentNode?.removeChild(toast.value); // and its node goes: dispose leaves it
    };
    host.prepend(toast.value);
  };
}

function Toast({ id, dismiss }: { id: number; dismiss: () => void }): JSX.Element {
  const feed = inject(FEED);
  const timer = setTimeout(dismiss, 15_000);
  trackDispose(() => clearTimeout(timer)); // a cleanup of the toast's own scope
  return (
    <div class="toast" role="status" data-id={id}>
      {when(jobs.at(id), (j$) => <span class="what">{j$.map((j) => `#${j.id} ${j.name}: ${j.status}`)}</span>,
        () => <span class="what">#{id} has been removed</span>)}
      <button class="retry" onclick={() => feed.send({ op: "retry", id })}>retry</button>
      <button class="dismiss" onclick={dismiss}>dismiss</button>
    </div>
  );
}
