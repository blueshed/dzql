// Measures what one household write costs on the wire for everyone else connected: a guest's
// top changed to green, with the sender's own household open in a second tab, the couple on
// their photo of families, another household on its photo, and a third reading everyone's. Not a
// test -- a report. Run with `DB_PATH=:memory: bun examples/wedding/scripts/measure-render-cost.ts`;
// with `--json`, what the README says (src/costs.ts, `bun run costs`).
import { tap, type Measured } from "../../../src/costs";
import { createServer } from "../../../src/server";
import { asCouple, asHousehold, board, household } from "../setup";
import { example } from "../index";

const server = createServer(example, 0);
const wire = await tap(server.port!); // what crosses it, as sent: every socket goes through it
const sessions = new WeakMap<WebSocket, string>();

const queues = new WeakMap<WebSocket, string[]>();
const waiters = new WeakMap<WebSocket, ((raw: string) => void)[]>();

function connect(): WebSocket {
  const session = crypto.randomUUID();
  // @ts-expect-error Bun's runtime-only `headers` option on WebSocket
  const ws: WebSocket = new WebSocket(wire.url, { headers: { Cookie: `session_id=${session}` } });
  sessions.set(ws, session);
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
for (const email of emails) await asCouple([{ op: "add", path: "/households/-", value: { email, names: "Ada Measure, Femi Measure" } }]);
const households = (await board()).households;
const [mine, theirs] = emails.map((email) => households.find((h) => h.email === email)!);
await asHousehold(mine!.code, [{ op: "replace", path: "/answer", value: "yes" }]);
const guest = (await household(mine!.code)).guests[1]!.id;

const sender = await enter(mine!.code);
send(sender, "session", [{ op: "replace", path: "/page", value: `?guest=${guest}` }]); // the drawer open, as it would be
await nextMessage(sender);
await nextMessage(sender);
const audience: [string, WebSocket][] = [
  ["the same household's second tab, on its photo", await enter(mine!.code)],
  ["the couple, on their photo of families", await enter("DASH")],
  ["another household, on its photo", await enter(theirs!.code)],
  ["another household, reading everyone", await enter(theirs!.code, "everyone")],
];
for (const ws of [sender, ...audience.map(([, ws]) => ws)]) await heard(ws);

send(sender, "household", [{ op: "replace", path: `/guests/${guest}/minifigure/top`, value: "#7FAE4E" }]);
const own = await heard(sender); // once the sender is answered, everyone else has been sent theirs
const incoming = await Promise.all(audience.map(async ([who, ws]) => [who, await heard(ws), ws] as const));
const bytes = (raws: string[]) => raws.reduce((n, raw) => n + Buffer.byteLength(raw, "utf8"), 0);
const kinds = (raws: string[]) => raws.map((raw) => { const m = JSON.parse(raw); return m.type === "render" ? (m.ops ? `render ops(${m.ops.length})` : "render page") : m.type; }).join(" + ") || "nothing";
const sizes = (raws: string[], ws: WebSocket) => wire.heard(sessions.get(ws)!, raws);
const measured: Measured = { name: "The wedding", what: "one guest's top changed to green", to: incoming.map(([who, raws, ws]) => ({ who, heard: sizes(raws, ws) })) };
if (process.argv.includes("--json")) console.log(JSON.stringify(measured));
else {
  console.log("One guest's top changed to green. Bytes sent to:");
  const onWire = (raws: string[], ws: WebSocket) => `${sizes(raws, ws).reduce((n, m) => n + m.sent, 0)} B on the wire`;
  console.log(`  the sender (drawer open):                           ${String(bytes(own)).padStart(6)} B  ${kinds(own)}, ${onWire(own, sender)}`);
  for (const [who, raws, ws] of incoming) console.log(`  ${who.padEnd(50)} ${String(bytes(raws)).padStart(6)} B  ${kinds(raws)}, ${onWire(raws, ws)}`);
}

for (const [, ws] of audience) ws.close();
sender.close();
server.stop(true);
wire.close();
