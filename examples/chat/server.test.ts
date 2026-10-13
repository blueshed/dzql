import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { PatchOp } from "../../src/json-patch";
import type { HtmlOp } from "../../src/compartments/render";
import { db } from "./delta";
import { createServer } from "../../src/server";
import { hear, type Heard } from "../../src/harness";
import { assemble } from "../../src/compartments";
import { example } from "./index";
import { keepPresence } from "./presence";
import { serverWrite } from "../../src/documents";

/** delta, as a reader of its own -- not eta's copy, whose subscriptions a test must not disturb. */
const inDelta = example.delta!.as("test");

/** A room's messages, oldest first, as delta holds them (their ids are time-ordered). */
async function messagesOf(room: string): Promise<{ id: string; name: string; text: string }[]> {
  const doc = (await inDelta.call("open", { doc: `room:${room}` })).result;
  return Object.values(doc?.messages ?? {}).sort((a: any, b: any) => (a.id < b.id ? -1 : 1)) as never;
}

/** The session that wrote a room's latest entry: the cursor in delta's ledger, which the wire never carries. */
const lastWriterOf = (room: string): string => db.query<{ cursor: string }, [string]>("SELECT cursor FROM delta_ledger WHERE doc = ? ORDER BY id DESC LIMIT 1").get(`room:${room}`)!.cursor;

/** The names of who is here, across the head of the conversation (`#people`: a face and a name each, but for your own face, which goes unnamed but to a reader). */
function peopleIn(html: string): string[] {
  const faces = html.match(/<ul [^>]*id="people"[^>]*>(.*?)<\/ul>/)?.[1] ?? "";
  return [...faces.matchAll(/<span class="note">([^<]*)<\/span>/g)].map((m) => m[1]!);
}


let server: ReturnType<typeof createServer>;

beforeAll(() => {
  server = createServer(example, 0);
});

afterAll(() => {
  server.stop(true);
});

type WireMessage = { type: string; html: string; doc?: string; version?: number; ops?: unknown[] };

/** A render's HTML, whether it came as the whole page or as fragment ops. */
const htmlOf = (m: WireMessage): string => m.html ?? (m.ops as HtmlOp[]).map((o) => ("html" in o ? o.html : "")).join("");

// A persistent per-socket FIFO queue, not a fresh {once:true} listener per
// nextMessage() call: two messages sent back-to-back by the server (e.g. a
// patch echo immediately followed by its render) can both dispatch before
// test code re-subscribes after awaiting the first, silently dropping one.
const queues = new WeakMap<WebSocket, WireMessage[]>();
const waiters = new WeakMap<WebSocket, ((message: WireMessage) => void)[]>();

function connect(cookie?: string): WebSocket {
  const url = new URL("/ws", server.url);
  url.protocol = "ws:";
  const options = cookie ? { headers: { Cookie: cookie } } : undefined;
  // tsconfig's DOM lib shadows Bun's WebSocket type, which supports `headers` at runtime.
  // @ts-expect-error
  const ws: WebSocket = new WebSocket(url, options);

  const queue: WireMessage[] = [];
  const pending: ((message: WireMessage) => void)[] = [];
  queues.set(ws, queue);
  waiters.set(ws, pending);

  ws.addEventListener("message", (event) => {
    const message = JSON.parse(event.data as string) as WireMessage;
    if (message.type === "render") pages.set(ws, hear(pages.get(ws) ?? "", message as Heard));
    const waiter = pending.shift();
    if (waiter) waiter(message);
    else queue.push(message);
  });

  return ws;
}

function opened(ws: WebSocket): Promise<void> {
  return new Promise((resolve) => ws.addEventListener("open", () => resolve(), { once: true }));
}

function nextMessage(ws: WebSocket): Promise<WireMessage> {
  const queue = queues.get(ws)!;
  if (queue.length > 0) return Promise.resolve(queue.shift()!);
  return new Promise((resolve) => waiters.get(ws)!.push(resolve));
}

/** Consumes the next message and asserts its type, so a wrong sequence fails clearly instead of as a content mismatch. */
async function expectMessage(ws: WebSocket, type: string): Promise<WireMessage> {
  const message = await nextMessage(ws);
  expect(message.type).toBe(type);
  return message;
}

