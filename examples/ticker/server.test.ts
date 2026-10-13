import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { PatchOp } from "../../src/json-patch";
import { createServer } from "../../src/server";
import { hear, type Heard } from "../../src/harness";
import { randomTick, startFeed, stopFeed } from "./compartments/ticker";
import type { MarketDocument } from "./documents/market";
import { example } from "./index";

const inDelta = example.delta!.as("test");

/** The market as delta has it now. */
async function quotes(): Promise<MarketDocument> {
  return (await inDelta.call("open", { doc: "ticker:market" })).result.quotes;
}

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
type WireMessage = { type: string; html?: string; doc?: string; version?: number; ops?: unknown[]; page?: string; id?: unknown; change?: string };

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

/** Everything a connection was sent until what it asked before is done: an `inspect` is answered after all of it. */
async function heard(ws: WebSocket): Promise<WireMessage[]> {
  ws.send(JSON.stringify({ type: "inspect" }));
  const messages: WireMessage[] = [];
  for (let m = await nextMessage(ws); m.type !== "inspect"; m = await nextMessage(ws)) messages.push(m);
  return messages;
}

/** The page as the connection holds it, once what it asked is done. */
const pageNow = async (ws: WebSocket): Promise<string> => (await heard(ws)).filter((m) => m.type === "render").pop()!.page!;

async function open(): Promise<WebSocket> {
  const ws = connect();
  await opened(ws);
  await expectMessage(ws, "render");
  return ws;
}

