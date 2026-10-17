// An app's entry, as `run` and `serve` are meant to be used: what the serve tests start.
import { createWs } from "../../src/server/server";
import { run, serve } from "../../src/server/serve";

await run(() => serve({ ws: createWs(), routes: { "/": new Response("home") } }));
