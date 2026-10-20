import { expect } from "bun:test";
import { applyOps, type DeltaOp } from "@blueshed/delta/core";
import type { Local } from "@blueshed/delta/local";
import { hear, type Heard } from "./resources/render";
import type { PatchOp, Test, WriteId } from "./json-patch";
import { cookieNameForUrl } from "./scope";

// A socket to a running app, as a test holds it: everything the app sends it, in order, and the page
// it holds once each render is laid on, as the browser keeps it (the harness's `hear`). For what a
// story cannot say -- two writes racing, a message that is not a write -- in the kernel's tests and
// an app's own. A persistent queue per socket, not a listener per wait: two messages sent back to
// back (an echo, then its render) both arrive before a test awaits the second. Beside it, the app's
// documents as its page reads them (`documentsOf`), the same for the light page and the thin one:
// a test of a document is written once, and the page itself is tested in a browser, where both
// pages are the bento's HTML.

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

/** A socket to `server` -- or to anything with its address, a proxy that measures the wire -- as the session `sessionId` (a fresh visit without one), a tab opened at `at` (none: a socket that names no address). */
export function connect(server: { url: URL | string }, sessionId?: string, at?: string): WebSocket {
  // the socket itself (a tap's), or an app's, at its root or under its path
  const base = String(server.url).replace(/\/$/, "");
  const url = new URL(base.endsWith("/ws") ? base : `${base}/ws`);
  if (at !== undefined) url.searchParams.set("at", at); // the address a tab's URL names, as the client sends it
  url.protocol = "ws:";
  // @ts-expect-error Bun's runtime-only `headers` option on WebSocket
  const ws: WebSocket = sessionId ? new WebSocket(url, { headers: { Cookie: `${cookieNameForUrl(url)}=${sessionId}` } }) : new WebSocket(url);
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

/**
 * A document a test holds, as a page reads it: its value, kept current from what it is told; a
 * write to it, answered as delta answers (refused, it rejects with delta's `{ code, message }`),
 * and resolved once the change is told back, so the value has it; and each change as it is told.
 */
export type Holding<T> = { value(): T; send(ops: DeltaOp[]): Promise<any>; onOps(fn: (ops: DeltaOp[]) => void): () => void };

/** A test's client of an app's documents: a document held (`open`), its last write undone (`undo`), and let go (`close`). */
export type DocumentsClient = { open<T = any>(doc: string): Promise<Holding<T>>; undo(): Promise<any>; close(): void };

/**
 * A test's client of an app's documents, the same for either page: over delta's socket at a
 * server's `/ws` (the light page's: give the server), or over the app's documents in this process
 * (the thin client's: give its store's `delta`, which its page reads). A test written against it
 * stays as it is when the app moves its page to the server; only what it is given changes.
 */
export async function documentsOf(from: { url: URL | string } | Local): Promise<DocumentsClient> {
  return "url" in from ? overSocket(from.url) : inProcess(from);
}

/** Of delta's client, what the light page's tests use: a thin app has no railroad, which it imports. */
type SocketClient = { send(msg: Record<string, unknown>): Promise<any>; close(): void };
type SocketDoc<T> = { ready: Promise<unknown>; data: { peek(): T | null }; send(ops: DeltaOp[]): Promise<any>; onOps(fn: (ops: DeltaOp[]) => void): () => void };
/** Named, not written in the import: a thin app's type check then never reads delta's client. */
const DELTA_CLIENT = "@blueshed/delta/client";

/** delta's own client, on the socket a light page opens. */
async function overSocket(url: URL | string): Promise<DocumentsClient> {
  const { connectWs, openDoc } = (await import(DELTA_CLIENT)) as { connectWs(url: string): SocketClient; openDoc<T>(doc: string, client: SocketClient): SocketDoc<T> };
  const client = connectWs(new URL("/ws", url).href);
  return {
    async open<T>(doc: string) {
      const held = openDoc<T>(doc, client);
      await held.ready;
      return { value: () => held.data.peek() as T, send: (ops: DeltaOp[]) => held.send(ops), onOps: (fn: (ops: DeltaOp[]) => void) => held.onOps(fn) };
    },
    undo: () => client.send({ action: "undo" }),
    close: () => client.close(),
  };
}

/** The app's documents in this process, as its page reads them: a copy each, kept from delta's stream; the writes on a cursor of the test's own. */
function inProcess(local: Local): DocumentsClient {
  const cursor = `test-${crypto.randomUUID()}`;
  const held = new Map<string, { value: any; v?: number; told: Set<(ops: DeltaOp[]) => void> }>();
  const unheard = local.onPublish((doc, data) => {
    const h = held.get(doc);
    if (!h || !data || data.doc !== doc || !Array.isArray(data.ops) || (data.v !== undefined && h.v !== undefined && data.v <= h.v)) return;
    applyOps(h.value, data.ops);
    if (data.v !== undefined) h.v = data.v;
    for (const fn of h.told) fn(data.ops);
  });
  const answer = async (action: string, msg: Record<string, unknown>) => {
    const { result, error } = await local.call(action, msg);
    if (error) throw error;
    return result;
  };
  return {
    async open<T>(doc: string) {
      const { _v, ...value } = await answer("open", { doc });
      const h = { value, v: _v === undefined ? undefined : Number(_v), told: new Set<(ops: DeltaOp[]) => void>() };
      held.set(doc, h);
      return {
        value: () => h.value as T,
        async send(ops: DeltaOp[]) {
          const result = await answer("delta", { doc, ops, cursor });
          // told back, as a socket's client is before its send resolves
          for (let i = 0; i < 400 && result?.version !== undefined && (h.v ?? 0) < result.version; i++) await Bun.sleep(5);
          return result;
        },
        onOps(fn: (ops: DeltaOp[]) => void) {
          h.told.add(fn);
          return () => void h.told.delete(fn);
        },
      };
    },
    undo: () => answer("undo", { cursor }),
    close: unheard,
  };
}