function write(ws: WebSocket, doc: string, ops: PatchOp[]) {
  ws.send(JSON.stringify({ doc, ops }));
}

/** Nothing arrives for `ws` in a short window -- used to prove a write that changed nothing on
 * this connection's page (item 8: a redundant tab closing) sent it nothing, not a wasted render. */
async function expectQuiet(ws: WebSocket): Promise<void> {
  await Bun.sleep(30);
  expect(queues.get(ws)!).toEqual([]);
}

/** The page each connection holds, kept as the client keeps it (the harness's `hear`). */
const pages = new WeakMap<WebSocket, string>();

/**
 * Everything `ws` has been sent, up to the server having finished with all that came before (an
 * inspect round trip -- the server handles events in order), and the page it then holds. A write
 * now causes changes to more than one document (the room, and who is here, or the list of rooms),
 * in no promised order: a test finds what it asks about by document, not by position.
 */
async function heard(ws: WebSocket): Promise<{ messages: WireMessage[]; page: string }> {
  ws.send(JSON.stringify({ type: "inspect" }));
  const messages: WireMessage[] = [];
  for (;;) {
    const m = await nextMessage(ws);
    if (m.type === "inspect") return { messages, page: pages.get(ws) ?? "" };
    messages.push(m);
  }
}

/** The patch echo for `doc` among what a connection heard. */
const patchFor = (messages: WireMessage[], doc: string): WireMessage | undefined => messages.find((m) => m.type === "patch" && m.doc === doc);
/** The render among what a connection heard. */
const renderIn = (messages: WireMessage[]): WireMessage | undefined => messages.find((m) => m.type === "render");

