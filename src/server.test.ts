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

function nextMessage(ws: WebSocket): Promise<{ type: string; html: string }> {
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

  test("set-name renders a user bar with the escaped name", async () => {
    const ws = connect();
    await opened(ws);
    await nextMessage(ws); // initial name form

    ws.send(JSON.stringify({ name: "set-name", payload: { name: "<b>Ada</b>" } }));
    const message = await nextMessage(ws);

    expect(message.html).toContain("&lt;b&gt;Ada&lt;/b&gt;");
    expect(message.html).toContain('data-event="logout"');
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
