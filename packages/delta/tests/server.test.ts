import { describe, test, expect, afterAll } from "bun:test";
import {
  createWs, registerMethod,
  trackSubscribe, trackUnsubscribe, dropClientSubscriptions, onClientDrop,
} from "../src/server/server";
import { wireAuth, isAuthError, type DeltaAuth } from "../src/server/auth";
import { defineDoc, defineSchema, registerDocs } from "../src/server/json";
import { createLocal } from "../src/server/local";
import { setLogLevel } from "../src/server/logger";
import { mockClient } from "../src/testing";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

setLogLevel("silent");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const mockSocket = (clientId = "test-client") => mockClient({ clientId });

// A note kept in the JSON file: the document the socket and the saving below are tried on.
const notes = defineSchema({ notes: { columns: { text: "text", n: "integer" }, temporal: false } });
const note = defineDoc("note:", { root: "notes", include: [], implied: true });

const tmpDirs: string[] = [];
/** A JSON file in a folder of its own, removed after the suite. */
function tmpFile(tag: string): string {
  const dir = mkdtempSync(join(tmpdir(), `delta-server-${tag}-`));
  tmpDirs.push(dir);
  return join(dir, "data.json");
}
afterAll(() => {
  for (const d of tmpDirs) rmSync(d, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// createWs — unit tests
// ---------------------------------------------------------------------------

describe("createWs", () => {
  test("defaults path to /ws", () => {
    const ws = createWs();
    expect(ws.path).toBe("/ws");
  });

  test("custom path", () => {
    const ws = createWs({ path: "/live" });
    expect(ws.path).toBe("/live");
  });

  test("upgrade is a function", () => {
    const ws = createWs();
    expect(typeof ws.upgrade).toBe("function");
  });

  test("websocket config uses defaults", () => {
    const ws = createWs();
    expect(ws.websocket.idleTimeout).toBe(60);
    expect(ws.websocket.sendPings).toBe(true);
    expect(ws.websocket.publishToSelf).toBe(true);
  });

  test("websocket config accepts overrides", () => {
    const ws = createWs({ idleTimeout: 120, sendPings: false });
    expect(ws.websocket.idleTimeout).toBe(120);
    expect(ws.websocket.sendPings).toBe(false);
  });

  // A WebSocket is not bound by the same-origin policy: without a check, any
  // page a signed-in person visits could open a socket as them.
  describe("the Origin check on upgrade", () => {
    function mockServer() {
      const upgraded: Request[] = [];
      return { upgraded, upgrade(req: Request) { upgraded.push(req); return true; } };
    }
    const upgrade = async (ws: ReturnType<typeof createWs>, headers: Record<string, string>) => {
      const server = mockServer();
      const res = await ws.upgrade(new Request("http://app.example.com:3000/ws", { headers }), server);
      return { res, upgraded: server.upgraded.length === 1 };
    };

    test("a request with no Origin (the CLI, a test, a server) is upgraded", async () => {
      expect(await upgrade(createWs(), {})).toEqual({ res: undefined, upgraded: true });
    });

    test("a browser on the server's own origin is upgraded", async () => {
      expect((await upgrade(createWs(), { origin: "http://app.example.com:3000" })).upgraded).toBe(true);
      // the Host the request came to is the server's origin, whatever scheme a proxy in front terminates
      expect((await upgrade(createWs(), { origin: "https://app.example.com:3000" })).upgraded).toBe(true);
    });

    test("a browser on another origin is refused with 403, before the upgrade", async () => {
      for (const origin of ["https://evil.example", "http://app.example.com:4000", "null", "not a url"]) {
        const { res, upgraded } = await upgrade(createWs(), { origin });
        expect(upgraded).toBe(false);
        expect(res?.status).toBe(403);
      }
    });

    test("origins lets the origins it lists in, and only those", async () => {
      const ws = createWs({ origins: ["https://admin.example.com", "http://localhost:5173/"] });
      expect((await upgrade(ws, { origin: "https://admin.example.com" })).upgraded).toBe(true);
      expect((await upgrade(ws, { origin: "http://localhost:5173" })).upgraded).toBe(true);
      expect((await upgrade(ws, { origin: "http://app.example.com:3000" })).upgraded).toBe(true);   // its own, still
      expect((await upgrade(ws, { origin: "https://evil.example" })).res?.status).toBe(403);
    });

    test('origins: "*" is the explicit opt-out: every origin is let in', async () => {
      expect((await upgrade(createWs({ origins: "*" }), { origin: "https://evil.example" })).upgraded).toBe(true);
    });

    test("an origin in the list that is not a URL is refused when createWs is called", () => {
      expect(() => createWs({ origins: ["admin.example.com"] })).toThrow(/origins/);
    });
  });

  test("open tracks client, close removes it", () => {
    const ws = createWs();
    const sock = mockSocket("c1");
    ws.websocket.open(sock);
    // sendTo should reach the client
    ws.sendTo("c1", { hello: true });
    expect(sock.sent).toEqual([{ hello: true }]);

    ws.websocket.close(sock);
    sock.sent.length = 0;
    ws.sendTo("c1", { hello: true });
    expect(sock.sent).toEqual([]);
  });

  test("action routing dispatches to handler", async () => {
    const ws = createWs();
    const received: any[] = [];
    ws.on("greet", (msg, _ws, respond) => {
      received.push(msg);
      respond({ result: "hi" });
    });

    const sock = mockSocket();
    await ws.websocket.message(sock, JSON.stringify({ id: 1, action: "greet", name: "world" }));
    expect(received).toHaveLength(1);
    expect(received[0].name).toBe("world");
    expect(sock.sent).toEqual([{ id: 1, result: "hi" }]);
  });

  test("unknown action returns error", async () => {
    const ws = createWs();
    const sock = mockSocket();
    await ws.websocket.message(sock, JSON.stringify({ id: 1, action: "nope" }));
    expect(sock.sent[0].error.message).toContain("Unknown action: nope");
  });

  test("unknown action without id is silent", async () => {
    const ws = createWs();
    const sock = mockSocket();
    await ws.websocket.message(sock, JSON.stringify({ action: "nope" }));
    expect(sock.sent).toEqual([]);
  });

  test("a frame with no action is answered with nothing", async () => {
    const ws = createWs();
    const sock = mockSocket();
    await ws.websocket.message(sock, JSON.stringify({ id: 1, data: 42 }));
    expect(sock.sent).toEqual([]);
  });

  test("handler error returns error response", async () => {
    const ws = createWs();
    ws.on("boom", () => { throw new Error("kaboom"); });

    const sock = mockSocket();
    await ws.websocket.message(sock, JSON.stringify({ id: 1, action: "boom" }));
    expect(sock.sent[0].error.message).toBe("kaboom");
  });

  test("only first respond() takes effect", async () => {
    const ws = createWs();
    ws.on("multi", (_msg, _ws, respond) => {
      respond({ result: "first" });
      respond({ result: "second" });
    });

    const sock = mockSocket();
    await ws.websocket.message(sock, JSON.stringify({ id: 1, action: "multi" }));
    expect(sock.sent).toEqual([{ id: 1, result: "first" }]);
  });

  test("unmatched handler returns no-match error", async () => {
    const ws = createWs();
    ws.on("selective", (msg, _ws, _respond) => {
      // doesn't call respond
    });

    const sock = mockSocket();
    await ws.websocket.message(sock, JSON.stringify({ id: 1, action: "selective" }));
    expect(sock.sent[0].error.message).toContain("No handler matched");
  });
});

// ---------------------------------------------------------------------------
// registerMethod — unit tests
// ---------------------------------------------------------------------------

describe("registerMethod", () => {
  test("call dispatches to method handler", async () => {
    const ws = createWs();
    registerMethod(ws, "status", () => ({ version: "1.0" }));

    const sock = mockSocket();
    await ws.websocket.message(sock, JSON.stringify({ id: 1, action: "call", method: "status" }));
    expect(sock.sent[0]).toEqual({ id: 1, result: { version: "1.0" } });
  });

  test("call with params", async () => {
    const ws = createWs();
    registerMethod(ws, "add", (params) => params.a + params.b);

    const sock = mockSocket();
    await ws.websocket.message(sock, JSON.stringify({
      id: 1, action: "call", method: "add", params: { a: 2, b: 3 },
    }));
    expect(sock.sent[0]).toEqual({ id: 1, result: 5 });
  });

  test("call wrong method is not matched", async () => {
    const ws = createWs();
    registerMethod(ws, "status", () => "ok");

    const sock = mockSocket();
    await ws.websocket.message(sock, JSON.stringify({ id: 1, action: "call", method: "other" }));
    expect(sock.sent[0].error.message).toContain("No handler matched");
  });

  test("async method handler", async () => {
    const ws = createWs();
    registerMethod(ws, "slow", async () => {
      await Bun.sleep(10);
      return "done";
    });

    const sock = mockSocket();
    await ws.websocket.message(sock, JSON.stringify({ id: 1, action: "call", method: "slow" }));
    expect(sock.sent[0]).toEqual({ id: 1, result: "done" });
  });

  test("call to a private (_) method is denied before any handler runs", async () => {
    const ws = createWs();
    // a catch-all call handler that would leak if the gate didn't run first
    ws.on("call", (_msg, _ws, respond) => respond({ result: "leaked!" }));

    const sock = mockSocket();
    await ws.websocket.message(sock, JSON.stringify({ id: 1, action: "call", method: "_secret" }));
    expect(sock.sent[0].error.message).toContain("Private method: _secret");
  });

  test("private method call without id is silent", async () => {
    const ws = createWs();
    const sock = mockSocket();
    await ws.websocket.message(sock, JSON.stringify({ action: "call", method: "_secret" }));
    expect(sock.sent).toEqual([]);
  });

  test("registerMethod refuses to register a private (_) name", () => {
    const ws = createWs();
    expect(() => registerMethod(ws, "_helper", () => 1)).toThrow(/private/);
  });

  test("public methods are unaffected by the private gate", async () => {
    const ws = createWs();
    registerMethod(ws, "ok", () => "fine");

    const sock = mockSocket();
    await ws.websocket.message(sock, JSON.stringify({ id: 1, action: "call", method: "ok" }));
    expect(sock.sent[0]).toEqual({ id: 1, result: "fine" });
  });
});

// ---------------------------------------------------------------------------
// Integration — real Bun.serve + WebSocket
// ---------------------------------------------------------------------------

describe("integration", () => {
  const ws = createWs({ path: "/ws" });
  const file = tmpFile("int");
  let server: ReturnType<typeof Bun.serve>;
  let port: number;

  afterAll(async () => {
    server?.stop(true);
  });

  test("server starts and accepts WebSocket", async () => {
    registerDocs(ws, file, notes, [note]);
    registerMethod(ws, "ping", () => "pong");

    server = Bun.serve({ port: 0, routes: { [ws.path]: ws.upgrade }, websocket: ws.websocket });
    ws.setServer(server);
    port = server.port!;

    expect(port).toBeGreaterThan(0);
  });

  function connect(clientId?: string): Promise<WebSocket> {
    const query = clientId ? `?clientId=${clientId}` : "";
    const sock = new WebSocket(`ws://localhost:${port}/ws${query}`);
    return new Promise((resolve, reject) => {
      sock.addEventListener("open", () => resolve(sock));
      sock.addEventListener("error", reject);
    });
  }

  function request(sock: WebSocket, msg: any): Promise<any> {
    const id = Math.random();
    return new Promise((resolve) => {
      const handler = (ev: MessageEvent) => {
        const data = JSON.parse(ev.data);
        if (data.id === id) {
          sock.removeEventListener("message", handler);
          resolve(data);
        }
      };
      sock.addEventListener("message", handler);
      sock.send(JSON.stringify({ ...msg, id }));
    });
  }

  test("open doc over WebSocket", async () => {
    const sock = await connect();
    const res = await request(sock, { action: "open", doc: "note:1" });
    expect(res.result).toEqual({ notes: { id: 1, text: "", n: 0 } });
    sock.close();
  });

  test("delta op over WebSocket, kept in the file", async () => {
    const sock = await connect();
    await request(sock, { action: "open", doc: "note:1" });

    const res = await request(sock, {
      action: "delta",
      doc: "note:1",
      ops: [{ op: "replace", path: "/notes/1/text", value: "hello" }],
    });
    expect(res.result.ack).toBe(true);

    // re-open to verify state
    const res2 = await request(sock, { action: "open", doc: "note:1" });
    expect(res2.result.notes.text).toBe("hello");
    await Bun.sleep(50);   // the save after the write
    expect(JSON.parse(readFileSync(file, "utf8")).tables.notes).toEqual([{ id: 1, text: "hello", n: 0 }]);
    sock.close();
  });

  test("call method over WebSocket", async () => {
    const sock = await connect();
    const res = await request(sock, { action: "call", method: "ping" });
    expect(res.result).toBe("pong");
    sock.close();
  });

  test("private (_) method call is denied over WebSocket", async () => {
    const sock = await connect();
    const res = await request(sock, { action: "call", method: "_secret" });
    expect(res.error.message).toContain("Private method");
    sock.close();
  });

  test("broadcast reaches other subscribers", async () => {
    const sock1 = await connect("c1");
    const sock2 = await connect("c2");

    // both subscribe
    await request(sock1, { action: "open", doc: "note:1" });
    await request(sock2, { action: "open", doc: "note:1" });

    // collect notifications on sock2
    const notifications: any[] = [];
    sock2.addEventListener("message", (ev) => {
      const data = JSON.parse(ev.data);
      if (!data.id) notifications.push(data);
    });

    // sock1 sends a delta
    await request(sock1, {
      action: "delta",
      doc: "note:1",
      ops: [{ op: "replace", path: "/notes/1/text", value: "broadcast" }],
    });

    // give pub/sub a tick
    await Bun.sleep(50);
    // told as the root's field: the root is /notes in its document
    expect(notifications).toContainEqual({ doc: "note:1", ops: [{ op: "replace", path: "/notes/text", value: "broadcast" }] });

    sock1.close();
    sock2.close();
  });

  test("unknown action returns error", async () => {
    const sock = await connect();
    const res = await request(sock, { action: "nope" });
    expect(res.error.message).toContain("Unknown action");
    sock.close();
  });

  test("clientId from query param is used", async () => {
    const sock = await connect("my-id");
    // sendTo should work with the provided clientId
    ws.sendTo("my-id", { custom: true });
    const msg = await new Promise<any>((resolve) => {
      sock.addEventListener("message", (ev) => resolve(JSON.parse(ev.data)));
    });
    expect(msg).toEqual({ custom: true });
    sock.close();
  });
});

// ---------------------------------------------------------------------------
// Review fixes — subscription teardown (#5) + clientId collision (#24)
// ---------------------------------------------------------------------------

describe("subscription tracking + teardown", () => {
  test("dropClientSubscriptions unsubscribes every tracked channel (logout teardown)", () => {
    const client = mockSocket("c1");
    trackSubscribe(client, "doc:a");
    trackSubscribe(client, "doc:b");
    expect(client.subscriptions.has("doc:a")).toBe(true);
    expect(client.subscriptions.has("doc:b")).toBe(true);
    expect([...(client.data as any).channels]).toEqual(["doc:a", "doc:b"]);

    dropClientSubscriptions(client);
    expect(client.subscriptions.size).toBe(0);
    expect((client.data as any).channels.size).toBe(0);
  });

  test("trackUnsubscribe forgets a single channel", () => {
    const client = mockSocket("c1");
    trackSubscribe(client, "doc:a");
    trackSubscribe(client, "doc:b");
    trackUnsubscribe(client, "doc:a");
    expect(client.subscriptions.has("doc:a")).toBe(false);
    expect(client.subscriptions.has("doc:b")).toBe(true);
    expect((client.data as any).channels.has("doc:a")).toBe(false);
  });
});

describe("clientId collision (#24)", () => {
  test("reconnect with same clientId reclaims sendTo addressing once the old socket is gone", () => {
    const ws = createWs();
    const ws1 = mockSocket("foo");
    ws.websocket.open(ws1);
    ws.sendTo("foo", { n: 1 });
    expect(ws1.sent.at(-1)).toEqual({ n: 1 });

    // ws1 drops (dead). ws2 reconnects reusing "foo" — should reclaim it.
    (ws1 as any).readyState = 3; // CLOSED
    const ws2 = mockSocket("foo");
    ws.websocket.open(ws2);
    expect(ws2.data.clientId).toBe("foo");
    ws.sendTo("foo", { n: 2 });
    expect(ws2.sent.at(-1)).toEqual({ n: 2 });
    expect(ws1.sent.at(-1)).toEqual({ n: 1 }); // dead socket got nothing new

    // ws1's late close must NOT delete ws2's mapping.
    ws.websocket.close(ws1);
    ws.sendTo("foo", { n: 3 });
    expect(ws2.sent.at(-1)).toEqual({ n: 3 });
  });

  test("one that came while the id was held takes it when the holder closes -- not one whose close has run (it left the queue)", () => {
    const ws = createWs();
    const a = mockSocket("shared");
    ws.websocket.open(a);
    const left = mockSocket("shared");
    ws.websocket.open(left);
    const b = mockSocket("shared");
    ws.websocket.open(b);
    (left as any).readyState = 3;
    ws.websocket.close(left);   // waited, and went first
    (a as any).readyState = 3;
    ws.websocket.close(a);
    expect(b.data.clientId).toBe("shared");
    ws.sendTo("shared", { to: "b" });
    expect(b.sent.at(-1)).toEqual({ to: "b" });
    expect(left.sent).toEqual([]);
  });

  test("a waiter that is closing (its close not yet run) is passed over: the next one open takes the id", () => {
    const ws = createWs();
    const a = mockSocket("shared");
    ws.websocket.open(a);
    const closing = mockSocket("shared");
    ws.websocket.open(closing);
    const b = mockSocket("shared");
    ws.websocket.open(b);
    (closing as any).readyState = 2;   // CLOSING: Bun has not called close yet
    (a as any).readyState = 3;
    ws.websocket.close(a);
    expect(closing.data.clientId).not.toBe("shared");
    expect(b.data.clientId).toBe("shared");
  });

  test("signed in, the id goes on only to the same person: another waiting on it keeps its own address", () => {
    const ws = createWs();
    const signedIn = (who: string) => Object.assign(mockSocket("shared"), { data: { clientId: "shared", identity: { id: who } } });
    const alice = signedIn("alice");
    ws.websocket.open(alice);
    const mallory = signedIn("mallory");
    ws.websocket.open(mallory);
    const aliceAgain = signedIn("alice");
    ws.websocket.open(aliceAgain);
    (alice as any).readyState = 3;
    ws.websocket.close(alice);
    expect(mallory.data.clientId).not.toBe("shared");
    expect(aliceAgain.data.clientId).toBe("shared");
    ws.sendTo("shared", { to: "alice" });
    expect(aliceAgain.sent.at(-1)).toEqual({ to: "alice" });
    expect(mallory.sent).toEqual([]);

    // and with no one of hers waiting, nobody takes it
    const ws2 = createWs();
    const holder = signedIn("alice");
    ws2.websocket.open(holder);
    const other = signedIn("mallory");
    ws2.websocket.open(other);
    (holder as any).readyState = 3;
    ws2.websocket.close(holder);
    expect(other.data.clientId).not.toBe("shared");
    ws2.sendTo("shared", { to: "nobody" });
    expect(other.sent).toEqual([]);
  });

  test("a different LIVE socket colliding on a clientId is given a fresh id (no hijack)", () => {
    const ws = createWs();
    const a = mockSocket("shared");
    ws.websocket.open(a);
    const b = mockSocket("shared"); // live, collides with live `a`
    ws.websocket.open(b);
    expect(b.data.clientId).not.toBe("shared");
    // `a` still owns "shared".
    ws.sendTo("shared", { to: "a" });
    expect(a.sent.at(-1)).toEqual({ to: "a" });
  });
});

// ---------------------------------------------------------------------------
// Malformed frames (v0.5.0 review #2)
//
// `JSON.parse` used to sit OUTSIDE the try in an async handler, so any
// non-JSON frame rejected with nothing to catch it — an unhandled rejection
// any client could fire at will, and a remote kill for a process running a
// strict `unhandledRejection` handler.
// ---------------------------------------------------------------------------

describe("malformed frames", () => {
  /** Run `fn`, failing if it produces an unhandled rejection. */
  async function withRejectionWatch(fn: () => Promise<void>): Promise<unknown[]> {
    const seen: unknown[] = [];
    const onReject = (err: unknown) => seen.push(err);
    process.on("unhandledRejection", onReject);
    try {
      await fn();
      // Unhandled rejections surface on a later turn, so give them one.
      await new Promise((r) => setTimeout(r, 50));
    } finally {
      process.off("unhandledRejection", onReject);
    }
    return seen;
  }

  test("a non-JSON frame does not produce an unhandled rejection", async () => {
    const ws = createWs();
    const sock = mockSocket();
    const rejections = await withRejectionWatch(async () => {
      await ws.websocket.message(sock, "not json at all");
    });
    expect(rejections).toEqual([]);
    // Nothing to answer on: the id lives inside the frame we couldn't parse.
    expect(sock.sent).toEqual([]);
  });

  test("the socket still serves valid frames afterwards", async () => {
    const ws = createWs();
    registerMethod(ws, "ping", () => "pong");
    const sock = mockSocket();

    await ws.websocket.message(sock, "}{ broken");
    await ws.websocket.message(sock, JSON.stringify({ id: 1, action: "call", method: "ping" }));

    expect(sock.sent.find((m: any) => m.id === 1)?.result).toBe("pong");
  });

  test("a valid frame whose handler throws still answers on its id", async () => {
    // The parse move must not swallow the pre-existing error path.
    const ws = createWs();
    ws.on("boom", () => { throw new Error("kaboom"); });
    const sock = mockSocket();
    await ws.websocket.message(sock, JSON.stringify({ id: 7, action: "boom" }));
    expect(sock.sent.find((m: any) => m.id === 7)?.error?.message).toBe("kaboom");
  });

});

// ---------------------------------------------------------------------------
// The JSON file's saves are one at a time (v0.5.0 review A2)
//
// A save fired without a queue raced the one before it: two rapid writes
// raced whole-file Bun.writes, and the file could settle on the OLDER state.
// What a failed save does is `tests/file.test.ts`'s ("a save that fails").
// ---------------------------------------------------------------------------

describe("the JSON file's saves", () => {
  /** `note:1` in a file of its own, opened and its row made; `set(n)` writes n, not awaited by the caller unless it chooses. */
  async function opened(tag: string) {
    const file = tmpFile(tag);
    const local = createLocal();
    const store = registerDocs(local.server, file, notes, [note]);
    await local.call("open", { doc: "note:1" });
    const set = (n: number) => local.call("delta", { doc: "note:1", ops: [{ op: "replace", path: "/notes/1/n", value: n }] });
    await set(0);   // implied: its first write makes the row
    await store.persisted();
    const saved = (): number => JSON.parse(readFileSync(file, "utf8")).tables.notes[0].n;
    return { local, store, set, saved };
  }

  test("saves never overlap (deterministic — instruments Bun.write)", async () => {
    // Ordering assertions alone are timing-dependent and a poor way to prove a
    // race is gone. Counting concurrent writers is exact: without the queue, N
    // unawaited writes started N concurrent Bun.writes.
    const { store, set, saved } = await opened("persist-overlap");

    const realWrite = Bun.write;
    let inFlight = 0;
    let maxInFlight = 0;
    (Bun as any).write = async (...args: any[]) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      try { return await (realWrite as any)(...args); }
      finally { inFlight--; }
    };
    try {
      for (let i = 1; i <= 20; i++) void set(i);
      await store.persisted();
    } finally {
      (Bun as any).write = realWrite;
    }

    expect(maxInFlight).toBe(1);
    expect(saved()).toBe(20);
  });

  test("rapid writes leave the file on the LATEST state", async () => {
    const { local, store, set, saved } = await opened("persist-order");

    // Fire many without awaiting — the race the queue closes.
    for (let i = 1; i <= 25; i++) void set(i);
    await store.persisted();   // resolves only after the whole queue drains

    expect(saved()).toBe(25);
    expect((await local.call("open", { doc: "note:1" })).result.notes.n).toBe(25);
  });

  test("persisted() resolves once the writes before it are in the file, in call order", async () => {
    const { store, set, saved } = await opened("persist-chain");

    const order: number[] = [];
    const writes = [1, 2, 3].map((i) => {
      void set(i);
      return store.persisted().then(() => {
        expect(saved()).toBeGreaterThanOrEqual(i);
        order.push(i);
      });
    });
    await Promise.all(writes);

    expect(order).toEqual([1, 2, 3]);
    expect(saved()).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// createWs handles a socket's messages side by side, so an `open`
// sent straight after `authenticate`, without waiting for its answer, was
// handled while the authentication still ran, and 401'd. A call that changes
// who the socket is (every action wireAuth wires) now holds that socket's
// later messages until it settles; everything else runs side by side, as it did.
// ---------------------------------------------------------------------------

describe("a call that changes who the socket is holds its later messages (#5)", () => {
  const servers: ReturnType<typeof Bun.serve>[] = [];
  afterAll(() => { for (const s of servers) s.stop(true); });

  /**
   * A server whose `authenticate` takes as long as `signIn` does (a token
   * checked against a database) and whose `logout` takes a moment; `open`
   * answers a signed-in socket only, and, signed in, keeps it as a subscriber
   * until the socket is dropped, as a backend does. `late` opens after `lateMayGo`;
   * `checks-late` asks the gate after a moment (the listener's custom-doc open
   * awaits first), and `subscribes-late` subscribes a moment after the gate said
   * yes (a document read in between). With `logoutAtOnce`, `logout` is
   * jwtAuth's shape: it clears the identity and drops the socket's
   * subscriptions without waiting on anything.
   */
  function serve(opts: { maxHeld?: number; maxHeldBytes?: number; signIn?: Promise<void>; lateMayGo?: Promise<void>; logoutAtOnce?: boolean } = {}) {
    const ws = createWs({ maxHeld: opts.maxHeld, maxHeldBytes: opts.maxHeldBytes });
    const ran: string[] = [];
    const subscribers = new Set<any>();
    const signIns: any[] = [];
    const auth: DeltaAuth<{ id: number }> = {
      actions: {
        async authenticate(_params, client) {
          signIns.push(client);
          await (opts.signIn ?? Bun.sleep(30));
          client.data.identity = { id: 1 };
          return { result: { id: 1 } };
        },
        async logout(_params, client) {
          if (!opts.logoutAtOnce) await Bun.sleep(30);
          delete client.data.identity;
          dropClientSubscriptions(client);
          return { result: { ack: true } };
        },
      },
      gate: (client) => client.data.identity ?? { error: "Authentication required" },
    };
    wireAuth(ws, auth);
    ws.on("open", async (msg, client, respond) => {
      if (msg.doc === "late") await opts.lateMayGo;
      if (msg.doc === "checks-late") await Bun.sleep(20);
      ran.push(`open ${msg.doc}`);
      const who = auth.gate(client);
      if (isAuthError(who)) return respond({ error: { code: 401, message: who.error } });
      if (msg.doc === "subscribes-late") await Bun.sleep(20);
      subscribers.add(client);
      onClientDrop(client, (c) => subscribers.delete(c));
      respond({ result: { doc: msg.doc, who } });
    });
    registerMethod(ws, "slow", async () => { await Bun.sleep(100); return "slow"; });
    registerMethod(ws, "ping", () => "pong");
    const server = Bun.serve({ port: 0, routes: { [ws.path]: ws.upgrade }, websocket: ws.websocket });
    ws.setServer(server);
    servers.push(server);
    return { port: server.port!, ran, subscribers, signIns };
  }

  async function connect(port: number) {
    const sock = new WebSocket(`ws://localhost:${port}/ws`);
    const got = new Map<number, any>();
    const waiting = new Map<number, (m: any) => void>();
    sock.addEventListener("message", (ev) => {
      const m = JSON.parse(String(ev.data));
      got.set(m.id, m);
      waiting.get(m.id)?.(m);
    });
    const closed = new Promise<CloseEvent>((resolve) => sock.addEventListener("close", resolve));
    await new Promise((resolve, reject) => {
      sock.addEventListener("open", resolve);
      sock.addEventListener("error", reject);
    });
    const answer = (id: number): Promise<any> =>
      got.has(id) ? Promise.resolve(got.get(id)) : new Promise((resolve) => waiting.set(id, resolve));
    const send = (id: number, msg: object) => sock.send(JSON.stringify({ id, ...msg }));
    return { sock, answer, send, got, closed };
  }
  const authenticate = { action: "call", method: "authenticate", params: { token: "t" } };
  const open = (doc: string) => ({ action: "open", doc });

  test("an open sent straight after authenticate, without waiting for its answer, is handled signed in", async () => {
    const { port } = serve();
    const c = await connect(port);
    c.send(1, authenticate);
    c.send(2, open("rows"));   // no waiting: straight behind it
    expect((await c.answer(1)).result).toEqual({ id: 1 });
    expect(await c.answer(2)).toEqual({ id: 2, result: { doc: "rows", who: { id: 1 } } });
    c.sock.close();
  });

  test("what waited runs in the order it came, and a logout among it holds what came after it", async () => {
    const { port, ran } = serve();
    const c = await connect(port);
    c.send(1, authenticate);
    c.send(2, open("a"));
    c.send(3, { action: "call", method: "logout" });
    c.send(4, open("b"));
    c.send(5, open("c"));
    expect((await c.answer(2)).result?.who).toEqual({ id: 1 });   // under authenticate
    expect((await c.answer(4)).error?.code).toBe(401);             // under logout, not beside it
    expect((await c.answer(5)).error?.code).toBe(401);
    expect(ran).toEqual(["open a", "open b", "open c"]);
    c.sock.close();
  });

  test("what was held ahead of a logout runs signed in, though it asks the gate late and the logout signs out at once (#5 review)", async () => {
    const { port } = serve({ logoutAtOnce: true });
    const c = await connect(port);
    c.send(1, authenticate);
    c.send(2, open("checks-late"));   // sent signed in
    c.send(3, { action: "call", method: "logout" });
    c.send(4, open("checks-late"));   // sent signed out
    expect((await c.answer(2)).result?.who).toEqual({ id: 1 });
    expect((await c.answer(4)).error?.code).toBe(401);
    c.sock.close();
  });

  test("an open still running when a logout comes is let go by the logout, not left subscribed after it (#5 review)", async () => {
    const { port, subscribers } = serve({ logoutAtOnce: true });
    const c = await connect(port);
    c.send(1, authenticate);
    expect((await c.answer(1)).result).toEqual({ id: 1 });
    c.send(2, open("subscribes-late"));   // past the gate, reading, when the logout arrives
    c.send(3, { action: "call", method: "logout" });
    expect((await c.answer(2)).result?.who).toEqual({ id: 1 });
    expect((await c.answer(3)).result).toEqual({ ack: true });
    expect(subscribers.size).toBe(0);
    c.sock.close();
  });

  test("a sign-in waiting on what came before it does not run when its socket closes meanwhile (#5 review)", async () => {
    let letLateGo!: () => void;
    const lateMayGo = new Promise<void>((r) => (letLateGo = r));
    const { port, signIns } = serve({ lateMayGo });
    const c = await connect(port);
    c.send(1, open("late"));        // running: the sign-in waits for it
    c.send(2, authenticate);
    await Bun.sleep(20);
    c.sock.close();
    await c.closed;
    await Bun.sleep(20);            // the server has run its close
    letLateGo();
    await Bun.sleep(50);
    expect(signIns).toEqual([]);
  });

  test("a slow call that is not a sign-in holds nothing: the socket's next message is answered first", async () => {
    const { port } = serve();
    const c = await connect(port);
    c.send(1, { action: "call", method: "slow" });
    c.send(2, { action: "call", method: "ping" });
    const first = await Promise.race([c.answer(1).then(() => "slow"), c.answer(2).then(() => "ping")]);
    expect(first).toBe("ping");
    expect((await c.answer(1)).result).toBe("slow");
    c.sock.close();
  });

  test("a socket that closes while its messages wait never runs them, and leaves no subscriber behind", async () => {
    let letSignIn!: () => void;
    const signIn = new Promise<void>((r) => (letSignIn = r));
    const { port, ran, subscribers } = serve({ signIn });
    const c = await connect(port);
    c.send(1, authenticate);
    c.send(2, open("rows"));
    await Bun.sleep(20);            // both have arrived: the open waits on the sign-in
    c.sock.close();                 // the tab closes, the network drops
    await c.closed;
    await Bun.sleep(20);
    letSignIn();                    // the sign-in settles after the socket is gone
    await Bun.sleep(50);
    expect(ran).toEqual([]);        // the open never ran for a socket that is gone
    expect(subscribers.size).toBe(0);
  });

  test("what a closed socket held is let go at the close, though the sign-in it waited on never answers", async () => {
    const ws = createWs();
    wireAuth(ws, { actions: { authenticate: () => new Promise(() => {}) }, gate: () => ({ error: "no" }) });
    const sock = mockSocket();
    void ws.websocket.message(sock, JSON.stringify({ id: 1, action: "call", method: "authenticate" }));
    const held: any = ws.websocket.message(sock, JSON.stringify({ id: 2, action: "call", method: "ping" }));
    ws.websocket.close(sock);
    expect(await Promise.race([held.then(() => "let go"), Bun.sleep(100).then(() => "kept")])).toBe("let go");
  });

  test("a held message that closes its socket stops the rest of what was held", async () => {
    const ws = createWs();
    let letSignIn!: () => void;
    const signIn = new Promise<void>((r) => (letSignIn = r));
    wireAuth(ws, { actions: { authenticate: async () => { await signIn; return { result: 1 }; } }, gate: () => ({ error: "no" }) });
    ws.on("bye", (_msg, client) => ws.websocket.close(client));   // a server that shows a socket the door
    const ran: string[] = [];
    registerMethod(ws, "ping", () => { ran.push("ping"); return "pong"; });
    const sock = mockSocket();
    void ws.websocket.message(sock, JSON.stringify({ id: 1, action: "call", method: "authenticate" }));
    void ws.websocket.message(sock, JSON.stringify({ id: 2, action: "bye" }));
    const last: any = ws.websocket.message(sock, JSON.stringify({ id: 3, action: "call", method: "ping" }));
    letSignIn();
    await last;
    expect(ran).toEqual([]);
  });

  test("a message still running when its socket closes has what it registered for the socket let go when it ends", async () => {
    let letLateGo!: () => void;
    const lateMayGo = new Promise<void>((r) => (letLateGo = r));
    const { port, ran, subscribers } = serve({ lateMayGo });
    const c = await connect(port);
    c.send(1, authenticate);
    expect((await c.answer(1)).result).toEqual({ id: 1 });
    c.send(2, open("late"));        // in flight: it subscribes once it gets going again
    await Bun.sleep(20);
    c.sock.close();
    await c.closed;
    await Bun.sleep(20);            // the close has run the socket's drop hooks: none yet
    letLateGo();
    await Bun.sleep(50);
    expect(ran).toEqual(["open late"]);
    expect(subscribers.size).toBe(0);   // its drop hook ran when it ended, not never
  });

  test("a socket may hold maxHeld messages; one more closes it with 1008 and runs none of them", async () => {
    let letSignIn!: () => void;
    const signIn = new Promise<void>((r) => (letSignIn = r));
    const { port, ran } = serve({ maxHeld: 3, signIn });

    const within = await connect(port);
    within.send(1, authenticate);
    for (let i = 2; i <= 4; i++) within.send(i, open(`in${i}`));   // three: at the limit, not past it

    const past = await connect(port);
    past.send(1, authenticate);
    for (let i = 2; i <= 5; i++) past.send(i, open(`past${i}`));   // four: one past it
    const closed = await Promise.race([past.closed, Bun.sleep(1000).then(() => null)]);
    expect(closed?.code).toBe(1008);
    expect(closed?.reason).toMatch(/3 messages/);

    letSignIn();
    for (let i = 2; i <= 4; i++) expect((await within.answer(i)).result?.who).toEqual({ id: 1 });
    await Bun.sleep(30);
    expect(ran.filter((r) => r.startsWith("open past"))).toEqual([]);
    expect(ran).toEqual(["open in2", "open in3", "open in4"]);
    within.sock.close();
  });

  test("a socket may hold maxHeldBytes of messages; one that would take it past closes it with 1008 and runs none of them (#5 review)", async () => {
    let letSignIn!: () => void;
    const signIn = new Promise<void>((r) => (letSignIn = r));
    const { port, ran } = serve({ maxHeldBytes: 1000, signIn });
    const pad = "x".repeat(400);

    const within = await connect(port);
    within.send(1, authenticate);
    within.send(2, open(`a${pad}`));   // ~430 bytes each: two fit
    within.send(3, open(`b${pad}`));

    const past = await connect(port);
    past.send(1, authenticate);
    past.send(2, open(`c${pad}`));
    past.send(3, open(`d${pad}`));
    past.send(4, open(`e${pad}`));     // the third does not
    const closed = await Promise.race([past.closed, Bun.sleep(1000).then(() => null)]);
    expect(closed?.code).toBe(1008);
    expect(closed?.reason).toMatch(/1000 bytes/);

    letSignIn();
    expect((await within.answer(2)).result?.who).toEqual({ id: 1 });
    expect((await within.answer(3)).result?.who).toEqual({ id: 1 });
    await Bun.sleep(30);
    expect(ran).toEqual([`open a${pad}`, `open b${pad}`]);

    within.send(4, { action: "call", method: "logout" });   // what ran no longer counts: as much again waits on this
    within.send(5, open(`f${pad}`));
    within.send(6, open(`g${pad}`));
    const sixth = await Promise.race([within.answer(6).then((m) => m.error?.code), within.closed.then((e) => `closed ${e.code}`)]);
    expect(sixth).toBe(401);   // answered after the logout, not closed
    within.sock.close();
  });
});

// ---------------------------------------------------------------------------
// F6: delta's logger was a stale fork of railroad's. With LOG_LEVEL=verbose
// (a typo) it printed nothing at all, errors included, and it wrote ANSI
// colour codes into pipes. It is railroad's logger now.
// ---------------------------------------------------------------------------

describe("the logger", () => {
  test("is railroad's logger, line for line (re-sync it when railroad's changes)", async () => {
    const code = (src: string) => src.slice(src.indexOf("export type LogLevel"));
    const ours = await Bun.file(new URL("../src/server/logger.ts", import.meta.url)).text();
    const railroads = await Bun.file(Bun.resolveSync("@blueshed/railroad/logger", import.meta.dir)).text();
    expect(code(ours)).toBe(code(railroads));
  });

  test("an unknown LOG_LEVEL still shows errors, and a pipe gets no colour codes", async () => {
    const LOGGER = new URL("../src/server/logger.ts", import.meta.url).pathname;
    const proc = Bun.spawn(["bun", "-e", `const m = await import(${JSON.stringify(LOGGER)}); m.createLogger("[t]").error("ERROR-VISIBLE"); console.log("level=" + m.getLogLevel());`], {
      stdout: "pipe", stderr: "pipe", env: { ...process.env, LOG_LEVEL: "verbose" },
    });
    const out = (await new Response(proc.stdout).text()) + (await new Response(proc.stderr).text());
    await proc.exited;
    expect(out).toContain("ERROR-VISIBLE");
    expect(out).toContain("level=info");
    expect(out).not.toContain("\x1b[");
  });
});
