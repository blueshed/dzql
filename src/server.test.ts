import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createServer } from "./server";

let server: ReturnType<typeof createServer>;

beforeAll(() => {
  server = createServer(0);
});

afterAll(() => {
  server.stop(true);
});

function connect(cookie?: string): WebSocket {
  const url = new URL("/ws", server.url);
  url.protocol = "ws:";
  const options = cookie ? { headers: { Cookie: cookie } } : undefined;
  // tsconfig's DOM lib shadows Bun's WebSocket type, which supports `headers` at runtime.
  // @ts-expect-error
  return new WebSocket(url, options);
}

function opened(ws: WebSocket): Promise<void> {
  return new Promise((resolve) => ws.addEventListener("open", () => resolve(), { once: true }));
}

function nextMessage(ws: WebSocket): Promise<{ type: string; html: string; selector?: string }> {
  return new Promise((resolve) =>
    ws.addEventListener("message", (event) => resolve(JSON.parse(event.data as string)), { once: true }),
  );
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

describe("websocket session protocol", () => {
  test("non-upgrade request to /ws is rejected", async () => {
    const res = await fetch(new URL("/ws", server.url));
    expect(res.status).toBe(400);
  });

  test("a new connection is greeted with the name form", async () => {
    const ws = connect();
    await opened(ws);
    const message = await nextMessage(ws);
    expect(message.type).toBe("render");
    expect(message.html).toContain('data-event="set-name"');
    ws.close();
  });

  test("invalid JSON is ignored instead of crashing the connection", async () => {
    const ws = connect();
    await opened(ws);
    await nextMessage(ws); // initial name form

    ws.send("not-json{{{"); // produces no response; the server must not crash

    ws.send(JSON.stringify({ name: "set-name", payload: { name: "Still here" } }));
    const message = await nextMessage(ws);

    expect(message.html).toContain("Still here");
    ws.close();
  });

  test("a set-name event without a payload does not crash the connection", async () => {
    const ws = connect();
    await opened(ws);
    await nextMessage(ws); // initial name form

    ws.send(JSON.stringify({ name: "set-name" })); // missing `payload`
    const message = await nextMessage(ws);

    expect(message.html).toContain('data-event="set-name"'); // no name was set
    ws.close();
  });

  test("set-name renders a room selector with the escaped name", async () => {
    const ws = connect();
    await opened(ws);
    await nextMessage(ws); // initial name form

    ws.send(JSON.stringify({ name: "set-name", payload: { name: "<b>Ada</b>" } }));
    const message = await nextMessage(ws);

    expect(message.html).toContain("&lt;b&gt;Ada&lt;/b&gt;");
    expect(message.html).toContain('data-event="logout"');
    expect(message.html).toContain('data-applet="room-picker"');
    ws.close();
  });

  test("join-room renders the chat view for that room", async () => {
    const ws = connect();
    await opened(ws);
    await nextMessage(ws); // initial name form

    ws.send(JSON.stringify({ name: "set-name", payload: { name: "Ada" } }));
    await nextMessage(ws); // room selector

    const room = crypto.randomUUID();
    ws.send(JSON.stringify({ name: "join-room", payload: { room } }));
    await nextMessage(ws); // people broadcast for the room just joined
    const message = await nextMessage(ws); // the full chat view

    expect(message.html).toContain(`#${room}`);
    expect(message.html).toContain('data-event="send-message"');
    expect(message.html).toContain('data-event="leave-room"');
    ws.close();
  });

  test("leave-room returns to the room selector", async () => {
    const ws = connect();
    await opened(ws);
    await nextMessage(ws);
    ws.send(JSON.stringify({ name: "set-name", payload: { name: "Ada" } }));
    await nextMessage(ws);
    ws.send(JSON.stringify({ name: "join-room", payload: { room: crypto.randomUUID() } }));
    await nextMessage(ws); // people broadcast
    await nextMessage(ws); // full chat view

    ws.send(JSON.stringify({ name: "leave-room", payload: {} }));
    const message = await nextMessage(ws);

    expect(message.html).toContain('data-applet="room-picker"');
    ws.close();
  });

  test("logout clears the session and re-renders the name form", async () => {
    const ws = connect();
    await opened(ws);
    await nextMessage(ws);

    ws.send(JSON.stringify({ name: "set-name", payload: { name: "Grace" } }));
    await nextMessage(ws);

    ws.send(JSON.stringify({ name: "logout", payload: {} }));
    const message = await nextMessage(ws);

    expect(message.html).toContain('data-event="set-name"');
    ws.close();
  });

  test("a revoked session can set a new name again (soft-delete, not gone forever)", async () => {
    const cookie = `session_id=${crypto.randomUUID()}`;

    const first = connect(cookie);
    await opened(first);
    await nextMessage(first);
    first.send(JSON.stringify({ name: "set-name", payload: { name: "Ada" } }));
    await nextMessage(first);
    first.send(JSON.stringify({ name: "logout", payload: {} }));
    await nextMessage(first);
    first.close();

    const second = connect(cookie);
    await opened(second);
    const reopened = await nextMessage(second);
    expect(reopened.html).toContain('data-event="set-name"');

    second.send(JSON.stringify({ name: "set-name", payload: { name: "Ada again" } }));
    const message = await nextMessage(second);

    expect(message.html).toContain("Ada again");
    second.close();
  });

  test("reconnecting with the same session cookie remembers the name", async () => {
    const cookie = `session_id=${crypto.randomUUID()}`;

    const first = connect(cookie);
    await opened(first);
    await nextMessage(first);
    first.send(JSON.stringify({ name: "set-name", payload: { name: "Linus" } }));
    await nextMessage(first);
    first.close();

    const second = connect(cookie);
    await opened(second);
    const message = await nextMessage(second);
    expect(message.html).toContain("Linus");
    second.close();
  });
});

describe("chat", () => {
  async function login(ws: WebSocket, name: string, room: string): Promise<void> {
    await opened(ws);
    await nextMessage(ws); // initial name form
    ws.send(JSON.stringify({ name: "set-name", payload: { name } }));
    await nextMessage(ws); // room selector
    ws.send(JSON.stringify({ name: "join-room", payload: { room } }));
    await nextMessage(ws); // people broadcast for the room just joined
    await nextMessage(ws); // the full chat view
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

  test("send-message broadcasts to every connected room member", async () => {
    const room = crypto.randomUUID();
    const a = connect();
    await login(a, "Alice", room);

    const bJoined = nextMessage(a); // subscribe before Bob joins, to avoid missing the broadcast
    const b = connect();
    await login(b, "Bob", room);
    await bJoined; // people broadcast triggered by Bob joining, not this test's focus

    const uniqueText = `hello from alice ${crypto.randomUUID()}`;
    const bReceived = nextMessage(b); // subscribe before sending, to avoid a race
    a.send(JSON.stringify({ name: "send-message", payload: { text: uniqueText } }));
    const aReceived = await nextMessage(a);
    const bMessage = await bReceived;

    // a granular append, not a full view re-render
    expect(aReceived.type).toBe("append");
    expect(aReceived.selector).toBe(".messages");
    expect(aReceived.html).not.toContain('data-event="send-message"');
    expect(aReceived.html).toContain(uniqueText);
    expect(bMessage.type).toBe("append");
    expect(bMessage.html).toContain(uniqueText);
    a.close();
    b.close();
  });

  test("send-message with blank text does not crash and does not stop further messages", async () => {
    const ws = connect();
    await login(ws, "Blank", crypto.randomUUID());

    ws.send(JSON.stringify({ name: "send-message", payload: { text: "   " } }));
    const blankResponse = await nextMessage(ws);
    expect(blankResponse.type).toBe("render"); // no-op falls through to the normal full render

    const uniqueText = `after blank ${crypto.randomUUID()}`;
    ws.send(JSON.stringify({ name: "send-message", payload: { text: uniqueText } }));
    const message = await nextMessage(ws);

    expect(message.type).toBe("append");
    expect(message.html).toContain(uniqueText);
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
    a.send(JSON.stringify({ name: "send-message", payload: { text: uniqueText } }));
    const message = await nextMessage(a);

    expect(message.type).toBe("append");
    expect(message.html).toContain(uniqueText);
    a.close();
  });
});
