/**
 * The page: the feed every resource reads, and the routes. Where you are is the URL: `#/` the
 * list, `#/jobs/:id` a job, `#/jobs/new` a new one, `#/runners/:name` a runner.
 */
import { provide, routes, type JSX } from "@blueshed/railroad";
import { connect, FAILED, FEED, watchTitle } from "./resources/jobs/jobs";
import { JobPage, JobsPage, NewJobPage } from "./resources/jobs/jobs-view";
import { RunnersPage } from "./resources/runners/runners-view";
import { toasts } from "./resources/toast";

// One socket for the page; whatever needs it injects it
provide(FEED, connect("/ws"));
provide(FAILED, toasts(document.getElementById("toasts")!));

// A module-level effect lives as long as the page: nothing disposes it, which is the intent
watchTitle();

function NotFound({ path }: { path: string }): JSX.Element {
  return <p class="missing">There is no page at /{path}. <a href="#/">All jobs</a></p>;
}

routes(
  document.getElementById("root")!,
  {
    "/": () => <JobsPage />,
    "/jobs/new": NewJobPage, // before /jobs/:id: the first match wins
    "/jobs/:id": JobPage, // keyed: each id runs it again, the last one disposed
    // A layout opts out of keying, or every runner would remount it: route() picks the runner inside
    "/runners/*": { keyed: false, handler: () => <RunnersPage /> },
    // Keyed too, so its params are the path it matched. A trailing slash is a segment, so
    // #/jobs/1/ lands here.
    "/*": ({ "*": path = "" }) => <NotFound path={path} />,
  },
  { onError: (err) => <p class="error">{err instanceof Error ? err.message : "Something went wrong."}</p> },
);
