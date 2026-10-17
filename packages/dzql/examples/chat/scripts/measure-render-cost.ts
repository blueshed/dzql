// Measures what a room write costs on the wire for every other member: a patch echo and
// then whatever the render is -- a full page (0.12.0 to 0.23.0) or, since renders in parts,
// the one appended <li> -- each as it is and as it crosses the wire, compressed (a `tap` in front
// of the server sees it). Not a test -- a report. Run with
// `DB_PATH=:memory: bun examples/chat/scripts/measure-render-cost.ts`; with `--json`, what the
// README says (src/costs.ts, `bun run costs`).
import { tap, type Measured } from "dzql/modelling/costs";
import { patchMessage } from "dzql/rendering/json-patch";
import { createServer } from "dzql/rendering/server";
import { esc } from "dzql/rendering/html";
import { example } from "../index";
import { connect as socketTo, heard as heardAll, nextMessage, rawOf } from "dzql/rendering/test-socket";

const MEMBERS = 5;
const HISTORY = 100;
const room = crypto.randomUUID();

// Seed history straight into delta (bypassing the wire) so only the final message's cost is
// measured, not 100 round trips.
await example.delta!.call("open", { doc: `room:${room}` });
await example.delta!.call("delta", {
  doc: `room:${room}`,
  ops: Array.from({ length: HISTORY - 1 }, (_, i) => ({ op: "add", path: `/messages/${Bun.randomUUIDv7()}`, value: { name: "Seed", text: `message ${i}`, sent_at: Date.now() } })),
  cursor: "seed",
});
await example.delta!.call("close", { doc: `room:${room}` });

const server = createServer(example, 0);
const wire = await tap(server.port!); // what crosses it, as sent: every socket goes through it
const sessions = new WeakMap<WebSocket, string>();

function connect(): WebSocket {
  const session = crypto.randomUUID();
  const ws = socketTo(wire, session); // through the tap: what crosses the wire is measured as sent
  sessions.set(ws, session);
  return ws;
}

/** Everything `ws` is sent until the server answers a question asked after it, each as it came. */
const heard = async (ws: WebSocket): Promise<string[]> => (await heardAll(ws)).map(rawOf);

function send(ws: WebSocket, doc: string, ops: unknown[]) {
  ws.send(JSON.stringify({ doc, ops }));
}

const members: WebSocket[] = [];
for (let i = 0; i < MEMBERS; i++) {
  const ws = connect();
  await new Promise((resolve) => ws.addEventListener("open", resolve, { once: true }));
  await nextMessage(ws); // name form
  send(ws, "session", [{ op: "replace", path: "/name", value: `Member${i}` }]);
  await nextMessage(ws); // patch echo
  await nextMessage(ws); // room selector
  send(ws, "session", [{ op: "replace", path: "/room", value: room }]);
  await nextMessage(ws); // patch echo of the /room write
  await nextMessage(ws); // full chat view (the joiner is not told of its own arrival: item 8)
  members.push(ws);
}

const [sender, ...others] = members;
// Every member that joins the room after this one triggers an unsolicited presence re-render for
// everyone already in it -- hear those out before measuring, or they'd be mistaken for the message below.
for (const ws of members) await heard(ws);
const text = "the message actually being measured";

send(sender!, "room", [{ op: "add", path: "/messages/-", value: text }]);
await heard(sender!); // the sender's own patch echo and render: once answered, every other member has been sent theirs
const incoming = await Promise.all(others.map(async (ws) => [await heard(ws), ws] as const));

const sizes = ([raws, ws]: (typeof incoming)[number]) => wire.heard(sessions.get(ws)!, raws);
const each = sizes(incoming[0]!);
if (incoming.some((heard) => JSON.stringify(sizes(heard)) !== JSON.stringify(each))) throw new Error("the other members were not all sent the same");
const of = (type: string, size: "bytes" | "sent" = "bytes") => each.filter((m) => m.type === type).reduce((n, m) => n + m[size], 0);
const renderKind = incoming[0]![0].map((raw) => JSON.parse(raw)).find((m) => m.type === "render")?.ops ? "render in parts" : "full render";

// Reconstruct what request 2-4's behavior would have cost: the same patch
// echo, plus a single appended <li> instead of a full render.
const appendHtml = `<li><strong>${esc("Member0")}:</strong> ${esc(text)}</li>`;
const appendPayload = JSON.stringify({ type: "append", selector: ".messages", html: appendHtml });
const patchPayload = patchMessage("room", 999, [{ op: "add", path: "/messages/-", value: { name: "Member0", text } }]);
const beforeBytes = Buffer.byteLength(patchPayload, "utf8") + Buffer.byteLength(appendPayload, "utf8");

const measured: Measured = { name: "Chat", what: `one message in a room of ${HISTORY} messages and ${MEMBERS} members`, to: [{ who: "each other member", heard: each }] };
if (process.argv.includes("--json")) console.log(JSON.stringify(measured));
else {
  console.log(`Room: ${HISTORY} messages, ${MEMBERS} members. Bytes sent to each *other* member per message:`);
  console.log(`  before (request 2-4, patch + append): ${beforeBytes} B`);
  console.log(`  now    (patch + ${renderKind}): ${of("patch") + of("render")} B, ${of("patch", "sent") + of("render", "sent")} B on the wire`);
  console.log(`    patch echo:  ${of("patch")} B, ${of("patch", "sent")} B on the wire`);
  console.log(`    render:      ${of("render")} B, ${of("render", "sent")} B on the wire (was ${Buffer.byteLength(appendPayload, "utf8")} B as an append)`);
}

for (const ws of members) ws.close();
server.stop(true);
wire.close();
