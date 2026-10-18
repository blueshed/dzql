import { run, serve } from "@blueshed/delta/serve";
import { appOf, compose } from "./server";
import { appDir } from "./names";

const { example } = await import(`${appDir(process.env.ETA_EXAMPLE)}/index.ts`);

// delta's run: the pid file (`bun run stop`), the signals, and the `Listening on` line. An app under
// a path (the model's, at /model) is served on its own with the root sending you there.
await run(() => serve(compose(appOf(example), example.at && { routes: { "/": Response.redirect(example.at, 302) } })));
