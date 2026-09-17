import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { PatchOp } from "../../src/json-patch";
import type { HtmlOp } from "../../src/compartments/render";
import { history } from "../../src/ledger";
import { read as readRoom } from "./documents/room";
import { createServer } from "../../src/server";
import { example } from "./index";

/** The names of who is here, across the head of the conversation (`#people`: a face and a name each). */
function peopleIn(html: string): string[] {
  const faces = html.match(/<div id="people"[^>]*>(.*?)<\/div>/)?.[1] ?? "";
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

/** A presence change (join/leave) reaches someone already in the room as a patch, then a
 * fragment render -- subscribed before the triggering action, so neither message is missed, and
 * resolving to the render for assertions on the resulting people list. */
function presenceUpdate(ws: WebSocket): Promise<WireMessage> {
  const patch = nextMessage(ws);
  const render = nextMessage(ws);
  return patch.then(() => render);
}

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

  test("invalid JSON is ignored instead of crashing the connection", async () => {
    const ws = connect();
    await opened(ws);
    await expectMessage(ws, "render"); // initial name form

    ws.send("not-json{{{"); // produces no response; the server must not crash

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
    // rejected (blank name): no patch echo, just the unchanged render
    const message = await expectMessage(ws, "render");

    expect(htmlOf(message)).toContain('data-write=\'{"doc":"session","op":"replace","path":"/name"}\''); // no name was set
    ws.close();
  });

  test("inspect answers with the docs this connection sees, each with its ledger head", async () => {
    const ws = connect();
    await opened(ws);
    await expectMessage(ws, "render");

    write(ws, "session", [{ op: "replace", path: "/name", value: "Ada" }]);
    await expectMessage(ws, "patch");
    await expectMessage(ws, "render");

    const room = crypto.randomUUID();
    write(ws, "session", [{ op: "replace", path: "/room", value: room }]);
    await expectMessage(ws, "patch"); // echo of the session's /room write
    await expectMessage(ws, "render"); // the full chat view: alone in a fresh room, nobody to tell

    const uniqueText = `inspect me ${crypto.randomUUID()}`;
    write(ws, "room", [{ op: "add", path: "/transcript/-", value: uniqueText }]);
    await expectMessage(ws, "patch");
    await expectMessage(ws, "render");

    ws.send(JSON.stringify({ type: "inspect" }));
    const inspection = await expectMessage(ws, "inspect");

    const docsSeen = (inspection as unknown as { docs: { doc: string; version: number; entries?: unknown[] }[] }).docs;
    const sessionDoc = docsSeen.find((d) => d.doc === "session");
    const roomDoc = docsSeen.find((d) => d.doc === "room");
    expect(sessionDoc?.version).toBeGreaterThan(0);
    expect(roomDoc?.version).toBeGreaterThan(0);
    expect(roomDoc?.entries?.[0]).toMatchObject({
      ops: [{ op: "add", path: "/transcript/-", value: { name: "Ada", text: uniqueText } }],
    });

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
    await expectMessage(ws, "render"); // falls through to the normal render
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

  test("the patch echo for a session write carries the bare doc type, version, and applied op", async () => {
    const ws = connect();
    await opened(ws);
    await expectMessage(ws, "render");

    write(ws, "session", [{ op: "replace", path: "/name", value: "Ada" }]);
    const patch = await expectMessage(ws, "patch");

    expect(patch.doc).toBe("session");
    expect(patch.version).toBe(1);
    expect(patch.ops).toEqual([{ op: "replace", path: "/name", value: "Ada" }]);

    await expectMessage(ws, "render");
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
    expect(htmlOf(message)).toContain('data-write=\'{"doc":"room","op":"add","path":"/transcript/-"}\'');
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
    // rejected by permit (logged out): no patch echo, just the unchanged render
    const rejected = await expectMessage(second, "render");
    expect(htmlOf(rejected)).toContain('data-write=\'{"doc":"session","op":"replace","path":"/name"}\''); // still logged out

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
    await expectMessage(ws, "render");
    write(ws, "session", [{ op: "replace", path: "/name", value: "Ada" }]);
    await expectMessage(ws, "patch");
    await expectMessage(ws, "render");
    write(ws, "session", [{ op: "replace", path: "/room", value: crypto.randomUUID() }]);
    await expectMessage(ws, "patch");
    await expectMessage(ws, "render"); // full chat view: alone in a fresh room, nobody to tell

    write(ws, "session", [{ op: "remove", path: "/room" }]);
    await expectMessage(ws, "patch"); // echo of the session's /room removal
    const message = await expectMessage(ws, "render");

    expect(htmlOf(message)).toContain('class="cell open" data-key="rooms"');
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
    await expectMessage(ws, "render");

    write(ws, "session", [{ op: "replace", path: "/name", value: "Ada" }]);
    await expectMessage(ws, "patch");
    await expectMessage(ws, "render"); // room selector

    write(ws, "ledger", [{ op: "remove", path: "/latest" }]);
    const undonePatch = await expectMessage(ws, "patch");
    expect(undonePatch.doc).toBe("session");
    expect(undonePatch.ops).toEqual([{ op: "remove", path: "/name" }]);
    const rendered = await expectMessage(ws, "render");
    expect(htmlOf(rendered)).toContain('data-write=\'{"doc":"session","op":"replace","path":"/name"}\''); // logged out again

    ws.close();
  });

  test("undo is a cursor, not a toggle: pressing it twice walks back two writes", async () => {
    const ws = connect();
    await opened(ws);
    await expectMessage(ws, "render");

    write(ws, "session", [{ op: "replace", path: "/name", value: "Ada" }]);
    await expectMessage(ws, "patch");
    await expectMessage(ws, "render");
    write(ws, "session", [{ op: "replace", path: "/room", value: "general" }]);
    await expectMessage(ws, "patch");
    await expectMessage(ws, "render"); // full chat view: alone in the room, nobody to tell

    write(ws, "ledger", [{ op: "remove", path: "/latest" }]);
    const firstUndo = await expectMessage(ws, "patch");
    expect(firstUndo.ops).toEqual([{ op: "remove", path: "/room" }]); // back to the room selector
    await expectMessage(ws, "render");

    write(ws, "ledger", [{ op: "remove", path: "/latest" }]);
    const secondUndo = await expectMessage(ws, "patch");
    expect(secondUndo.ops).toEqual([{ op: "remove", path: "/name" }]); // not a redo of the room join
    const rendered = await expectMessage(ws, "render");
    expect(htmlOf(rendered)).toContain('data-write=\'{"doc":"session","op":"replace","path":"/name"}\'');

    // nothing left to undo: a third press just re-renders the current state
    write(ws, "ledger", [{ op: "remove", path: "/latest" }]);
    const noOp = await expectMessage(ws, "render");
    expect(htmlOf(noOp)).toContain('data-write=\'{"doc":"session","op":"replace","path":"/name"}\'');

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
    // rejected by permit (logged out): no patch echo, just the unchanged render
    const rejected = await expectMessage(second, "render");
    expect(htmlOf(rejected)).toContain('data-write=\'{"doc":"session","op":"replace","path":"/name"}\'');

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
  async function login(ws: WebSocket, name: string, room: string): Promise<void> {
    await opened(ws);
    await expectMessage(ws, "render"); // initial name form
    write(ws, "session", [{ op: "replace", path: "/name", value: name }]);
    await expectMessage(ws, "patch");
    await expectMessage(ws, "render"); // room selector
    write(ws, "session", [{ op: "replace", path: "/room", value: room }]);
    await expectMessage(ws, "patch"); // echo of the session's /room write
    // the full chat view; a presence broadcast to whoever else is already there doesn't come
    // back to the joiner itself, so there's nothing else to drain here
    await expectMessage(ws, "render");
  }

  test("a room's people list updates live as someone else joins and leaves", async () => {
    const room = crypto.randomUUID();
    const a = connect();
    await login(a, "Alice", room);

    const joined = presenceUpdate(a); // subscribe before Bob joins, to avoid a race
    const b = connect();
    await login(b, "Bob", room);

    const joinedUpdate = await joined;
    expect(joinedUpdate.ops).toMatchObject([{ op: "replace", target: "#people" }]);
    expect(peopleIn(htmlOf(joinedUpdate))).toEqual(["Alice", "Bob"]);

    const left = presenceUpdate(a);
    b.close();
    const leftUpdate = await left;
    expect(peopleIn(htmlOf(leftUpdate))).toEqual(["Alice"]);

    a.close();
  });

  test("presence dedupes multiple tabs for the same session, and one tab closing doesn't drop it while another remains", async () => {
    const room = crypto.randomUUID();
    const cookie = `session_id=${crypto.randomUUID()}`;

    const a = connect(cookie);
    await login(a, "Alice", room);

    // a second tab for the same session: already logged in and in the room via the shared
    // cookie, so onOpen joins it directly without a session write.
    const b = connect(cookie);
    await opened(b);
    await expectMessage(b, "render"); // full chat view

    const aJoined = presenceUpdate(a); // subscribe before Carol joins, to avoid a race
    const bJoined = presenceUpdate(b);
    const c = connect();
    await login(c, "Carol", room);

    const aJoinedUpdate = await aJoined;
    // not "Alice, Alice, Carol": two sockets, one person
    expect(peopleIn(htmlOf(aJoinedUpdate))).toEqual(["Alice", "Carol"]);
    expect(peopleIn(htmlOf(await bJoined))).toEqual(["Alice", "Carol"]);

    // b's tab closing doesn't change who's visibly in the room (a's tab is still Alice's), so
    // nothing goes out at all -- not even a wasted re-render, unlike before item 8.
    b.close();
    await expectQuiet(a);
    await expectQuiet(c);

    // proof the room still shows both, not just the absence of a message: an unrelated write
    // gets a fresh render of the current state.
    write(a, "session", []);
    const stillThere = await expectMessage(a, "render");
    expect(peopleIn(htmlOf(stillThere))).toEqual(["Alice", "Carol"]);

    a.close();
    c.close();
  });

  test("logging out while in a room leaves it, broadcasting presence to the remaining members", async () => {
    const room = crypto.randomUUID();
    const a = connect();
    await login(a, "Alice", room);

    const bJoined = presenceUpdate(a); // subscribe before Bob joins, to avoid missing the broadcast
    const b = connect();
    await login(b, "Bob", room);
    await bJoined; // people broadcast triggered by Bob joining, not this test's focus

    const bLeft = presenceUpdate(a); // subscribe before Bob logs out
    write(b, "session", [{ op: "remove", path: "/name" }]);
    const bLeftUpdate = await bLeft;

    expect(peopleIn(htmlOf(bLeftUpdate))).toEqual(["Alice"]);

    a.close();
    b.close();
  });

  test("send-message broadcasts to every connected room member, echoing the write first", async () => {
    const room = crypto.randomUUID();
    const a = connect();
    await login(a, "Alice", room);

    const bJoined = presenceUpdate(a); // subscribe before Bob joins, to avoid missing the broadcast
    const b = connect();
    await login(b, "Bob", room);
    await bJoined; // people broadcast triggered by Bob joining, not this test's focus

    const uniqueText = `hello from alice ${crypto.randomUUID()}`;
    const bPatch = nextMessage(b); // subscribe before sending, to avoid a race
    const bRender = nextMessage(b);
    write(a, "room", [{ op: "add", path: "/transcript/-", value: uniqueText }]);

    const aPatch = await expectMessage(a, "patch");
    expect(aPatch.doc).toBe("room");
    expect(aPatch.ops).toEqual([{ op: "add", path: "/transcript/-", value: { name: "Alice", text: uniqueText } }]);
    // the render is a fragment: the one <li>, appended to the transcript
    const aRender = await expectMessage(a, "render");
    expect(aRender.ops).toMatchObject([{ op: "add", target: "#messages" }]);
    expect(htmlOf(aRender)).toContain(uniqueText);
    expect(htmlOf(aRender)).not.toContain("<form"); // not the page

    expect(await bPatch).toMatchObject({ type: "patch", doc: "room" });
    expect(htmlOf(await bRender)).toContain(uniqueText);
    a.close();
    b.close();
  });

  test("undo removes a session's own last chat message, updating every connection in the room", async () => {
    const room = crypto.randomUUID();
    const a = connect();
    await login(a, "Alice", room);

    const bJoined = presenceUpdate(a); // subscribe before Bob joins, to avoid missing the broadcast
    const b = connect();
    await login(b, "Bob", room);
    await bJoined; // people broadcast triggered by Bob joining, not this test's focus

    const firstText = `first ${crypto.randomUUID()}`;
    const secondText = `second ${crypto.randomUUID()}`;

    let bIncoming = nextMessage(b); // subscribe before sending, to avoid a race
    let bRenderIncoming = nextMessage(b);
    write(a, "room", [{ op: "add", path: "/transcript/-", value: firstText }]);
    await expectMessage(a, "patch");
    await expectMessage(a, "render");
    await bIncoming; // Bob's patch echo
    await bRenderIncoming;

    bIncoming = nextMessage(b);
    bRenderIncoming = nextMessage(b);
    write(a, "room", [{ op: "add", path: "/transcript/-", value: secondText }]);
    await expectMessage(a, "patch");
    await expectMessage(a, "render");
    await bIncoming;
    await bRenderIncoming;

    // Alice presses undo: her last write was the second message, so that's what goes -- as a
    // fragment render: the one <li> removed, nothing else, for everyone in the room.
    const secondId = readRoom(room).transcript[1]!.id;
    const bPatch = nextMessage(b); // subscribe before undo, to avoid a race
    const bRender = nextMessage(b);
    write(a, "ledger", [{ op: "remove", path: "/latest" }]);

    const aPatch = await expectMessage(a, "patch");
    expect(aPatch.doc).toBe("room");
    expect(aPatch.ops).toEqual([{ op: "remove", path: "/transcript/1" }]);
    const aRender = await expectMessage(a, "render");
    expect(aRender.ops).toEqual([{ op: "remove", target: `#m${secondId}` }]);

    expect(await bPatch).toMatchObject({ type: "patch", doc: "room" });
    expect((await bRender).ops).toEqual([{ op: "remove", target: `#m${secondId}` }]);

    const entries = history(`room:${room}`);
    expect(entries).toHaveLength(3); // two sends, one undo
    expect(entries[0]?.ops).toEqual([{ op: "remove", path: "/transcript/1" }]);

    // Bob sends after Alice's first; Alice undoes her first: Bob's message now starts a run, so
    // its <li> is redrawn (with his name) beside the removal.
    let aIncoming = nextMessage(a);
    let aRenderIncoming = nextMessage(a);
    write(b, "room", [{ op: "add", path: "/transcript/-", value: "bob after" }]);
    await expectMessage(b, "patch");
    await expectMessage(b, "render");
    await aIncoming;
    await aRenderIncoming;
    const [firstId, bobId] = readRoom(room).transcript.map((m) => m.id);
    const bRender2 = nextMessage(b);
    write(a, "ledger", [{ op: "remove", path: "/latest" }]);
    await expectMessage(a, "patch");
    const aUndo = await expectMessage(a, "render");
    expect(aUndo.ops).toMatchObject([{ op: "remove", target: `#m${firstId}` }, { op: "replace", target: `#m${bobId}` }]);
    expect(htmlOf(aUndo)).toContain('<span class="name">Bob</span>');
    expect(await bRender2).toMatchObject({ type: "patch" }); // Bob's echo of Alice's undo
    expect((await nextMessage(b)).ops).toMatchObject([{ op: "remove", target: `#m${firstId}` }, { op: "replace", target: `#m${bobId}` }]);

    a.close();
    b.close();
  });

  test("send-message with blank text does not crash and does not stop further messages", async () => {
    const ws = connect();
    await login(ws, "Blank", crypto.randomUUID());

    write(ws, "room", [{ op: "add", path: "/transcript/-", value: "   " }]);
    // rejected by documents/room.ts::patch() (blank text): no patch echo, just the unchanged full render
    await expectMessage(ws, "render");

    const uniqueText = `after blank ${crypto.randomUUID()}`;
    write(ws, "room", [{ op: "add", path: "/transcript/-", value: uniqueText }]);
    await expectMessage(ws, "patch");
    const message = await expectMessage(ws, "render");

    expect(htmlOf(message)).toContain(uniqueText);
    ws.close();
  });

  test("a room write from a connection not currently in a room is rejected", async () => {
    const ws = connect();
    await opened(ws);
    await expectMessage(ws, "render");
    write(ws, "session", [{ op: "replace", path: "/name", value: "NoRoom" }]);
    await expectMessage(ws, "patch");
    await expectMessage(ws, "render"); // room selector, not in any room

    write(ws, "room", [{ op: "add", path: "/transcript/-", value: "hello?" }]);
    // rejected: resolveDoc finds no current room, so permit/write are never reached
    const message = await expectMessage(ws, "render");
    expect(htmlOf(message)).toContain('class="cell open" data-key="rooms"');
    ws.close();
  });

  test("closing a connection removes it from the room without breaking future broadcasts", async () => {
    const room = crypto.randomUUID();
    const a = connect();
    await login(a, "RoomLeaverA", room);

    const bJoined = presenceUpdate(a); // subscribe before B joins, to avoid missing the broadcast
    const b = connect();
    await login(b, "RoomLeaverB", room);
    await bJoined; // people broadcast triggered by B joining, not this test's focus

    const bLeft = presenceUpdate(a); // subscribe before B closes, to avoid missing the broadcast
    b.close();
    await bLeft; // people broadcast triggered by B leaving, not this test's focus

    const uniqueText = `still works after b left ${crypto.randomUUID()}`;
    write(a, "room", [{ op: "add", path: "/transcript/-", value: uniqueText }]);
    await expectMessage(a, "patch");
    const message = await expectMessage(a, "render");

    expect(htmlOf(message)).toContain(uniqueText);
    a.close();
  });
});
