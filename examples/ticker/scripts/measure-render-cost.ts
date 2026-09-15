// Measures what one tick costs on the wire for each connected viewer, against the same tick as
// a bare data feed. Not a test -- a report. Run with
// `DB_PATH=:memory: TICK_MS=0 bun examples/ticker/scripts/measure-render-cost.ts`
// (TICK_MS=0 keeps the feed quiet so only the measured tick is counted).
import { createServer } from "../../../src/server";
import { example } from "../index";

const VIEWERS = 5;
const server = createServer(example, 0);

const queues = new WeakMap<WebSocket, string[]>();

function connect(): WebSocket {
  const url = new URL("/ws", server.url);
  url.protocol = "ws:";
  // @ts-expect-error Bun's runtime-only `headers` option on WebSocket
  const ws: WebSocket = new WebSocket(url, { headers: { Cookie: `session_id=${crypto.randomUUID()}` } });
  const queue: string[] = [];
  queues.set(ws, queue);
  ws.addEventListener("message", (event) => queue.push(String(event.data)));
  return ws;
}

const viewers: WebSocket[] = [];
for (let i = 0; i < VIEWERS; i++) {
  const ws = connect();
  await new Promise((resolve) => ws.addEventListener("open", resolve, { once: true }));
  viewers.push(ws);
}
await Bun.sleep(100);
for (const ws of viewers) {
  // everyone watches ALPH, so the tick lands on every board
  ws.send(JSON.stringify({ doc: "watchlist", ops: [{ op: "add", path: "/symbols/-", value: "ALPH" }] }));
}
await Bun.sleep(150);
for (const ws of viewers) queues.get(ws)!.length = 0;

const [sender, ...others] = viewers;
sender!.send(JSON.stringify({ doc: "ticker", ops: [{ op: "replace", path: "/ALPH/price", value: 190.11 }] }));
await Bun.sleep(150);

const bytes = (raws: string[]) => raws.reduce((n, raw) => n + Buffer.byteLength(raw, "utf8"), 0);
const kinds = (raws: string[]) => raws.map((raw) => JSON.parse(raw).type).join(" + ") || "nothing";
const feed = JSON.stringify({ s: "ALPH", p: 190.11, t: Date.now() });

console.log(`One tick, ${VIEWERS} viewers watching the symbol. Bytes sent to:`);
console.log(`  the sender:            ${String(bytes(queues.get(sender!)!)).padStart(5)} B  ${kinds(queues.get(sender!)!)}`);
for (const ws of others) console.log(`  another viewer:        ${String(bytes(queues.get(ws)!)).padStart(5)} B  ${kinds(queues.get(ws)!)}`);
console.log(`  (the same tick as a bare JSON feed: ${Buffer.byteLength(feed, "utf8")} B)`);

for (const ws of viewers) ws.close();
server.stop(true);
