// Measures what a room write costs on the wire for every other member: a patch echo and
// then whatever the render is -- a full page (0.12.0 to 0.23.0) or, since renders in parts,
// the one appended <li>. Not a test -- a report. Run with
// `DB_PATH=:memory: bun examples/chat/scripts/measure-render-cost.ts`; with `--json`, what the
// README says (src/costs.ts, `bun run costs`).
import type { Measured } from "../../../src/costs";
import { patchMessage } from "../../../src/json-patch";
import { createServer } from "../../../src/server";
import { example } from "../index";

const MEMBERS = 5;
const HISTORY = 100;
const room = crypto.randomUUID();

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

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

// A persistent per-socket FIFO queue, not a fresh {once:true} listener per
// nextMessage() call -- two messages sent back-to-back (a patch echo
// immediately followed by its render) can both dispatch before this script
// re-subscribes after awaiting the first, silently dropping one.
const queues = new WeakMap<WebSocket, string[]>();
const waiters = new WeakMap<WebSocket, ((raw: string) => void)[]>();

function connect(cookie: string): WebSocket {
  const url = new URL("/ws", server.url);
  url.protocol = "ws:";
  // @ts-expect-error Bun's runtime-only `headers` option on WebSocket
  const ws: WebSocket = new WebSocket(url, { headers: { Cookie: cookie } });

  const queue: string[] = [];
  const pending: ((raw: string) => void)[] = [];
  queues.set(ws, queue);
  waiters.set(ws, pending);

  ws.addEventListener("message", (event) => {
    const raw = String(event.data);
    const waiter = pending.shift();
    if (waiter) waiter(raw);
    else queue.push(raw);
  });

  return ws;
}

function nextMessage(ws: WebSocket): Promise<string> {
  const queue = queues.get(ws)!;
  if (queue.length > 0) return Promise.resolve(queue.shift()!);
  return new Promise((resolve) => waiters.get(ws)!.push(resolve));
}

/**
 * Everything `ws` is sent until the server answers a question asked after it: events are handled
 * one at a time, each once all the one before it set going is done, so nothing it was due is still
 * to come.
 */
async function heard(ws: WebSocket): Promise<string[]> {
  ws.send(JSON.stringify({ type: "inspect" }));
  const raws: string[] = [];
  for (let raw = await nextMessage(ws); JSON.parse(raw).type !== "inspect"; raw = await nextMessage(ws)) raws.push(raw);
  return raws;
}

function send(ws: WebSocket, doc: string, ops: unknown[]) {
  ws.send(JSON.stringify({ doc, ops }));
}

const members: WebSocket[] = [];
for (let i = 0; i < MEMBERS; i++) {
  const ws = connect(`session_id=${crypto.randomUUID()}`);
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
const incoming = await Promise.all(others.map(heard));

const sizes = (raws: string[]) => raws.map((raw) => ({ type: JSON.parse(raw).type as string, bytes: Buffer.byteLength(raw, "utf8") }));
const each = sizes(incoming[0]!);
if (incoming.some((raws) => JSON.stringify(sizes(raws)) !== JSON.stringify(each))) throw new Error("the other members were not all sent the same");
const of = (type: string) => each.filter((m) => m.type === type).reduce((n, m) => n + m.bytes, 0);
const renderKind = incoming[0]!.map((raw) => JSON.parse(raw)).find((m) => m.type === "render")?.ops ? "render in parts" : "full render";

// Reconstruct what request 2-4's behavior would have cost: the same patch
// echo, plus a single appended <li> instead of a full render.
const appendHtml = `<li><strong>${escapeHtml("Member0")}:</strong> ${escapeHtml(text)}</li>`;
const appendPayload = JSON.stringify({ type: "append", selector: ".messages", html: appendHtml });
const patchPayload = patchMessage("room", 999, [{ op: "add", path: "/messages/-", value: { name: "Member0", text } }]);
const beforeBytes = Buffer.byteLength(patchPayload, "utf8") + Buffer.byteLength(appendPayload, "utf8");

const measured: Measured = { name: "Chat", what: `one message in a room of ${HISTORY} messages and ${MEMBERS} members`, to: [{ who: "each other member", heard: each }] };
if (process.argv.includes("--json")) console.log(JSON.stringify(measured));
else {
  console.log(`Room: ${HISTORY} messages, ${MEMBERS} members. Bytes sent to each *other* member per message:`);
  console.log(`  before (request 2-4, patch + append): ${beforeBytes} B`);
  console.log(`  now    (patch + ${renderKind}): ${of("patch") + of("render")} B`);
  console.log(`    patch echo:  ${of("patch")} B`);
  console.log(`    render:      ${of("render")} B (was ${Buffer.byteLength(appendPayload, "utf8")} B as an append)`);
}

for (const ws of members) ws.close();
server.stop(true);
