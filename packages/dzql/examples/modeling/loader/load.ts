// bun run model:load <example | path> [--session <file>]
//
// Loads an app that exists into the model on the page, as the person the CLI signed in as
// (`bun run cli login ...`, which keeps the session in .eta-session): every story, then every
// document the stories need, with what it holds and who holds it. Each is a write like any other,
// so whoever watches the page sees the model arrive, and each can be undone. What is written is
// ./writes.ts's; what the app is, ./extract.ts's reading of its code and a run of its stories.
// ETA_URL is the model's server (ws://localhost:3005 in eta).

import { extractSessionFile } from "dzql/rendering/cli/commands";
import { connect, opened } from "dzql/rendering/test-socket";
import { extract } from "./extract";
import { send, writesOf } from "./writes";

const { sessionFile, rest } = extractSessionFile(process.argv.slice(2));
const [at] = rest;
if (!at) {
  console.error("Usage: bun run model:load <example | path> [--session <file>]");
  process.exit(1);
}
const session = (await Bun.file(sessionFile).text().catch(() => "")).trim();
if (!session) {
  console.error(`No session in ${sessionFile}: sign in first (bun run cli login <email> <password>).`);
  process.exit(1);
}

const load = writesOf((await extract(at)).heart);
const ws = connect({ url: (process.env.ETA_URL ?? "ws://localhost:3005").replace(/^ws/, "http") }, session);
await opened(ws);

await send(ws, load);
ws.close();

console.log(`Loaded ${at}: ${load.stories.length} stories, ${load.documents.length} documents.`);
if (load.skipped.length) console.log(`Left out, as no story needs them: ${load.skipped.join(", ")}.`);
process.exit(0);
