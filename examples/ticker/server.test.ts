import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { PatchOp } from "../../src/json-patch";
import { createServer } from "../../src/server";
import { hear, type Heard } from "../../src/harness";
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

/** `page`, on a render: the page this connection holds once it is applied, kept as the client keeps it. */
type WireMessage = { type: string; html?: string; doc?: string; version?: number; ops?: unknown[]; page?: string };

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
  let page = "";
  ws.addEventListener("message", (event) => {
    const message = JSON.parse(event.data as string) as WireMessage;
    if (message.type === "render") message.page = page = hear(page, message as Heard);
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
    expect(html).toContain('id="board-count"');
    expect(html).toContain('data-applet="board" data-doc="ticker:market"');
    expect(html).toContain("16 symbols, every quote");
    ws.close();
  });

  test("a tick echoes to every connection and renders nothing: the board takes the ops itself", async () => {
    const a = await open();
    const b = await open();
    const before = market.read().DLTA!.price;
    write(a, "ticker", [{ op: "replace", path: "/DLTA/price", value: before + 1 }]);
    const patch = await expectMessage(a, "patch");
    // a tick says both fields it moves: the last price becomes prev, then the new price
    expect(patch).toMatchObject({ doc: "ticker:market", ops: [{ op: "replace", path: "/DLTA/prev", value: before }, { op: "replace", path: "/DLTA/price", value: before + 1 }] });
    await expectQuiet(a);
    expect(await expectMessage(b, "patch")).toMatchObject({ doc: "ticker:market" });
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

  test("a watchlist write is this session's alone: echoed to it, and answered with the page, so everything that shows it is true; undo and redo walk it", async () => {
    const a = await open();
    const b = await open();
    write(a, "watchlist", [{ op: "add", path: "/symbols/-", value: "echo" }]);
    expect(await expectMessage(a, "patch")).toMatchObject({ doc: "watchlist", ops: [{ op: "add", path: "/symbols/-", value: "ECHO" }] });
    const page = (await expectMessage(a, "render")).page as string;
    expect(page).toContain("&quot;symbols&quot;:[&quot;ECHO&quot;]"); // the board's mount, with its new props
    expect(page).toContain('<span id="board-count">1</span>'); // the count on its head
    expect(page).toContain('<p class="cell-summary">watched, live</p>'); // and the line that said "nothing watched yet"
    await expectQuiet(b);

    write(a, "ledger", [{ op: "remove", path: "/latest" }]);
    expect(await expectMessage(a, "patch")).toMatchObject({ doc: "watchlist", ops: [{ op: "remove", path: "/symbols/0" }] });
    await expectMessage(a, "render");
    write(a, "ledger", [{ op: "add", path: "/latest" }]);
    expect(await expectMessage(a, "patch")).toMatchObject({ doc: "watchlist", ops: [{ op: "add", path: "/symbols/0", value: "ECHO" }] });
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
    expect(first).toMatchObject({ doc: "ticker:market", ops: [{ op: "replace" }, { op: "replace" }] });
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
    const { html: box } = await expectMessage(ws, "render");
    expect(box).toContain('id="clock" data-applet="clock" data-doc="clock" data-props="{&quot;tz&quot;:&quot;Europe/Zurich&quot;}"');
    // the clock is a thing (rule 15): its drawer holds the city, and every zone to choose from
    write(ws, "desk", [{ op: "replace", path: "/page", value: "?clock" }]);
    await expectMessage(ws, "patch");
    const { page: html } = await expectMessage(ws, "render");
    expect(html).toContain('id="city" class="city" data-applet="city-picker" data-doc="clock" data-props="{&quot;tz&quot;:&quot;Europe/Zurich&quot;}"><datalist>');
    expect(html).toContain('<option value="Asia/Tokyo">Tokyo (UTC+09:00)</option>');
    expect(html).toContain('<option value="America/Vancouver">Vancouver (UTC-0');
    expect(html).toContain('<option value="America/Argentina/Salta">Salta, Argentina (UTC-03:00)</option>');
    write(ws, "clock", [{ op: "replace", path: "/tz", value: "Asia/Tokyo" }]);
    expect(await expectMessage(ws, "patch")).toMatchObject({ doc: "clock", ops: [{ op: "replace", path: "/tz", value: "Asia/Tokyo" }] });
    // the applet takes the op for the face; the page says the city too, so the page follows
    expect((await expectMessage(ws, "render")).page).toContain("Tokyo (UTC+09:00)</span>");
    write(ws, "ledger", [{ op: "remove", path: "/latest" }]);
    expect(await expectMessage(ws, "patch")).toMatchObject({ doc: "clock", ops: [{ op: "replace", path: "/tz", value: "Europe/Zurich" }] });
    expect((await expectMessage(ws, "render")).page).toContain("Zurich (UTC+0");
    write(ws, "ledger", [{ op: "add", path: "/latest" }]);
    expect(await expectMessage(ws, "patch")).toMatchObject({ doc: "clock", ops: [{ op: "replace", path: "/tz", value: "Asia/Tokyo" }] });
    await expectMessage(ws, "render");
    await expectQuiet(ws);
    write(ws, "clock", [{ op: "replace", path: "/tz", value: "Mars/Base" }]);
    await expectMessage(ws, "render"); // permitted, not applied: the page, no patch
    write(ws, "clock", [{ op: "remove", path: "/tz" }]);
    await expectMessage(ws, "render"); // refused
    ws.close();
  });

  test("while a symbol's drawer is open, what it says stays true: a tick moves its price, and watching from it turns the offer round", async () => {
    const ws = await open();
    const shown = (m: { html?: string; ops?: unknown[] }) => m.html ?? ((m.ops ?? []) as { html?: string }[]).map((o) => o.html ?? "").join("");
    const drawerOf = (html: string) => html.slice(html.indexOf('id="drawer"'));
    write(ws, "desk", [{ op: "replace", path: "/page", value: "market?symbol=DLTA" }]);
    await expectMessage(ws, "patch");
    expect(drawerOf(shown(await expectMessage(ws, "render")))).toContain("Watched");

    write(ws, "ticker", [{ op: "replace", path: "/DLTA/price", value: 240.5 }]);
    await expectMessage(ws, "patch");
    expect(drawerOf(shown(await expectMessage(ws, "render")))).toContain("240.50"); // the drawer's own price, not only the row's

    write(ws, "watchlist", [{ op: "add", path: "/symbols/-", value: "DLTA" }]);
    await expectMessage(ws, "patch");
    const after = shown(await expectMessage(ws, "render"));
    expect(drawerOf(after)).toContain("Stop watching"); // no longer offering to watch what is watched
    expect(after).toMatch(/id="m-DLTA".*?<span class="note">watching<\/span>/); // and its row in the market says so
    ws.close();
  });

  test("the desk: the market window with find and the eye, the board as a list, a symbol's drawer, the modals that watch and drop", async () => {
    const ws = await open();
    const page = async (ops: PatchOp[]) => {
      write(ws, "desk", ops);
      await expectMessage(ws, "patch");
      return (await expectMessage(ws, "render")).page;
    };
    // the market grown into the window: every quote a row; find dims what the word misses, the eye hides it, closing find lights all
    let html = await page([{ op: "replace", path: "/page", value: "market" }, { op: "replace", path: "/filter/market", value: "charlie" }]);
    expect(html).toContain('class="cell open" data-key="market"');
    expect(html).toContain('class="row tap" id="m-CHRL"');
    expect(html).toContain('class="row tap hushed" id="m-ALPH"');
    expect(html).toContain(">1 of 16</span>");
    html = await page([{ op: "replace", path: "/hide/market", value: true }]);
    expect(html).toMatch(/id="m-ALPH"[^>]* aria-pressed="false" hidden>/);
    html = await page([{ op: "remove", path: "/filter/market" }]);
    expect(html).not.toContain("hushed");
    // a tick sends a session reading the market the one row it moved, and nothing to one on the box
    write(ws, "ticker", [{ op: "replace", path: "/CHRL/price", value: 13.01 }]);
    await expectMessage(ws, "patch");
    expect((await expectMessage(ws, "render")).ops).toMatchObject([{ op: "replace", target: '[data-eta-part="m-CHRL"]' }]);
    // a symbol's drawer offers to watch it; watching it closes nothing but marks it, and the drawer then offers to drop it
    html = await page([{ op: "replace", path: "/page", value: "market?symbol=CHRL" }]);
    expect(html).toContain('aria-label="CHRL"');
    expect(html).toContain('data-write=\'{"doc":"watchlist","op":"add","path":"/symbols/-"}\' data-value="CHRL"');
    write(ws, "watchlist", [{ op: "add", path: "/symbols/-", value: "CHRL" }]);
    await expectMessage(ws, "patch");
    await expectMessage(ws, "render");
    html = await page([{ op: "replace", path: "/page", value: "board?symbol=CHRL" }, { op: "replace", path: "/reading/board", value: "list" }]);
    expect(html).toMatch(/class="row tap" id="b-CHRL"[^>]* aria-pressed="true" data-reveal>/);
    expect(html).toContain("Stop watching");
    // with the drawer open a tick sends the row and the drawer, since the drawer says the price too;
    // with it closed, the row alone
    write(ws, "ticker", [{ op: "replace", path: "/CHRL/price", value: 13.05 }]);
    await expectMessage(ws, "patch");
    const tick = await expectMessage(ws, "render");
    expect(tick.html).toBeUndefined();
    expect(tick.page).toContain("13.05");
    await page([{ op: "replace", path: "/page", value: "board" }]);
    write(ws, "ticker", [{ op: "replace", path: "/CHRL/price", value: 13.07 }]);
    await expectMessage(ws, "patch");
    expect((await expectMessage(ws, "render")).ops).toMatchObject([{ op: "replace", target: '[data-eta-part="b-CHRL"]' }]);
    // dropping asks first, from the drawer: the drawer's layer closes, the modal's opens, the ground
    // goes inert and the site's tag says where -- and none of it is the page
    html = await page([{ op: "replace", path: "/page", value: "board?symbol=CHRL" }]);
    expect(html).toContain(`data-value="board?confirm=CHRL"`);
    write(ws, "desk", [{ op: "replace", path: "/page", value: "board?confirm=CHRL" }]);
    await expectMessage(ws, "patch");
    const asked = await expectMessage(ws, "render");
    expect(asked.html).toBeUndefined();
    const sent = (asked.ops as { op: string; target: string }[]).map((o) => `${o.op} ${/data-eta-part="(.*)"/.exec(o.target)![1]}`);
    expect(sent).toEqual(["tag site", "tag ground", "tag b-CHRL", "replace drawers", "replace modals"]);
    html = asked.page!;
    expect(html).toContain('<dialog open class="modal" aria-label="Stop watching CHRL">');
    expect(html).toContain('class="ground" inert>');
    write(ws, "watchlist", [{ op: "remove", path: "/symbols/0" }]);
    await expectMessage(ws, "patch");
    html = (await expectMessage(ws, "render")).page;
    expect(html).not.toContain('class="modal"');
    expect(html).not.toContain("Stop watching");
    // watching asks which symbol; the add that answers closes the ask
    html = await page([{ op: "replace", path: "/page", value: "board?new" }]);
    expect(html).toContain('<dialog open class="modal" aria-label="Watch a symbol">');
    write(ws, "watchlist", [{ op: "add", path: "/symbols/-", value: "GOLF" }]);
    await expectMessage(ws, "patch");
    html = (await expectMessage(ws, "render")).page;
    expect(html).not.toContain('class="modal"');
    expect(html).toContain('id="b-GOLF"');
    // a stale confirm renders no modal; a drawer for a symbol the market lacks renders none
    html = await page([{ op: "replace", path: "/page", value: "board?confirm=ZZZZ" }]);
    expect(html).not.toContain('class="modal"');
    html = await page([{ op: "replace", path: "/page", value: "board?symbol=ZZZZ" }]);
    expect(html).not.toContain('class="sheet"');
    ws.close();
  });

  test("inspect reports the market, this session's watchlist and its clock", async () => {
    const ws = await open();
    ws.send(JSON.stringify({ type: "inspect" }));
    const inspection = (await expectMessage(ws, "inspect")) as unknown as { docs: { doc: string }[] };
    expect(inspection.docs.map((d) => d.doc)).toEqual(["desk", "ticker:market", "watchlist", "clock"]);
    ws.close();
  });
});
