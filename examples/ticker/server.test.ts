import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { PatchOp } from "../../src/json-patch";
import { createServer } from "../../src/server";
import { randomTick, startFeed, stopFeed } from "./compartments/ticker";
import * as market from "./documents/market";
import { example } from "./index";

// TICK_MS is read when compartments/ticker.ts loads; the test script sets it to 0 (see package.json)
// so the feed stays quiet and every tick here is the test's own.
let server: ReturnType<typeof createServer>;

beforeAll(() => {
  server = createServer(example, 0);
});

afterAll(() => {
  server.stop(true);
});

type WireMessage = { type: string; html?: string; doc?: string; version?: number; ops?: unknown[] };

const queues = new WeakMap<WebSocket, WireMessage[]>();
const waiters = new WeakMap<WebSocket, ((message: WireMessage) => void)[]>();

function connect(): WebSocket {
  const url = new URL("/ws", server.url);
  url.protocol = "ws:";
  // @ts-expect-error Bun's runtime-only `headers` option on WebSocket
  const ws: WebSocket = new WebSocket(url, { headers: { Cookie: `session_id=${crypto.randomUUID()}` } });
  const queue: WireMessage[] = [];
  const pending: ((message: WireMessage) => void)[] = [];
  queues.set(ws, queue);
  waiters.set(ws, pending);
  ws.addEventListener("message", (event) => {
    const message = JSON.parse(event.data as string) as WireMessage;
    const waiter = pending.shift();
    if (waiter) waiter(message);
    else queue.push(message);
  });
  return ws;
}

const opened = (ws: WebSocket) => new Promise<void>((resolve) => ws.addEventListener("open", () => resolve(), { once: true }));

function nextMessage(ws: WebSocket): Promise<WireMessage> {
  const queue = queues.get(ws)!;
  if (queue.length > 0) return Promise.resolve(queue.shift()!);
  return new Promise((resolve) => waiters.get(ws)!.push(resolve));
}

async function expectMessage(ws: WebSocket, type: string): Promise<WireMessage> {
  const message = await nextMessage(ws);
  expect(message.type).toBe(type);
  return message;
}

async function expectQuiet(ws: WebSocket): Promise<void> {
  await Bun.sleep(30);
  expect(queues.get(ws)!).toEqual([]);
}

const write = (ws: WebSocket, doc: string, ops: PatchOp[]) => ws.send(JSON.stringify({ doc, ops }));

async function open(): Promise<WebSocket> {
  const ws = connect();
  await opened(ws);
  await expectMessage(ws, "render");
  return ws;
}

