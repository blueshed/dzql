// Measures what one tick costs on the wire for each connected viewer, against the same tick as
// a bare data feed. Not a test -- a report. Run with
// `DB_PATH=:memory: TICK_MS=0 bun examples/ticker/scripts/measure-render-cost.ts`
// (TICK_MS=0 keeps the feed quiet so only the measured tick is counted); with `--json`, what the
// README says (src/costs.ts, `bun run costs`).
import type { Measured } from "../../../src/costs";
import { createServer } from "../../../src/server";
import { example } from "../index";

const VIEWERS = 5;
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

const viewers: WebSocket[] = [];
for (let i = 0; i < VIEWERS; i++) {
  const ws = connect();
  await new Promise((resolve) => ws.addEventListener("open", resolve, { once: true }));
  // everyone watches ALPH, so the tick lands on every board
  ws.send(JSON.stringify({ doc: "watchlist", ops: [{ op: "add", path: "/symbols/-", value: "ALPH" }] }));
  await heard(ws);
  viewers.push(ws);
}
for (const ws of viewers) await heard(ws); // what one viewer's watching sent the others

const [sender, ...others] = viewers;
sender!.send(JSON.stringify({ doc: "ticker", ops: [{ op: "replace", path: "/ALPH/price", value: 190.11 }] }));
const own = await heard(sender!); // once the sender is answered, every other viewer has been sent theirs
const incoming = await Promise.all(others.map(heard));

const bytes = (raws: string[]) => raws.reduce((n, raw) => n + Buffer.byteLength(raw, "utf8"), 0);
const kinds = (raws: string[]) => raws.map((raw) => JSON.parse(raw).type).join(" + ") || "nothing";
const sizes = (raws: string[]) => raws.map((raw) => ({ type: JSON.parse(raw).type as string, bytes: Buffer.byteLength(raw, "utf8") }));
const feed = JSON.stringify({ s: "ALPH", p: 190.11, t: Date.now() });

const each = sizes(incoming[0]!);
if (incoming.some((raws) => JSON.stringify(sizes(raws)) !== JSON.stringify(each))) throw new Error("the other viewers were not all sent the same");
const measured: Measured = {
  name: "The ticker",
  what: `one price tick with ${VIEWERS} viewers watching its symbol`,
  to: [{ who: "each other viewer", heard: each }],
  against: { what: "the same tick as a bare JSON feed", bytes: Buffer.byteLength(feed, "utf8") },
};
if (process.argv.includes("--json")) console.log(JSON.stringify(measured));
else {
  console.log(`One tick, ${VIEWERS} viewers watching the symbol. Bytes sent to:`);
  console.log(`  the sender:            ${String(bytes(own)).padStart(5)} B  ${kinds(own)}`);
  for (const raws of incoming) console.log(`  another viewer:        ${String(bytes(raws)).padStart(5)} B  ${kinds(raws)}`);
  console.log(`  (the same tick as a bare JSON feed: ${Buffer.byteLength(feed, "utf8")} B)`);
}

for (const ws of viewers) ws.close();
server.stop(true);