describe("the ticker", () => {
  test("the page carries the clock, the watchlist and the board, empty until something is watched", async () => {
    const ws = connect();
    await opened(ws);
    const { html } = await expectMessage(ws, "render");
    expect(html).toContain('data-applet="clock"');
    // an empty board says so once, in its cell's summary: no count of none, no reading of nothing
    expect(html).toContain('<button type="button" class="cell-name" aria-expanded="false">the board</button>');
    expect(html!.match(/nothing watched/gi)).toHaveLength(1);
    expect(html).not.toContain('id="board"');
    // the market's count is on its head, and not again beneath it
    expect(html).toContain('<button type="button" class="cell-name" aria-expanded="false">the market · 16</button>');
    expect(html).toContain('<p class="cell-summary">every quote, live</p>');
    ws.close();
  });

  test("a tick echoes to every connection and renders nothing: the board takes the ops itself", async () => {
    const a = await open();
    const b = await open();
    const { price: before, prev } = (await quotes()).DLTA!;
    write(a, "ticker", [{ op: "replace", path: "/DLTA/price", value: before + 1 }]);
    const patch = await expectMessage(a, "patch");
    // a tick is said as the fields it moves: the last price become prev (unless it was already), and the new price
    const moved = [...(prev === before ? [] : [{ op: "replace", path: "/DLTA/prev", value: before }]), { op: "replace", path: "/DLTA/price", value: before + 1 }];
    expect(patch).toMatchObject({ doc: "ticker:market", ops: moved });
    await expectQuiet(a);
    expect(await expectMessage(b, "patch")).toMatchObject({ doc: "ticker:market" });
    await expectQuiet(b);
    // a tick that changes nothing (the same price) lands nothing, and the page it holds is the page still: nothing is sent
    write(a, "ticker", [{ op: "replace", path: "/DLTA/price", value: before + 1 }]);
    expect(await heard(a)).toEqual([]);
    await expectQuiet(b);
    // a tick is a fact: Undo passes over it to the person's own last write, and the market stands
    write(a, "watchlist", [{ op: "add", path: "/symbols/-", value: "DLTA" }]);
    await expectMessage(a, "patch");
    await expectMessage(a, "render");
    write(a, "ticker", [{ op: "replace", path: "/DLTA/price", value: before + 2 }]);
    // a watches DLTA now, so its board row is told of the quote too, as the row it leaves
    const told = [await expectMessage(a, "patch"), await expectMessage(a, "patch")];
    expect(told.map((m) => m.doc).sort()).toEqual(["quote:DLTA", "ticker:market"]);
    expect(told.find((m) => m.doc === "quote:DLTA")).toMatchObject({ ops: [{ op: "replace", path: "/prev", value: before + 1 }, { op: "replace", path: "/price", value: before + 2 }] });
    await expectMessage(b, "patch");
    write(a, "ledger", [{ op: "remove", path: "/latest" }]);
    expect(await expectMessage(a, "patch")).toMatchObject({ doc: "watchlist", ops: [{ op: "replace", path: "/symbols", value: [] }] });
    await expectMessage(a, "render");
    expect((await quotes()).DLTA!.price).toBe(before + 2);
    await expectQuiet(b);
    a.close();
    b.close();
  });

  test("a tick is a fact: its echo to its writer names no change to undo, where a watch's names one", async () => {
    const a = await open();
    const before = (await quotes()).ALPH!.price;
    a.send(JSON.stringify({ id: 1, doc: "ticker", ops: [{ op: "replace", path: "/ALPH/price", value: before + 1 }] }));
    const tick = await expectMessage(a, "patch");
    expect({ id: tick.id, change: tick.change }).toEqual({ id: 1, change: undefined });
    await expectQuiet(a);
    a.send(JSON.stringify({ id: 2, doc: "watchlist", ops: [{ op: "add", path: "/symbols/-", value: "ALPH" }] }));
    const watch = await expectMessage(a, "patch");
    expect({ id: watch.id, change: typeof watch.change }).toEqual({ id: 2, change: "string" });
    await expectMessage(a, "render");
    a.close();
  });

  test("permit: only a tick on the market; only the watchlist's own two paths", async () => {
    const ws = await open();
    const refused = async (doc: string, ops: PatchOp[]) => {
      write(ws, doc, ops);
      expect(await heard(ws)).toEqual([]); // no patch, and no page: the one it holds is the page still
    };
    await refused("ticker", [{ op: "replace", path: "/DLTA/name", value: "x" }]);
    await refused("ticker", [{ op: "remove", path: "/DLTA/price" }]);
    await refused("ticker", [{ op: "add", path: "/NEW/price", value: 1 }]);
    await refused("watchlist", [{ op: "replace", path: "/symbols/0", value: "x" }]);
    // permitted, and refused with why: the reason is kept in the session's own refusal document
    write(ws, "watchlist", [{ op: "add", path: "/symbols/-", value: "NOPE" }]);
    const said = await heard(ws);
    expect(said.map((m) => m.type)).toEqual(["patch"]); // the box shows no reason, so its page is not sent again
    expect(said[0]).toMatchObject({ doc: "told", ops: expect.arrayContaining([{ op: "replace", path: "/reason", value: "The market does not quote NOPE." }]) });
    ws.close();
  });

  test("a watchlist write is this session's alone: echoed to it, and answered with the page, so everything that shows it is true; undo and redo walk it", async () => {
    const a = await open();
    const b = await open();
    write(a, "watchlist", [{ op: "add", path: "/symbols/-", value: "echo" }]);
    expect(await expectMessage(a, "patch")).toMatchObject({ doc: "watchlist", ops: [{ op: "replace", path: "/symbols", value: ["ECHO"] }] });
    const page = (await expectMessage(a, "render")).page as string;
    expect(page).toContain('<div data-eta-part="quote-ECHO" id="quote-ECHO" class="board-row"><div id="line-ECHO" data-applet="board" data-doc="quote:ECHO" data-under="/quote" data-props='); // the board's new row, on the quote's own document; on the box, the cell is the one tap
    expect(page).toContain('<span id="board-count">1</span>'); // the count on its head
    expect(page).toContain('<p class="cell-summary">watched, live</p>'); // and the line that said "nothing watched yet"
    await expectQuiet(b);

    write(a, "ledger", [{ op: "remove", path: "/latest" }]);
    expect(await expectMessage(a, "patch")).toMatchObject({ doc: "watchlist", ops: [{ op: "replace", path: "/symbols", value: [] }] });
    await expectMessage(a, "render");
    write(a, "ledger", [{ op: "add", path: "/latest" }]);
    expect(await expectMessage(a, "patch")).toMatchObject({ doc: "watchlist", ops: [{ op: "replace", path: "/symbols", value: ["ECHO"] }] });
    await expectMessage(a, "render");
    a.close();
    b.close();
  });

  test("the feed: a random walk of one symbol at a time, ticking while it runs, every tick a patch to every connection", async () => {
    const ws = await open();
    const market = await quotes();
    for (let i = 0; i < 20; i++) {
      const [op] = randomTick(market);
      expect(op!.path).toMatch(/^\/[A-Z]{4}\/price$/);
      const symbol = op!.path.split("/")[1]!;
      expect(Math.abs((op!.value as number) / market[symbol]!.price - 1)).toBeLessThan(0.007);
    }
    startFeed(5);
    startFeed(5); // already running: no second interval
    const first = await expectMessage(ws, "patch");
    expect(first).toMatchObject({ doc: "ticker:market", ops: expect.arrayContaining([{ op: "replace", path: expect.stringMatching(/^\/[A-Z]{4}\/price$/), value: expect.any(Number) }]) });
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
    expect(html).toContain(`id="city" class="city" data-applet="city-picker" data-doc="clock" data-writes='[{"doc":"clock","op":"replace","path":"/tz"}]' data-props="{&quot;tz&quot;:&quot;Europe/Zurich&quot;}"><datalist>`); // the picker says what it writes; the face beside it, nothing
    expect(html).toContain('<option value="Asia/Tokyo">Tokyo (UTC+09:00)</option>');
    expect(html).toContain('<option value="America/Vancouver">Vancouver (UTC-0');
    expect(html).toContain('<option value="America/Argentina/Salta">Salta, Argentina (UTC-03:00)</option>');
    write(ws, "clock", [{ op: "replace", path: "/tz", value: "Asia/Tokyo" }]);
    expect(await expectMessage(ws, "patch")).toMatchObject({ doc: "clock", ops: [{ op: "replace", path: "/tz", value: "Asia/Tokyo" }] });
    // the applet takes the op for the face; the page says the city too (the cell's summary) and the
    // drawer the offset, so the page follows
    const tokyo = (await expectMessage(ws, "render")).page!;
    expect(tokyo).toContain('<p class="cell-summary">Tokyo</p>');
    expect(tokyo).toContain("<span>UTC+09:00</span>");
    write(ws, "ledger", [{ op: "remove", path: "/latest" }]);
    expect(await expectMessage(ws, "patch")).toMatchObject({ doc: "clock", ops: [{ op: "replace", path: "/tz", value: "Europe/Zurich" }] });
    expect((await expectMessage(ws, "render")).page).toContain('<p class="cell-summary">Zurich</p>');
    write(ws, "ledger", [{ op: "add", path: "/latest" }]);
    expect(await expectMessage(ws, "patch")).toMatchObject({ doc: "clock", ops: [{ op: "replace", path: "/tz", value: "Asia/Tokyo" }] });
    await expectMessage(ws, "render");
    await expectQuiet(ws);
    write(ws, "clock", [{ op: "replace", path: "/tz", value: "Mars/Base" }]);
    expect(await heard(ws)).toEqual([]); // permitted, not applied: no patch, and the page unchanged
    write(ws, "clock", [{ op: "remove", path: "/tz" }]);
    expect(await heard(ws)).toEqual([]); // refused
    ws.close();
  });

  test("while a symbol's drawer is open, what it says stays true: a tick moves it, and watching from it turns the offer round", async () => {
    const ws = await open();
    const shown = (m: { html?: string; ops?: unknown[] }) => m.html ?? ((m.ops ?? []) as { html?: string }[]).map((o) => o.html ?? "").join("");
    const drawerOf = (html: string) => html.slice(html.indexOf('id="drawer"'));
    write(ws, "desk", [{ op: "replace", path: "/page", value: "market?symbol=DLTA" }]);
    await expectMessage(ws, "patch");
    // what the lit row does not say: the move in per cent, and a sparkline on the quote's own document;
    // not its name or its price, which the row says, nor whether it is watched, which the button does
    const opened = drawerOf(shown(await expectMessage(ws, "render")));
    expect(opened).toContain('<span class="prop-name cap">Moved</span>');
    expect(opened).toContain('id="spark-DLTA" class="spark" data-applet="spark" data-doc="quote:DLTA" data-under="/quote"');
    for (const said of [">Name<", ">Price<", ">Watched<"]) expect(opened).not.toContain(said);

    const before = (await quotes()).DLTA!.price;
    write(ws, "ticker", [{ op: "replace", path: "/DLTA/price", value: 240.5 }]);
    expect(await expectMessage(ws, "patch")).toMatchObject({ doc: "ticker:market" });
    expect(drawerOf(shown(await expectMessage(ws, "render")))).toContain(`<span class="move up">+${(((240.5 - before) / before) * 100).toFixed(2)}%</span>`);
    expect(await expectMessage(ws, "patch")).toMatchObject({ doc: "quote:DLTA", ops: expect.arrayContaining([{ op: "replace", path: "/price", value: 240.5 }]) }); // the quote's own, which the sparkline takes

    write(ws, "watchlist", [{ op: "add", path: "/symbols/-", value: "DLTA" }]);
    await expectMessage(ws, "patch");
    const after = shown(await expectMessage(ws, "render"));
    expect(drawerOf(after)).toContain("Stop watching"); // no longer offering to watch what is watched
    expect(after).toMatch(/id="m-DLTA".*?<span class="symbol watched">DLTA<svg [^>]*role="img" aria-label="on your board">/); // and its row in the market carries the board's mark
    expect(after).not.toContain(">watching<"); // not a word: it is the viewer's own
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
    expect(html).toMatch(/id="m-ALPH"[^>]* aria-expanded="false" hidden>/);
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
    // on the board read as sparklines, a row is a figure as a list's is: a button over its line opens
    // its drawer and is expanded while it is open. The button is a part, so opening the drawer sends
    // its tag alone, and never the applet's mount, whose props follow the patches
    await page([{ op: "replace", path: "/page", value: "board" }]);
    write(ws, "desk", [{ op: "replace", path: "/page", value: "board?symbol=CHRL" }]);
    await expectMessage(ws, "patch");
    const chosen = await expectMessage(ws, "render");
    expect((chosen.ops as { op: string; target: string }[]).map((o) => `${o.op} ${/data-eta-part="(.*)"/.exec(o.target)![1]}`)).toEqual(["tag site", "tag tap-CHRL", "replace drawers"]);
    expect(JSON.stringify(chosen.ops)).not.toContain("data-props");
    html = chosen.page!;
    expect(html).toContain(`<div data-eta-part="quote-CHRL" id="quote-CHRL" class="board-row"><div id="line-CHRL" data-applet="board" data-doc="quote:CHRL" data-under="/quote" aria-hidden="true" data-props=`);
    expect(html).toContain(`<button data-eta-part="tap-CHRL" type="button" class="board-tap" aria-labelledby="line-CHRL" data-write='{"doc":"desk","op":"replace","path":"/page"}' data-value="board?symbol=CHRL" aria-expanded="true" data-reveal></button></div>`);
    expect(html).toContain("Stop watching");
    // the board row has the move and the sparkline, and a narrow board hides its name: its drawer gives the name
    const fromRow = html.slice(html.indexOf('id="drawer"'));
    expect(fromRow).toContain('<span class="prop-name cap">Name</span><div class="prop-value"><span>Charlie Metals</span>');
    for (const said of [">Moved<", ">Lately<"]) expect(fromRow).not.toContain(said);
    html = await page([{ op: "replace", path: "/reading/board", value: "list" }]);
    // a list row has the name and the price: from it, the drawer gives the move and the sparkline
    expect(html!.slice(html!.indexOf('id="drawer"'))).toContain('<span class="prop-name cap">Moved</span>');
    expect(html).toMatch(/class="row tap" id="b-CHRL"[^>]* aria-expanded="true" data-reveal>/);
    expect(html).toContain("Stop watching");
    // with the drawer open a tick sends the row and the drawer, since the drawer says the move;
    // with it closed, the row alone. CHRL is watched now, so the tick comes as the market's patch
    // and, where a board row shows it, the quote's own.
    const ticked = async (price: number) => {
      write(ws, "ticker", [{ op: "replace", path: "/CHRL/price", value: price }]);
      const renders = (await heard(ws)).filter((m) => m.type === "render");
      expect(renders).toHaveLength(1);
      return renders[0]!;
    };
    const tick = await ticked(13.05);
    expect(tick.html).toBeUndefined();
    expect(tick.page).toContain("13.05");
    await page([{ op: "replace", path: "/page", value: "board" }]);
    expect((await ticked(13.07)).ops).toMatchObject([{ op: "replace", target: '[data-eta-part="b-CHRL"]' }]);
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
    html = await pageNow(ws); // the list and the desk, which the answer put back on the board
    expect(html).not.toContain('class="modal"');
    expect(html).not.toContain("Stop watching");
    // watching asks which symbol, a choice of those the board lacks; the add that answers closes the ask
    html = await page([{ op: "replace", path: "/page", value: "board?new" }]);
    expect(html).toContain('<dialog open class="modal" aria-label="Watch a symbol">');
    expect(html).toContain('<select name="symbol" required autofocus><option value="ALPH">ALPH · Alpha Systems</option>');
    write(ws, "watchlist", [{ op: "add", path: "/symbols/-", value: "GOLF" }]);
    html = await pageNow(ws);
    expect(html).not.toContain('class="modal"');
    expect(html).toContain('id="b-GOLF"');
    // asked again, GOLF is not offered; sent anyway (from another tab's ask), it is refused, and the
    // ask says why beneath its field, until the next write
    html = await page([{ op: "replace", path: "/page", value: "board?new" }]);
    expect(html).not.toContain('<option value="GOLF">');
    write(ws, "watchlist", [{ op: "add", path: "/symbols/-", value: "GOLF" }]);
    html = await pageNow(ws);
    expect(html).toContain('<p class="refused" role="alert">GOLF is on your board already.</p><div class="modal-foot">');
    // a stale confirm renders no modal (and the next write puts the reason away); a drawer for a symbol the market lacks renders none
    write(ws, "desk", [{ op: "replace", path: "/page", value: "board?confirm=ZZZZ" }]);
    html = await pageNow(ws);
    expect(html).not.toContain('class="modal"');
    expect(html).not.toContain('class="refused"');
    html = await page([{ op: "replace", path: "/page", value: "board?symbol=ZZZZ" }]);
    expect(html).not.toContain('class="drawer"');
    ws.close();
  });

  test("with every symbol watched, the board has no plus and says so; the ask is not drawn", async () => {
    const ws = await open();
    for (const symbol of Object.keys(await quotes())) {
      write(ws, "watchlist", [{ op: "add", path: "/symbols/-", value: symbol }]);
      await heard(ws);
    }
    write(ws, "desk", [{ op: "replace", path: "/page", value: "board" }]);
    let html = await pageNow(ws);
    expect(html).not.toContain('aria-label="Watch a symbol"');
    expect(html).toContain('<p class="note">Everything is watched.</p>');
    write(ws, "desk", [{ op: "replace", path: "/page", value: "board?new" }]);
    html = await pageNow(ws);
    expect(html).not.toContain('class="modal"');
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
