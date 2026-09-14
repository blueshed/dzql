import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { PatchOp } from "./json-patch";
import { createServer } from "./server";

let server: ReturnType<typeof createServer>;

beforeAll(() => {
  server = createServer(0);
});

afterAll(() => {
  server.stop(true);
});

type WireMessage = { type: string; html: string; selector?: string; doc?: string; version?: number; ops?: unknown[] };

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

  test("unknown route returns 404", async () => {
    const res = await fetch(new URL("/nope", server.url));
    expect(res.status).toBe(404);
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
    expect(message.html).toContain('data-write=\'{"doc":"session","op":"replace","path":"/name"}\'');
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

    expect(message.html).toContain("Still here");
    ws.close();
  });

  test("an empty ops array does not crash and just re-renders the current state", async () => {
    const ws = connect();
    await opened(ws);
    await expectMessage(ws, "render");

    write(ws, "session", []);
    const message = await expectMessage(ws, "render");

    expect(message.html).toContain('data-write=\'{"doc":"session","op":"replace","path":"/name"}\'');
    ws.close();
  });

  test("a write with no value is rejected without crashing", async () => {
    const ws = connect();
    await opened(ws);
    await expectMessage(ws, "render");

    write(ws, "session", [{ op: "replace", path: "/name" } as PatchOp]);
    // rejected (blank name): no patch echo, just the unchanged render
    const message = await expectMessage(ws, "render");

    expect(message.html).toContain('data-write=\'{"doc":"session","op":"replace","path":"/name"}\''); // no name was set
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

    expect(message.html).toContain("&lt;b&gt;Ada&lt;/b&gt;");
    expect(message.html).toContain('data-write=\'{"doc":"session","op":"remove","path":"/name"}\'');
    expect(message.html).toContain('data-applet="room-picker"');
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
    await expectMessage(ws, "render"); // people broadcast for the room just joined
    const message = await expectMessage(ws, "render"); // the full chat view

    expect(message.html).toContain(`#${room}`);
    expect(message.html).toContain('data-write=\'{"doc":"room","op":"add","path":"/transcript/-"}\'');
    expect(message.html).toContain('data-write=\'{"doc":"session","op":"remove","path":"/room"}\'');
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
    expect(rejected.html).toContain('data-write=\'{"doc":"session","op":"replace","path":"/name"}\''); // still logged out

    // reactivating afterward must not reveal a room leaked by the rejected write
    write(second, "session", [{ op: "replace", path: "/name", value: "Ada again" }]);
    await expectMessage(second, "patch");
    const reactivated = await expectMessage(second, "render");
    expect(reactivated.html).toContain('data-applet="room-picker"'); // room selector, not a chat view

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
    await expectMessage(ws, "render"); // people broadcast
    await expectMessage(ws, "render"); // full chat view

    write(ws, "session", [{ op: "remove", path: "/room" }]);
    await expectMessage(ws, "patch"); // echo of the session's /room removal
    const message = await expectMessage(ws, "render");

    expect(message.html).toContain('data-applet="room-picker"');
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

    expect(message.html).toContain('data-write=\'{"doc":"session","op":"replace","path":"/name"}\'');
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
    expect(reopened.html).toContain('data-write=\'{"doc":"session","op":"replace","path":"/name"}\'');

    write(second, "session", [{ op: "replace", path: "/name", value: "Ada again" }]);
    await expectMessage(second, "patch");
    const message = await expectMessage(second, "render");

    expect(message.html).toContain("Ada again");
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
    expect(message.html).toContain("Linus");
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
    await expectMessage(ws, "render"); // people broadcast for the room just joined
    await expectMessage(ws, "render"); // the full chat view
  }

  test("a room's people list updates live as someone else joins and leaves", async () => {
    const room = crypto.randomUUID();
    const a = connect();
    await login(a, "Alice", room);

    const joined = nextMessage(a); // subscribe before Bob joins, to avoid a race
    const b = connect();
    await login(b, "Bob", room);

    const joinedUpdate = await joined;
    expect(joinedUpdate.type).toBe("render");
    expect(joinedUpdate.selector).toBe(".people");
    expect(joinedUpdate.html).toBe("Alice, Bob");

    const left = nextMessage(a);
    b.close();
    const leftUpdate = await left;
    expect(leftUpdate.selector).toBe(".people");
    expect(leftUpdate.html).toBe("Alice");

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

    const aJoined = nextMessage(a); // subscribe before Carol joins, to avoid a race
    const bJoined = nextMessage(b);
    const c = connect();
    await login(c, "Carol", room);

    const aJoinedUpdate = await aJoined;
    expect(aJoinedUpdate.selector).toBe(".people");
    expect(aJoinedUpdate.html).toBe("Alice, Carol"); // not "Alice, Alice, Carol": two sockets, one person
    expect((await bJoined).html).toBe("Alice, Carol");

    const aStillThere = nextMessage(a); // subscribe before b's tab closes
    b.close();
    const stillThereUpdate = await aStillThere;
    expect(stillThereUpdate.selector).toBe(".people");
    expect(stillThereUpdate.html).toBe("Alice, Carol"); // Alice's other tab is still in the room

    a.close();
    c.close();
  });

  test("logging out while in a room leaves it, broadcasting presence to the remaining members", async () => {
    const room = crypto.randomUUID();
    const a = connect();
    await login(a, "Alice", room);

    const bJoined = nextMessage(a); // subscribe before Bob joins, to avoid missing the broadcast
    const b = connect();
    await login(b, "Bob", room);
    await bJoined; // people broadcast triggered by Bob joining, not this test's focus

    const bLeft = nextMessage(a); // subscribe before Bob logs out
    write(b, "session", [{ op: "remove", path: "/name" }]);
    const bLeftUpdate = await bLeft;

    expect(bLeftUpdate.selector).toBe(".people");
    expect(bLeftUpdate.html).toBe("Alice");

    a.close();
    b.close();
  });

  test("send-message broadcasts to every connected room member, echoing the write first", async () => {
    const room = crypto.randomUUID();
    const a = connect();
    await login(a, "Alice", room);

    const bJoined = nextMessage(a); // subscribe before Bob joins, to avoid missing the broadcast
    const b = connect();
    await login(b, "Bob", room);
    await bJoined; // people broadcast triggered by Bob joining, not this test's focus

    const uniqueText = `hello from alice ${crypto.randomUUID()}`;
    const bPatch = nextMessage(b); // subscribe before sending, to avoid a race
    write(a, "room", [{ op: "add", path: "/transcript/-", value: uniqueText }]);

    const aPatch = await expectMessage(a, "patch");
    expect(aPatch.doc).toBe("room");
    expect(aPatch.ops).toEqual([{ op: "add", path: "/transcript/-", value: { name: "Alice", text: uniqueText } }]);
    const aReceived = await expectMessage(a, "append");

    expect(await bPatch).toMatchObject({ type: "patch", doc: "room" });
    const bMessage = await expectMessage(b, "append");

    // a granular append, not a full view re-render
    expect(aReceived.selector).toBe(".messages");
    expect(aReceived.html).not.toContain("data-write");
    expect(aReceived.html).toContain(uniqueText);
    expect(bMessage.html).toContain(uniqueText);
    a.close();
    b.close();
  });

  test("send-message with blank text does not crash and does not stop further messages", async () => {
    const ws = connect();
    await login(ws, "Blank", crypto.randomUUID());

    write(ws, "room", [{ op: "add", path: "/transcript/-", value: "   " }]);
    // rejected by permit (blank text): no patch echo, just the unchanged full render
    await expectMessage(ws, "render");

    const uniqueText = `after blank ${crypto.randomUUID()}`;
    write(ws, "room", [{ op: "add", path: "/transcript/-", value: uniqueText }]);
    await expectMessage(ws, "patch");
    const message = await expectMessage(ws, "append");

    expect(message.html).toContain(uniqueText);
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
    expect(message.html).toContain('data-applet="room-picker"');
    ws.close();
  });

  test("closing a connection removes it from the room without breaking future broadcasts", async () => {
    const room = crypto.randomUUID();
    const a = connect();
    await login(a, "RoomLeaverA", room);

    const bJoined = nextMessage(a); // subscribe before B joins, to avoid missing the broadcast
    const b = connect();
    await login(b, "RoomLeaverB", room);
    await bJoined; // people broadcast triggered by B joining, not this test's focus

    const bLeft = nextMessage(a); // subscribe before B closes, to avoid missing the broadcast
    b.close();
    await bLeft; // people broadcast triggered by B leaving, not this test's focus

    const uniqueText = `still works after b left ${crypto.randomUUID()}`;
    write(a, "room", [{ op: "add", path: "/transcript/-", value: uniqueText }]);
    await expectMessage(a, "patch");
    const message = await expectMessage(a, "append");

    expect(message.html).toContain(uniqueText);
    a.close();
  });
});