describe("the ticker", () => {
  test("the page carries the clock, the watchlist and the board with the market as props", async () => {
    const ws = connect();
    await opened(ws);
    const { html } = await expectMessage(ws, "render");
    expect(html).toContain('data-applet="clock"');
    expect(html).toContain('id="watchlist"');
    expect(html).toContain('data-applet="board" data-doc="ticker"');
    expect(html).toContain("Symbols: ALPH · BRVO");
    ws.close();
  });

  test("a tick echoes to every connection and renders nothing: the board takes the ops itself", async () => {
    const a = await open();
    const b = await open();
    const before = market.read().DLTA!.price;
    write(a, "ticker", [{ op: "replace", path: "/DLTA/price", value: before + 1 }]);
    const patch = await expectMessage(a, "patch");
    expect(patch).toMatchObject({ doc: "ticker", ops: [{ op: "replace", path: "/DLTA/price", value: before + 1 }] });
    await expectQuiet(a);
    expect(await expectMessage(b, "patch")).toMatchObject({ doc: "ticker" });
    await expectQuiet(b);
    // a tick that changes nothing (the same price) is a render, no patch: the dispatcher's own fallback
    write(a, "ticker", [{ op: "replace", path: "/DLTA/price", value: before + 1 }]);
    await expectMessage(a, "render");
    await expectQuiet(b);
    // a tick is a fact: Undo passes over it to the person's own last write, and the market stands
    write(a, "watchlist", [{ op: "add", path: "/symbols/-", value: "DLTA" }]);
    await expectMessage(a, "patch");
    await expectMessage(a, "render");
    write(a, "ticker", [{ op: "replace", path: "/DLTA/price", value: before + 2 }]);
    await expectMessage(a, "patch");
    await expectMessage(b, "patch");
    write(a, "ledger", [{ op: "remove", path: "/latest" }]);
    expect(await expectMessage(a, "patch")).toMatchObject({ doc: "watchlist", ops: [{ op: "remove", path: "/symbols/0" }] });
    await expectMessage(a, "render");
    expect(market.read().DLTA!.price).toBe(before + 2);
    await expectQuiet(b);
    market.patch([{ op: "replace", path: "/DLTA/price", value: before }], "test");
    a.close();
    b.close();
  });

  test("permit: only a tick on the market; only the watchlist's own two paths", async () => {
    const ws = await open();
    const refused = async (doc: string, ops: PatchOp[]) => {
      write(ws, doc, ops);
      await expectMessage(ws, "render");
      await expectQuiet(ws);
    };
    await refused("ticker", [{ op: "replace", path: "/DLTA/name", value: "x" }]);
    await refused("ticker", [{ op: "remove", path: "/DLTA/price" }]);
    await refused("ticker", [{ op: "add", path: "/NEW/price", value: 1 }]);
    await refused("watchlist", [{ op: "replace", path: "/symbols/0", value: "x" }]);
    await refused("watchlist", [{ op: "add", path: "/symbols/-", value: "NOPE" }]); // permitted, not applied
    ws.close();
  });

  test("a watchlist write is this session's alone: echoed to it, and the list and the board replaced as fragments; undo and redo walk it", async () => {
    const a = await open();
    const b = await open();
    write(a, "watchlist", [{ op: "add", path: "/symbols/-", value: "echo" }]);
    expect(await expectMessage(a, "patch")).toMatchObject({ doc: "watchlist", ops: [{ op: "add", path: "/symbols/-", value: "ECHO" }] });
    const render = await expectMessage(a, "render");
    expect(render.ops).toMatchObject([{ op: "replace", target: "#watchlist" }, { op: "replace", target: "#board" }]);
    expect((render.ops as { html: string }[])[1]!.html).toContain("&quot;symbols&quot;:[&quot;ECHO&quot;]");
    await expectQuiet(b);

    write(a, "ledger", [{ op: "remove", path: "/latest" }]);
    expect(await expectMessage(a, "patch")).toMatchObject({ doc: "watchlist", ops: [{ op: "remove", path: "/symbols/0" }] });
    await expectMessage(a, "render");
    write(a, "ledger", [{ op: "add", path: "/latest" }]);
    expect(await expectMessage(a, "patch")).toMatchObject({ doc: "watchlist", ops: [{ op: "add", path: "/symbols/-", value: "ECHO" }] });
    await expectMessage(a, "render");
    a.close();
    b.close();
  });

  test("the feed: a random walk of one symbol at a time, ticking while it runs, every tick a patch to every connection", async () => {
    const ws = await open();
    for (let i = 0; i < 20; i++) {
      const [op] = randomTick();
      expect(op!.path).toMatch(/^\/[A-Z]{4}\/price$/);
      const symbol = op!.path.split("/")[1]!;
      expect(Math.abs((op!.value as number) / market.read()[symbol]!.price - 1)).toBeLessThan(0.007);
    }
    startFeed(5);
    startFeed(5); // already running: no second interval
    const first = await expectMessage(ws, "patch");
    expect(first).toMatchObject({ doc: "ticker", ops: [{ op: "replace" }] });
    await expectMessage(ws, "patch");
    stopFeed();
    stopFeed(); // already stopped
    await Bun.sleep(20);
    queues.get(ws)!.length = 0;
    await expectQuiet(ws);
    startFeed(0); // no feed at all
    await expectQuiet(ws);
    ws.close();
  });

  test("the clock: the page carries the session's zone and every zone to choose from; a city is a write the applet takes itself; undo and redo walk it", async () => {
    const ws = connect();
    await opened(ws);
    const { html } = await expectMessage(ws, "render");
    expect(html).toContain('id="clock" data-applet="clock" data-doc="clock" data-props="{&quot;tz&quot;:&quot;Europe/Zurich&quot;}"');
    expect(html).toContain('id="city" class="city" data-applet="city-picker" data-doc="clock" data-props="{&quot;city&quot;:&quot;Zurich&quot;}"><datalist>');
    expect(html).toContain('<option value="Asia/Tokyo">Tokyo (UTC+09:00)</option>');
    expect(html).toContain('<option value="America/Vancouver">Vancouver (UTC-0');
    expect(html).toContain('<option value="America/Argentina/Salta">Salta, Argentina (UTC-03:00)</option>');
    write(ws, "clock", [{ op: "replace", path: "/tz", value: "Asia/Tokyo" }]);
    expect(await expectMessage(ws, "patch")).toMatchObject({ doc: "clock", ops: [{ op: "replace", path: "/tz", value: "Asia/Tokyo" }] });
    await expectQuiet(ws); // the applet took it: no render
    write(ws, "ledger", [{ op: "remove", path: "/latest" }]);
    expect(await expectMessage(ws, "patch")).toMatchObject({ doc: "clock", ops: [{ op: "replace", path: "/tz", value: "Europe/Zurich" }] });
    write(ws, "ledger", [{ op: "add", path: "/latest" }]);
    expect(await expectMessage(ws, "patch")).toMatchObject({ doc: "clock", ops: [{ op: "replace", path: "/tz", value: "Asia/Tokyo" }] });
    await expectQuiet(ws);
    write(ws, "clock", [{ op: "replace", path: "/tz", value: "Mars/Base" }]);
    await expectMessage(ws, "render"); // permitted, not applied: the page, no patch
    write(ws, "clock", [{ op: "remove", path: "/tz" }]);
    await expectMessage(ws, "render"); // refused
    ws.close();
  });

  test("inspect reports the market, this session's watchlist and its clock", async () => {
    const ws = await open();
    ws.send(JSON.stringify({ type: "inspect" }));
    const inspection = (await expectMessage(ws, "inspect")) as unknown as { docs: { doc: string }[] };
    expect(inspection.docs.map((d) => d.doc)).toEqual(["ticker", "watchlist", "clock"]);
    ws.close();
  });
});
