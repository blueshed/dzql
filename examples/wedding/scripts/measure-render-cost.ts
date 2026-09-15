// Measures what one household write costs on the wire for everyone else connected: a guest's
// top changed to green, with the sender's own household open in a second tab, the couple on
// their home, another household on its box, and a third on the everyone page. Not a test -- a
// report. Run with `DB_PATH=:memory: bun examples/wedding/scripts/measure-render-cost.ts`.
import { createServer } from "../../../src/server";
import * as boardDoc from "../documents/board";
import * as householdDoc from "../documents/household";
import { example } from "../index";

const server = createServer(example, 0);

const queues = new WeakMap<WebSocket, string[]>();
const waiters = new WeakMap<WebSocket, ((raw: string) => void)[]>();

function connect(): WebSocket {
  const url = new URL("/ws", server.url);
  url.protocol = "ws:";
  // @ts-expect-error Bun's runtime-only `headers` option on WebSocket
  const ws: WebSocket = new WebSocket(url, { headers: { Cookie: `session_id=${crypto.randomUUID()}` } });
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

const send = (ws: WebSocket, doc: string, ops: unknown[]) => ws.send(JSON.stringify({ doc, ops }));

async function enter(code: string, page?: string): Promise<WebSocket> {
  const ws = connect();
  await new Promise((resolve) => ws.addEventListener("open", resolve, { once: true }));
  await nextMessage(ws); // the welcome
  send(ws, "session", [{ op: "replace", path: "/code", value: code }]);
  await nextMessage(ws); // patch
  await nextMessage(ws); // the page
  if (page !== undefined) {
    send(ws, "session", [{ op: "replace", path: "/page", value: page }]);
    await nextMessage(ws);
    await nextMessage(ws);
  }
  return ws;
}

// Two households of the script's own, so the seed is untouched.
const emails = [0, 1].map((i) => `measure-${Date.now()}-${i}@example.com`);
for (const email of emails) boardDoc.patch("DASH", [{ op: "add", path: "/households/-", value: { email, names: "Ada Measure, Femi Measure" } }], "setup");
const [mine, theirs] = emails.map((email) => boardDoc.read("DASH")!.households.find((h) => h.email === email)!);
householdDoc.patch(mine!.code, [{ op: "replace", path: "/answer", value: "yes" }], "setup");
const guest = householdDoc.read(mine!.code)!.guests[1]!.id;

const sender = await enter(mine!.code);
send(sender, "session", [{ op: "replace", path: "/focus", value: guest }]); // the drawer open, as it would be
await nextMessage(sender);
await nextMessage(sender);
const audience: [string, WebSocket][] = [
  ["the same household, a second tab on its box", await enter(mine!.code)],
  ["the couple, on their home", await enter("DASH")],
  ["another household, on its box", await enter(theirs!.code)],
  ["another household, on the everyone page", await enter(theirs!.code, "everyone")],
];
for (const [, ws] of audience) queues.get(ws)!.length = 0;
queues.get(sender)!.length = 0;

/** Everything that arrives for this socket within a beat of the write. */
async function collect(ws: WebSocket): Promise<string[]> {
  await Bun.sleep(150);
  return queues.get(ws)!.splice(0);
}

send(sender, "household", [{ op: "replace", path: `/guests/${guest}/minifigure/top`, value: "#7FAE4E" }]);
const bytes = (raws: string[]) => raws.reduce((n, raw) => n + Buffer.byteLength(raw, "utf8"), 0);
const kinds = (raws: string[]) => raws.map((raw) => { const m = JSON.parse(raw); return m.type === "render" ? (m.ops ? `render ops(${m.ops.length})` : "render page") : m.type; }).join(" + ") || "nothing";

console.log("One guest's top changed to green. Bytes sent to:");
const own = await collect(sender);
console.log(`  the sender (drawer open):                           ${String(bytes(own)).padStart(6)} B  ${kinds(own)}`);
for (const [who, ws] of audience) {
  const raws = await collect(ws);
  console.log(`  ${who.padEnd(50)} ${String(bytes(raws)).padStart(6)} B  ${kinds(raws)}`);
}

for (const [, ws] of audience) ws.close();
sender.close();
server.stop(true);
