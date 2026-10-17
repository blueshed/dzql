import { expect } from "bun:test";
import { hear, type Heard } from "../modelling/harness";
import type { PatchOp, Test, WriteId } from "./json-patch";

// A socket to a running app, as a test holds it: everything the app sends it, in order, and the page
// it holds once each render is laid on, as the browser keeps it (the harness's `hear`). For what a
// story cannot say -- two writes racing, a message that is not a write -- in the kernel's tests and
// an app's own. A persistent queue per socket, not a listener per wait: two messages sent back to
// back (an echo, then its render) both arrive before a test awaits the second.

/** A message from the server; a render also carries `page`, the page held once it is laid on. */
export type WireMessage = {
  type: string;
  html?: string;
  doc?: string;
  version?: number;
  ops?: any[];
  id?: WriteId;
  change?: string;
  entry?: number;
  reason?: string;
  wire?: number;
  docs?: { doc: string; version: number; entries?: { ops: PatchOp[] }[] }[];
  page?: string;
};

type Held = { queue: WireMessage[]; waiting: ((m: WireMessage) => void)[]; page: string };
const held = new WeakMap<WebSocket, Held>();
const raws = new WeakMap<WireMessage, string>();

/** A message as it came, for counting its bytes. */
export const rawOf = (m: WireMessage): string => raws.get(m)!;

/** A socket to `server` -- or to anything with its address, a proxy that measures the wire -- as the session `sessionId` (a fresh visit without one). */
export function connect(server: { url: URL | string }, sessionId?: string, at?: string): WebSocket {
  const url = new URL("/ws", server.url);
  if (at !== undefined) url.searchParams.set("at", at); // the screen a tab's URL names, as the client sends it
  url.protocol = "ws:";
  // @ts-expect-error Bun's runtime-only `headers` option on WebSocket
  const ws: WebSocket = sessionId ? new WebSocket(url, { headers: { Cookie: `session_id=${sessionId}` } }) : new WebSocket(url);
  const h: Held = { queue: [], waiting: [], page: "" };
  held.set(ws, h);
  ws.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data)) as WireMessage;
    raws.set(message, String(event.data));
    if (message.type === "render") message.page = h.page = hear(h.page, message as Heard);
    const waiter = h.waiting.shift();
    if (waiter) waiter(message);
    else h.queue.push(message);
  });
  return ws;
}

/** Resolves when the socket is open. */
export const opened = (ws: WebSocket): Promise<void> => new Promise((resolve) => ws.addEventListener("open", () => resolve(), { once: true }));

/** A socket opened, and its first page drawn. */
export async function open(server: { url: URL | string }, sessionId?: string): Promise<WebSocket> {
  const ws = connect(server, sessionId);
  await opened(ws);
  await expectMessage(ws, "render");
  return ws;
}

/** The next message the socket was sent. */
export function nextMessage(ws: WebSocket): Promise<WireMessage> {
  const h = held.get(ws)!;
  return h.queue.length > 0 ? Promise.resolve(h.queue.shift()!) : new Promise((resolve) => h.waiting.push(resolve));
}

/** The next message, which must be of `type`: a wrong sequence fails as one, not as a content mismatch. */
export async function expectMessage(ws: WebSocket, type: string): Promise<WireMessage> {
  const message = await nextMessage(ws);
  expect(message.type).toBe(type);
  return message;
}

/** Nothing arrives in a short window: a write that changed nothing on this socket's page sent it nothing. */
export async function expectQuiet(ws: WebSocket): Promise<void> {
  await Bun.sleep(30);
  expect(held.get(ws)!.queue).toEqual([]);
}

let writes = 0;

/**
 * A write, as a page sends it: with an id, the one given or the next of this module's, which its echo
 * or its refusal hands back, so a refused write is answered (`expectMessage(ws, "refused")`) and
 * nothing waits on silence. The id, returned. A write without one (a page from before ids, the CLI)
 * is `ws.send(JSON.stringify({ doc, ops }))`.
 */
export function write(ws: WebSocket, doc: string, ops: (PatchOp | Test)[], id: WriteId = `t${++writes}`): WriteId {
  ws.send(JSON.stringify({ id, doc, ops }));
  return id;
}

/**
 * Everything the socket was sent until what came before is done: it asks (`inspect`), and the server,
 * handling events in order, answers only after every event before it and all it set going.
 */
export async function heard(ws: WebSocket): Promise<WireMessage[]> {
  ws.send(JSON.stringify({ type: "inspect" }));
  const messages: WireMessage[] = [];
  for (let m = await nextMessage(ws); m.type !== "inspect"; m = await nextMessage(ws)) messages.push(m);
  return messages;
}

/** Lets go of what the socket was sent so far, unread (a feed's ticks a test does not ask about). */
export const forget = (ws: WebSocket): void => void (held.get(ws)!.queue.length = 0);

/** The page the socket holds now. */
export const pageOf = (ws: WebSocket): string => held.get(ws)!.page;

/** A render's HTML, whether it came as the whole page or as the parts that changed. */
export const htmlOf = (m: WireMessage): string => m.html ?? (m.ops ?? []).map((o: { html?: string }) => o.html ?? "").join("");
