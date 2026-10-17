import { run } from "@blueshed/delta/serve";
import { createServer } from "./server";
import { appDir } from "./names";

const { example } = await import(`${appDir(process.env.ETA_EXAMPLE)}/index.ts`);

// delta's run: the pid file (`bun run stop`), the signals, and the `Listening on` line
await run(() => createServer(example));
