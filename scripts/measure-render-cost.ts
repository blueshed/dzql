// Measures what request 5 (morph, don't replace) actually costs on the
// wire: a room write now broadcasts a patch echo *and* a full re-render to
// every member, where before it broadcast a patch echo and a single
// appended <li>. Not a test -- a report. Run with `bun scripts/measure-render-cost.ts`.
import { patch as patchRoom } from "../src/documents/room";
import { patchMessage } from "../src/json-patch";
import { createServer } from "../src/server";

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

// Seed history directly (bypassing the wire) so only the final message's
// cost is measured, not 100 round trips.
for (let i = 0; i < HISTORY - 1; i++) {
  patchRoom(room, [{ op: "add", path: "/transcript/-", value: { name: "Seed", text: `message ${i}` } }], "seed");
}

const server = createServer(0);

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

// Every member that joins the room after this one triggers an unsolicited
// presence re-render for everyone already in it -- drain those stray
// leftovers before measuring, or they'd be mistaken for the message below.
function drain(ws: WebSocket): void {
  queues.get(ws)!.length = 0;
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
  await nextMessage(ws); // people broadcast
  await nextMessage(ws); // full chat view
  members.push(ws);
}

const [sender, ...others] = members;
members.forEach(drain);
const text = "the message actually being measured";

// Subscribe before triggering, per each member's own queue -- order per
// socket is preserved by the FIFO queue regardless of when we ask.
const incoming = others.map((ws) => [nextMessage(ws), nextMessage(ws)] as const);
send(sender!, "room", [{ op: "add", path: "/transcript/-", value: text }]);
await nextMessage(sender!); // sender's own patch echo
await nextMessage(sender!); // sender's own render

let afterPatchBytes = 0;
let afterRenderBytes = 0;
for (const [patchP, renderP] of incoming) {
  const [patchRaw, renderRaw] = await Promise.all([patchP, renderP]);
  afterPatchBytes += Buffer.byteLength(patchRaw, "utf8");
  afterRenderBytes += Buffer.byteLength(renderRaw, "utf8");
}

const afterPatchAvg = afterPatchBytes / others.length;
const afterRenderAvg = afterRenderBytes / others.length;

// Reconstruct what request 2-4's behavior would have cost: the same patch
// echo, plus a single appended <li> instead of a full render.
const appendHtml = `<li><strong>${escapeHtml("Member0")}:</strong> ${escapeHtml(text)}</li>`;
const appendPayload = JSON.stringify({ type: "append", selector: ".messages", html: appendHtml });
const patchPayload = patchMessage("room", 999, [{ op: "add", path: "/transcript/-", value: { name: "Member0", text } }]);
const beforeBytes = Buffer.byteLength(patchPayload, "utf8") + Buffer.byteLength(appendPayload, "utf8");

console.log(`Room: ${HISTORY} messages, ${MEMBERS} members. Bytes sent to each *other* member per message:`);
console.log(`  before (request 2-4, patch + append): ${beforeBytes} B`);
console.log(`  after  (request 5, patch + full render): ${(afterPatchAvg + afterRenderAvg).toFixed(0)} B`);
console.log(`    patch echo:  ${afterPatchAvg.toFixed(0)} B (unchanged by request 5)`);
console.log(`    full render: ${afterRenderAvg.toFixed(0)} B (was ${Buffer.byteLength(appendPayload, "utf8")} B as an append)`);

for (const ws of members) ws.close();
server.stop(true);
