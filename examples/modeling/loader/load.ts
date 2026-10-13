// bun run model:load <example | path> [--session <file>]
//
// Loads an app that exists into the model on the page, as the person the CLI signed in as
// (`bun run cli login ...`, which keeps the session in .eta-session): every story, then every
// document the stories need, with what it holds and who holds it. Each is a write like any other,
// so whoever watches the page sees the model arrive, and each can be undone. What is written is
// ./writes.ts's; what the app is, ./extract.ts's reading of its code and a run of its stories.
// ETA_URL is the model's server (ws://localhost:3005 in eta).

import { extractSessionFile } from "../../../src/cli/commands";
import { connect, nextMessage, opened, write, type WireMessage } from "../../../src/test-socket";
import type { PatchOp } from "../../../src/json-patch";
import { extract } from "./extract";
import { writesOf } from "./writes";

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

let ids = 0;
/** Sends one write and waits for its own answer: the id of the row it made, or why it was refused. */
async function said(ops: PatchOp[]): Promise<string> {
  const id = ++ids;
  write(ws, "model", ops, id);
  for (let m: WireMessage = await nextMessage(ws); ; m = await nextMessage(ws)) {
    if (m.id !== id) continue;
    if (m.type === "refused") throw new Error(`refused: ${m.reason ?? "no reason given"} (${JSON.stringify(ops[0])})`);
    return String(m.ops?.[0]?.path.split("/")[2]);
  }
}

const storyIds: string[] = [];
for (const s of load.stories) storyIds.push(await said([{ op: "add", path: "/stories/-", value: s }]));
for (const d of load.documents) {
  const id = await said([{ op: "add", path: "/documents/-", value: { name: d.name, root: d.root, own: d.own, held_by: d.held_by, stories: d.serves.map((i) => storyIds[i]), fields: d.fields } }]);
  for (const h of d.holds) await said([{ op: "replace", path: `/documents/${id}/holds/${h.entity}`, value: { under: h.under, fields: h.fields } }]);
}
ws.close();

console.log(`Loaded ${at}: ${load.stories.length} stories, ${load.documents.length} documents.`);
if (load.skipped.length) console.log(`Left out, as no story needs them: ${load.skipped.join(", ")}.`);
process.exit(0);
