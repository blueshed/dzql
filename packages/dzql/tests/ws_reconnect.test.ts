import { describe, test, expect, afterEach } from "bun:test";
import { WebSocketManager } from "../src/client/ws";

// A server on a port of its own: a reconnect must come back to it, not to the
// default ws://localhost:3000/ws.
function server() {
  const opened: unknown[] = [];
  const sockets = new Set<any>();
  const srv = Bun.serve({
    port: 0,
    fetch(req, s) { return s.upgrade(req) ? undefined : new Response("no", { status: 400 }); },
    websocket: {
      open(ws) { opened.push(ws); sockets.add(ws); },
      close(ws) { sockets.delete(ws); },
      message() {},
    },
  });
  return { srv, opened, sockets, url: `ws://localhost:${srv.port}/ws` };
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
let stops: (() => void)[] = [];
afterEach(() => { for (const stop of stops) stop(); stops = []; });

describe("WebSocketManager reconnect", () => {
  test("a reconnect goes back to the URL it connected to", async () => {
    const s = server();
    const ws = new WebSocketManager({ maxReconnectAttempts: 1 });
    stops.push(() => { ws.disconnect(); s.srv.stop(true); });
    await ws.connect(s.url);
    for (const sock of s.sockets) sock.close();   // the server drops it
    await wait(1300);
    expect(s.opened.length).toBe(2);
  });

  test("after disconnect() nothing reconnects", async () => {
    const s = server();
    const ws = new WebSocketManager({ maxReconnectAttempts: 1 });
    stops.push(() => s.srv.stop(true));
    await ws.connect(s.url);
    ws.disconnect();
    await wait(1300);
    expect(s.opened.length).toBe(1);
  });

  test("a socket replaced by a later connect() does not reconnect", async () => {
    const s = server();
    const ws = new WebSocketManager({ maxReconnectAttempts: 1 });
    stops.push(() => { ws.disconnect(); s.srv.stop(true); });
    await ws.connect(s.url);
    await ws.connect(s.url);   // the first socket is left behind, then closed by the server
    for (const sock of [...s.sockets].slice(0, 1)) sock.close();
    await wait(1300);
    expect(s.opened.length).toBe(2);
  });

  test("a reconnect that fails raises nothing unhandled", async () => {
    const s = server();
    const ws = new WebSocketManager({ maxReconnectAttempts: 1 });
    stops.push(() => ws.disconnect());
    await ws.connect(s.url);
    s.srv.stop(true);   // gone: the reconnect is refused
    await wait(1300);
    expect(ws.ready).toBe(false);
  });
});