describe("routes", () => {
  test("/ serves the index page", async () => {
    const res = await fetch(new URL("/", server.url));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
  });

  test("/api/health returns ok", async () => {
    const res = await fetch(new URL("/api/health", server.url));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  test("an unknown path serves the same page, not a 404 -- a page in the URL is the client's to read (item 3)", async () => {
    const res = await fetch(new URL("/nope", server.url));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
  });
});

describe("websocket write protocol", () => {
  test("non-upgrade request to /ws is rejected", async () => {
    const res = await fetch(new URL("/ws", server.url));
    expect(res.status).toBe(400);
  });

  test("a new connection is greeted with the name form", async () => {
    const ws = connect();
    await opened(ws);
    const message = await expectMessage(ws, "render");
    expect(htmlOf(message)).toContain('data-write=\'{"doc":"session","op":"replace","path":"/name"}\'');
    ws.close();
  });

  test("invalid JSON is refused like any write that is not one, instead of crashing the connection", async () => {
    const ws = connect();
    await opened(ws);
    await expectMessage(ws, "render"); // initial name form

    ws.send("not-json{{{"); // not a write: the page handed back, and the server goes on
    expect(htmlOf(await expectMessage(ws, "render"))).toContain('id="name"');

    write(ws, "session", [{ op: "replace", path: "/name", value: "Still here" }]);
    await expectMessage(ws, "patch");
    const message = await expectMessage(ws, "render");

    expect(htmlOf(message)).toContain("Still here");
    ws.close();
  });

  test("an empty ops array does not crash and just re-renders the current state", async () => {
    const ws = connect();
    await opened(ws);
    await expectMessage(ws, "render");

    write(ws, "session", []);
    const message = await expectMessage(ws, "render");

    expect(htmlOf(message)).toContain('data-write=\'{"doc":"session","op":"replace","path":"/name"}\'');
    ws.close();
  });

  test("a write with no value is rejected without crashing", async () => {
    const ws = connect();
    await opened(ws);
    await expectMessage(ws, "render");

    write(ws, "session", [{ op: "replace", path: "/name" } as PatchOp]);
    // rejected (blank name): no patch echo, and the page it holds is the page still, so nothing at all
    const { messages, page } = await heard(ws);
    expect(messages).toEqual([]);
    expect(page).toContain('data-write=\'{"doc":"session","op":"replace","path":"/name"}\''); // no name was set
    ws.close();
  });

  test("inspect answers with the docs this connection sees, each with its ledger head", async () => {
    const ws = connect();
    const room = crypto.randomUUID();
    await opened(ws);
    await heard(ws);
    write(ws, "session", [{ op: "replace", path: "/name", value: "Ada" }]);
    await heard(ws);
    write(ws, "session", [{ op: "replace", path: "/room", value: room }]);
    await heard(ws);
    const uniqueText = `inspect me ${crypto.randomUUID()}`;
    write(ws, "room", [{ op: "add", path: "/messages/-", value: uniqueText }]);
    await heard(ws);

    ws.send(JSON.stringify({ type: "inspect" }));
    const inspection = await expectMessage(ws, "inspect");

    const docsSeen = (inspection as unknown as { docs: { doc: string; version: number; entries?: { ops: { path: string }[] }[] }[] }).docs;
    const sessionDoc = docsSeen.find((d) => d.doc === "session");
    const roomDoc = docsSeen.find((d) => d.doc === `room:${room}`);
    expect(sessionDoc?.version).toBeGreaterThan(0);
    expect(roomDoc?.version).toBeGreaterThan(0);
    expect(roomDoc?.entries?.[0]).toMatchObject({ ops: [{ op: "add", value: { name: "Ada", text: uniqueText } }] });
    expect(roomDoc?.entries?.[0]!.ops[0]!.path).toStartWith("/messages/"); // the row delta made, under its own id

    ws.close();
  });

  test("inspect on a fresh connection sees only the session doc, with no ledger history yet", async () => {
    const ws = connect();
    await opened(ws);
    await expectMessage(ws, "render");

    ws.send(JSON.stringify({ type: "inspect" }));
    const inspection = await expectMessage(ws, "inspect");

    const docsSeen = (inspection as unknown as { docs: { doc: string; version: number; entries?: unknown[] }[] }).docs;
    expect(docsSeen).toEqual([{ doc: "session", version: 0, entries: [] }]);

    ws.close();
  });

  test("an unknown doc is ignored without crashing", async () => {
    const ws = connect();
    await opened(ws);
    await expectMessage(ws, "render");

    write(ws, "nonsense", [{ op: "replace", path: "/x", value: "y" }]);
    expect((await heard(ws)).messages).toEqual([]); // refused, the page unchanged: nothing sent
    ws.close();
  });

  test("set-name renders a room selector with the escaped name", async () => {
    const ws = connect();
    await opened(ws);
    await expectMessage(ws, "render"); // initial name form

    write(ws, "session", [{ op: "replace", path: "/name", value: "<b>Ada</b>" }]);
    await expectMessage(ws, "patch"); // echo of the write; asserted precisely below
    const message = await expectMessage(ws, "render");

    expect(htmlOf(message)).toContain("&lt;b&gt;Ada&lt;/b&gt;");
    expect(htmlOf(message)).toContain('data-write=\'{"doc":"session","op":"remove","path":"/name"}\'');
    expect(htmlOf(message)).toContain('class="cell open" data-key="rooms"');
    ws.close();
  });

  test("the patch echo for a session write carries the bare doc type, version, and what changed of the session -- never its id", async () => {
    const sessionId = crypto.randomUUID();
    const ws = connect(`session_id=${sessionId}`);
    await opened(ws);
    await heard(ws);

    write(ws, "session", [{ op: "replace", path: "/name", value: "Ada" }]);
    const { messages } = await heard(ws);
    const patch = patchFor(messages, "session")!;

    expect(patch.version).toBe(1);
    // delta says a session's change as the fields it changed, at eta's paths -- never the row's id,
    // the session id, a credential
    expect(patch.ops).toEqual([{ op: "replace", path: "/name", value: "Ada" }]);
    expect(JSON.stringify(messages)).not.toContain(sessionId);
    ws.close();
  });

  test("join-room renders the chat view for that room", async () => {
    const ws = connect();
    await opened(ws);
    await expectMessage(ws, "render"); // initial name form

    write(ws, "session", [{ op: "replace", path: "/name", value: "Ada" }]);
    await expectMessage(ws, "patch");
    await expectMessage(ws, "render"); // room selector

    const room = crypto.randomUUID();
    write(ws, "session", [{ op: "replace", path: "/room", value: room }]);
    await expectMessage(ws, "patch"); // echo of the session's /room write
    const message = await expectMessage(ws, "render"); // the full chat view: alone, nobody to tell

    expect(htmlOf(message)).toContain(`#${room}`);
    expect(htmlOf(message)).toContain('data-write=\'{"doc":"room","op":"add","path":"/messages/-"}\'');
    expect(htmlOf(message)).toContain('data-write=\'{"doc":"session","op":"remove","path":"/room"}\'');
    ws.close();
  });

  test("a stale tab cannot join a room after the session has logged out elsewhere", async () => {
    const cookie = `session_id=${crypto.randomUUID()}`;

    const first = connect(cookie);
    await opened(first);
    await expectMessage(first, "render");
    write(first, "session", [{ op: "replace", path: "/name", value: "Ada" }]);
    await expectMessage(first, "patch");
    await expectMessage(first, "render");
    write(first, "session", [{ op: "remove", path: "/name" }]);
    await expectMessage(first, "patch");
    await expectMessage(first, "render");

    // a second, stale tab shares the same session cookie and still has its old room-selector UI open
    const second = connect(cookie);
    await opened(second);
    await expectMessage(second, "render"); // name form: this session is logged out

    const room = crypto.randomUUID();
    write(second, "session", [{ op: "replace", path: "/room", value: room }]);
    // rejected by permit (logged out): no patch echo, and nothing else, the page unchanged
    const rejected = await heard(second);
    expect(rejected.messages).toEqual([]);
    expect(rejected.page).toContain('data-write=\'{"doc":"session","op":"replace","path":"/name"}\''); // still logged out

    // reactivating afterward must not reveal a room leaked by the rejected write
    write(second, "session", [{ op: "replace", path: "/name", value: "Ada again" }]);
    await expectMessage(second, "patch");
    const reactivated = await expectMessage(second, "render");
    expect(htmlOf(reactivated)).toContain('class="cell open" data-key="rooms"'); // room selector, not a chat view

    first.close();
    second.close();
  });

  test("leave-room returns to the room selector", async () => {
    const ws = connect();
    await opened(ws);
    await heard(ws);
    write(ws, "session", [{ op: "replace", path: "/name", value: "Ada" }]);
    await heard(ws);
    write(ws, "session", [{ op: "replace", path: "/room", value: crypto.randomUUID() }]);
    await heard(ws);

    write(ws, "session", [{ op: "remove", path: "/room" }]);
    const { messages, page } = await heard(ws);

    expect(patchFor(messages, "session")!.ops).toEqual([{ op: "replace", path: "/room", value: null }]);
    expect(page).toContain('class="cell open" data-key="rooms"');
    ws.close();
  });

  test("logout clears the session and re-renders the name form", async () => {
    const ws = connect();
    await opened(ws);
    await expectMessage(ws, "render");

    write(ws, "session", [{ op: "replace", path: "/name", value: "Grace" }]);
    await expectMessage(ws, "patch");
    await expectMessage(ws, "render");

    write(ws, "session", [{ op: "remove", path: "/name" }]);
    await expectMessage(ws, "patch"); // echo of the /name removal
    const message = await expectMessage(ws, "render");

    expect(htmlOf(message)).toContain('data-write=\'{"doc":"session","op":"replace","path":"/name"}\'');
    ws.close();
  });

  test("a revoked session can set a new name again (soft-delete, not gone forever)", async () => {
    const cookie = `session_id=${crypto.randomUUID()}`;

    const first = connect(cookie);
    await opened(first);
    await expectMessage(first, "render");
    write(first, "session", [{ op: "replace", path: "/name", value: "Ada" }]);
    await expectMessage(first, "patch");
    await expectMessage(first, "render");
    write(first, "session", [{ op: "remove", path: "/name" }]);
    await expectMessage(first, "patch");
    await expectMessage(first, "render");
    first.close();

    const second = connect(cookie);
    await opened(second);
    const reopened = await expectMessage(second, "render");
    expect(htmlOf(reopened)).toContain('data-write=\'{"doc":"session","op":"replace","path":"/name"}\'');

    write(second, "session", [{ op: "replace", path: "/name", value: "Ada again" }]);
    await expectMessage(second, "patch");
    const message = await expectMessage(second, "render");

    expect(htmlOf(message)).toContain("Ada again");
    second.close();
  });

  test("undo walks back a session's own last write", async () => {
    const ws = connect();
    await opened(ws);
    await heard(ws);

    write(ws, "session", [{ op: "replace", path: "/name", value: "Ada" }]);
    await heard(ws); // room selector

    write(ws, "ledger", [{ op: "remove", path: "/latest" }]);
    const { messages, page } = await heard(ws);
    expect(patchFor(messages, "session")!.ops).toEqual([{ op: "replace", path: "/name", value: null }]);
    expect(page).toContain('data-write=\'{"doc":"session","op":"replace","path":"/name"}\''); // logged out again

    ws.close();
  });

  test("undo is a cursor, not a toggle: pressing it twice walks back two writes", async () => {
    const ws = connect();
    await opened(ws);
    await heard(ws);

    write(ws, "session", [{ op: "replace", path: "/name", value: "Ada" }]);
    await heard(ws);
    write(ws, "session", [{ op: "replace", path: "/room", value: "general" }]);
    await heard(ws);

    write(ws, "ledger", [{ op: "remove", path: "/latest" }]);
    const first = await heard(ws);
    expect(patchFor(first.messages, "session")!.ops).toEqual([{ op: "replace", path: "/room", value: null }]); // back to the room selector

    write(ws, "ledger", [{ op: "remove", path: "/latest" }]);
    const second = await heard(ws);
    expect(patchFor(second.messages, "session")!.ops).toEqual([{ op: "replace", path: "/name", value: null }]); // not a redo of the room join
    expect(second.page).toContain('data-write=\'{"doc":"session","op":"replace","path":"/name"}\'');

    // nothing left to undo: a third press changes nothing, and hands the page back
    write(ws, "ledger", [{ op: "remove", path: "/latest" }]);
    const third = await heard(ws);
    expect(patchFor(third.messages, "session")).toBeUndefined();
    expect(third.page).toContain('data-write=\'{"doc":"session","op":"replace","path":"/name"}\'');

    ws.close();
  });

  test("a stale tab cannot undo after the session has logged out elsewhere", async () => {
    const cookie = `session_id=${crypto.randomUUID()}`;

    const first = connect(cookie);
    await opened(first);
    await expectMessage(first, "render");
    write(first, "session", [{ op: "replace", path: "/name", value: "Ada" }]);
    await expectMessage(first, "patch");
    await expectMessage(first, "render");
    write(first, "session", [{ op: "remove", path: "/name" }]);
    await expectMessage(first, "patch");
    await expectMessage(first, "render");

    const second = connect(cookie);
    await opened(second);
    await expectMessage(second, "render"); // name form: this session is logged out

    write(second, "ledger", [{ op: "remove", path: "/latest" }]);
    // rejected by permit (logged out): no patch echo, and nothing else, the page unchanged
    const rejected = await heard(second);
    expect(rejected.messages).toEqual([]);
    expect(rejected.page).toContain('data-write=\'{"doc":"session","op":"replace","path":"/name"}\'');

    first.close();
    second.close();
  });

  test("reconnecting with the same session cookie remembers the name", async () => {
    const cookie = `session_id=${crypto.randomUUID()}`;

    const first = connect(cookie);
    await opened(first);
    await expectMessage(first, "render");
    write(first, "session", [{ op: "replace", path: "/name", value: "Linus" }]);
    await expectMessage(first, "patch");
    await expectMessage(first, "render");
    first.close();

    const second = connect(cookie);
    await opened(second);
    const message = await expectMessage(second, "render");
    expect(htmlOf(message)).toContain("Linus");
    second.close();
  });
});

describe("chat", () => {
  /** Opens, names, and enters `room`: each step heard through, so what follows starts clean. */
  async function login(ws: WebSocket, name: string, room: string): Promise<void> {
    await opened(ws);
    await heard(ws); // the name form
    write(ws, "session", [{ op: "replace", path: "/name", value: name }]);
    await heard(ws); // the rooms
    write(ws, "session", [{ op: "replace", path: "/room", value: room }]);
    await heard(ws); // the room
  }

  test("a room's people list updates live as someone else joins and leaves", async () => {
    const room = crypto.randomUUID();
    const a = connect();
    await login(a, "Alice", room);

    const b = connect();
    await login(b, "Bob", room);
    const joined = await heard(a);
    expect(patchFor(joined.messages, `here:${room}`)!.ops).toEqual([{ op: "add", path: "/people/Bob", value: true }]);
    expect(renderIn(joined.messages)!.ops).toMatchObject([{ op: "replace", target: '[data-eta-part="people"]' }]);
    // Alice sees Bob named; herself, her face in her own colour and no name, since she knows who she
    // is -- and a reader, who cannot see the colour, hears "You" among who is here, as her messages say
    expect(peopleIn(joined.page)).toEqual(["Bob"]);
    expect(joined.page).toContain('<ul data-eta-part="people" id="people" class="people" aria-label="Here"><li class="who"><span class="face me" aria-hidden="true">A</span><span class="sr-only">You</span></li><li class="who">');

    b.close();
    expect(peopleIn((await heard(a)).page)).toEqual([]);

    a.close();
  });

  test("presence dedupes multiple tabs for the same session, and one tab closing doesn't drop it while another remains", async () => {
    const room = crypto.randomUUID();
    const cookie = `session_id=${crypto.randomUUID()}`;

    const a = connect(cookie);
    await login(a, "Alice", room);

    // a second tab for the same session: already named and in the room, through the shared cookie
    const b = connect(cookie);
    await opened(b);
    await heard(b);

    const c = connect();
    await login(c, "Carol", room);
    // not "Alice, Alice, Carol": two sockets, one person
    expect(peopleIn((await heard(a)).page)).toEqual(["Carol"]);
    expect(peopleIn((await heard(b)).page)).toEqual(["Carol"]);
    expect(peopleIn((await heard(c)).page)).toEqual(["Alice"]);

    // b's tab closing doesn't change who is in the room (a's tab is still Alice's): nothing is sent
    b.close();
    const toA = await heard(a);
    expect(toA.messages).toEqual([]);
    expect((await heard(c)).messages).toEqual([]);
    expect(peopleIn(toA.page)).toEqual(["Carol"]);

    a.close();
    c.close();
  });

  test("who is here is kept one run at a time: two at once write the difference once, and neither is refused", async () => {
    const room = crypto.randomUUID();
    const a = connect();
    await login(a, "Alice", room);
    await serverWrite(`here:${room}`, [{ op: "add", path: "/people/Ghost", value: true }]); // held, and not here
    // each run diffs the copy it reads: at once, both would take the ghost out, and delta refuses
    // the second remove (404), and the rest of its batch with it
    await Promise.all([keepPresence(), keepPresence()]);
    expect((await inDelta.call("open", { doc: `here:${room}` })).result.people).toEqual({ Alice: true });
    a.close();
  });

  test("logging out while in a room leaves it, broadcasting presence to the remaining members", async () => {
    const room = crypto.randomUUID();
    const a = connect();
    await login(a, "Alice", room);
    const b = connect();
    await login(b, "Bob", room);
    await heard(a);

    write(b, "session", [{ op: "remove", path: "/name" }]);
    await heard(b);
    const { messages, page } = await heard(a);
    expect(patchFor(messages, `here:${room}`)!.ops).toEqual([{ op: "remove", path: "/people/Bob" }]);
    expect(peopleIn(page)).toEqual([]);

    a.close();
    b.close();
  });

  test("send-message broadcasts to every connected room member: delta's row echoed, the one list or row drawn", async () => {
    const room = crypto.randomUUID();
    const a = connect();
    await login(a, "Alice", room);
    const b = connect();
    await login(b, "Bob", room);
    await heard(a);

    const uniqueText = `hello from alice ${crypto.randomUUID()}`;
    write(a, "room", [{ op: "add", path: "/messages/-", value: uniqueText }]);
    const toA = await heard(a);
    const echo = patchFor(toA.messages, `room:${room}`)!;
    expect(echo.ops).toMatchObject([{ op: "add", value: { name: "Alice", text: uniqueText } }]);
    expect((echo.ops as { path: string }[])[0]!.path).toStartWith("/messages/");
    // the room was empty, so there is no row to put it beside: the list is sent, with its one message
    expect(renderIn(toA.messages)!.ops).toMatchObject([{ op: "replace", target: '[data-eta-part="messages"]' }]);
    expect(toA.page).toContain(uniqueText);

    const toB = await heard(b);
    expect(patchFor(toB.messages, `room:${room}`)).toBeDefined();
    expect(toB.page).toContain(uniqueText);

    // the second goes as the one row, after the first, and nothing else
    const firstId = (await messagesOf(room))[0]!.id;
    write(a, "room", [{ op: "add", path: "/messages/-", value: "and again" }]);
    const again = await heard(a);
    const secondId = (await messagesOf(room))[1]!.id;
    expect(renderIn(again.messages)!.ops).toEqual([{ op: "after", target: `[data-eta-part="m${firstId}"]`, html: `<li data-eta-part="m${secondId}" id="m${secondId}" class="mine"><div class="body"><span class="bubble">and again</span></div></li>` }]);
    a.close();
    b.close();
  });

  test("undo removes a session's own last chat message, updating every connection in the room", async () => {
    const room = crypto.randomUUID();
    const a = connect();
    await login(a, "Alice", room);
    const b = connect();
    await login(b, "Bob", room);
    await heard(a);

    write(a, "room", [{ op: "add", path: "/messages/-", value: `first ${crypto.randomUUID()}` }]);
    await heard(a);
    await heard(b);
    write(a, "room", [{ op: "add", path: "/messages/-", value: `second ${crypto.randomUUID()}` }]);
    await heard(a);
    await heard(b);

    // Alice presses undo: her last write was the second message, so that's what goes -- its one
    // row taken out, nothing else, for everyone in the room
    const secondId = (await messagesOf(room))[1]!.id;
    write(a, "ledger", [{ op: "remove", path: "/latest" }]);
    const toA = await heard(a);
    expect(patchFor(toA.messages, `room:${room}`)!.ops).toEqual([{ op: "remove", path: `/messages/${secondId}` }]);
    expect(renderIn(toA.messages)!.ops).toEqual([{ op: "remove", target: `[data-eta-part="m${secondId}"]` }]);
    const toB = await heard(b);
    expect(patchFor(toB.messages, `room:${room}`)).toBeDefined();
    expect(renderIn(toB.messages)!.ops).toEqual([{ op: "remove", target: `[data-eta-part="m${secondId}"]` }]);

    const entries = (await inDelta.call("history", { doc: `room:${room}` })).result as { ops: unknown[] }[];
    expect(entries).toHaveLength(3); // two sends, one undo
    expect(entries[0]!.ops).toEqual([{ op: "remove", path: `/messages/${secondId}` }]);

    // Bob sends after Alice's first; Alice undoes her first. Bob's message started a run before
    // (it followed Alice's) and starts one still, so nothing about it changed: the removal alone.
    write(b, "room", [{ op: "add", path: "/messages/-", value: "bob after" }]);
    await heard(b);
    await heard(a);
    const [firstId] = (await messagesOf(room)).map((m) => m.id);
    write(a, "ledger", [{ op: "remove", path: "/latest" }]);
    expect(renderIn((await heard(a)).messages)!.ops).toEqual([{ op: "remove", target: `[data-eta-part="m${firstId}"]` }]);
    expect(renderIn((await heard(b)).messages)!.ops).toEqual([{ op: "remove", target: `[data-eta-part="m${firstId}"]` }]);

    a.close();
    b.close();
  });

  test("inspect never tells one person another's session id: it is their only credential", async () => {
    const room = crypto.randomUUID();
    const a = connect();
    await login(a, "Alice", room);
    const b = connect();
    await login(b, "Bob", room);
    await heard(a);
    write(a, "room", [{ op: "add", path: "/messages/-", value: "from alice" }]);
    await heard(a);
    const alice = lastWriterOf(room); // what Bob must never be sent

    b.send(JSON.stringify({ type: "inspect", limit: 10 }));
    let reply = await nextMessage(b);
    while (reply.type !== "inspect") reply = await nextMessage(b);
    const text = JSON.stringify(reply);
    expect(text).toContain("from alice"); // he may read what was said
    expect(text).not.toContain(alice); // never who, by the id that would let him be her
    const entries = (reply as unknown as { docs: { doc: string; entries: { mine: boolean }[] }[] }).docs.find((d) => d.doc === `room:${room}`)!.entries;
    expect(entries[0]!.mine).toBe(false);
    a.close();
    b.close();
  });

  test("a thing is said once: a run of messages shows its author's face and name once, and your own run says only 'You', to a reader", async () => {
    const room = crypto.randomUUID();
    const ada = crypto.randomUUID();
    await inDelta.call("open", { doc: `session:${ada}` });
    await inDelta.call("delta", { doc: `session:${ada}`, ops: [{ op: "replace", path: "/sessions/name", value: "Ada" }, { op: "replace", path: "/sessions/room", value: room }] });
    await inDelta.call("open", { doc: `room:${room}` });
    for (const [name, text] of [["Bob", "one"], ["Bob", "two"], ["Bob", "three"], ["Ada", "mine"], ["Ada", "mine too"]]) {
      await inDelta.call("delta", { doc: `room:${room}`, ops: [{ op: "add", path: `/messages/${Bun.randomUUIDv7()}`, value: { name, text, sent_at: Date.now() } }] });
    }
    const page = await assemble(example).draw(ada);
    const messages = page.slice(page.indexOf('id="messages"'));
    expect(messages.match(/<span class="name">Bob<\/span>/g)).toHaveLength(1); // three in a row, named once
    expect(messages.match(/<span class="face" aria-hidden="true">B<\/span>/g)).toHaveLength(1); // and his face once, at the start of the run
    expect(messages.match(/<span class="face-gap"><\/span>/g)).toHaveLength(2); // the rest keep its place
    expect(messages).not.toContain('<span class="name">Ada</span>'); // she knows who she is
    expect(messages).not.toContain('class="face me"'); // her own face is in the strip of who is here, not beside her words
    expect(messages.match(/class="mine"/g)).toHaveLength(2); // hers are told apart by where they sit, not by her name again
    expect(messages.match(/<span class="sr-only">You<\/span>/g)).toHaveLength(1); // and to a reader, who cannot see where they sit, once
    expect(page).toContain('<input name="text" autocomplete="off" required autofocus placeholder="Message" aria-label="Message">'); // the field is named what it shows
  });

  test("send-message with blank text does not crash and does not stop further messages", async () => {
    const ws = connect();
    await login(ws, "Blank", crypto.randomUUID());

    write(ws, "room", [{ op: "add", path: "/messages/-", value: "   " }]);
    // shaped to nothing (blank text): no patch echo, and the page unchanged, so nothing at all
    expect((await heard(ws)).messages).toEqual([]);

    const uniqueText = `after blank ${crypto.randomUUID()}`;
    write(ws, "room", [{ op: "add", path: "/messages/-", value: uniqueText }]);
    expect((await heard(ws)).page).toContain(uniqueText);
    ws.close();
  });

  test("a room write from a connection not currently in a room is rejected", async () => {
    const ws = connect();
    await opened(ws);
    await expectMessage(ws, "render");
    write(ws, "session", [{ op: "replace", path: "/name", value: "NoRoom" }]);
    await expectMessage(ws, "patch");
    await expectMessage(ws, "render"); // room selector, not in any room

    write(ws, "room", [{ op: "add", path: "/messages/-", value: "hello?" }]);
    // rejected: resolveDoc finds no current room, so permit/write are never reached
    const { messages, page } = await heard(ws);
    expect(messages).toEqual([]);
    expect(page).toContain('class="cell open" data-key="rooms"');
    ws.close();
  });

  test("closing a connection removes it from the room without breaking future broadcasts", async () => {
    const room = crypto.randomUUID();
    const a = connect();
    await login(a, "RoomLeaverA", room);
    const b = connect();
    await login(b, "RoomLeaverB", room);
    await heard(a);

    b.close();
    expect(peopleIn((await heard(a)).page)).toEqual([]);

    const uniqueText = `still works after b left ${crypto.randomUUID()}`;
    write(a, "room", [{ op: "add", path: "/messages/-", value: uniqueText }]);
    expect((await heard(a)).page).toContain(uniqueText);
    a.close();
  });
});
