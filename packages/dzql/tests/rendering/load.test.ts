import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { connect as tcp } from "node:net";
import { createTables, defineDoc, defineSchema, registerDocs } from "@blueshed/delta/sqlite";
import { createLocal } from "@blueshed/delta/local";
import type { Resource } from "../../src/rendering/resources/resource";
import type { Example } from "../../src/rendering/example";
import { read, serverWrite } from "../../src/rendering/documents";
import { esc } from "../../src/rendering/html";
import { part } from "../../src/rendering/parts";
import { createServer, MOST_OPS, MOST_WAITING, TOO_MANY_OPS } from "../../src/rendering/server";
import { connect, expectMessage, heard, nextMessage, open, opened, pageOf, write, type WireMessage } from "../../src/rendering/test-socket";
import index from "./server.test.fixture.html";

// The server under load: each connection's events in a queue of its own, a page drawn once for all
// the changes told while it waited, what one connection may ask of it, and a page that reads slower
// than it is sent to. A wall of posts everyone reads, kept in a delta of this file's own.
const db = new Database(":memory:");
const schema = defineSchema({
  walls: { columns: {}, temporal: false },
  posts: { parent: "walls", columns: { text: "text" }, temporal: false },
});
createTables(db, schema);
const delta = createLocal();
registerDocs(delta.server, db, schema, [defineDoc("wall:", { root: "walls", include: ["posts"], implied: true })], [], { ledger: true });

/** A post whose writer is held after it lands, until the test lets it go, and then posts again: its connection's next event waits on it, and no other's does. */
let held: { landed: () => void; go: Promise<void> } | undefined;
let landed: Promise<void> = Promise.resolve();
function hold(): () => void {
  let go!: () => void;
  let told!: () => void;
  landed = new Promise((resolve) => (told = resolve));
  held = { landed: told, go: new Promise((resolve) => (go = resolve)) };
  return go;
}

/** Each connection closed, as the server hears it. */
const closed: string[] = [];

const wall: Resource = {
  docType: "wall",
  resolveDoc: () => "1",
  permit: (_ws, op) => op.op === "add" && op.path === "/posts/-",
  shape: (_ws, _id, ops) => ops.map((op) => ({ ...op, value: { text: String(op.value) } })),
  async afterWrite(_ws, _id, ops) {
    if (ops[0]?.value !== "held" || !held) return;
    held.landed();
    await held.go;
    await serverWrite("wall:1", [{ op: "add", path: "/posts/-", value: { text: "what the held one set going" } }]);
  },
  onClose: (ws) => void closed.push(ws.data.sessionId),
};

type Post = { id: number; text: string };
const posts = (): Post[] => Object.values(read<{ posts: Record<string, Post> }>("wall:1").posts).sort((a, b) => a.id - b.id);

const example: Example = {
  name: "kernel-load-test",
  resources: [wall],
  render: (sessionId) => {
    if (sessionId.startsWith("undrawable")) throw new Error("undrawable"); // a page that cannot be drawn, from the first
    return `<main>${part("posts", `<ul>${posts().map((p) => part(`p${p.id}`, `<li>${esc(p.text)}</li>`)).join("")}</ul>`)}</main>`;
  },
  active: () => true,
  index,
  delta,
};

/** Resolves once `ws` is closed, with its code. */
const closing = (ws: WebSocket): Promise<number> => new Promise((resolve) => ws.addEventListener("close", (e) => resolve(e.code), { once: true }));

describe("the server under load", () => {
  let server: Awaited<ReturnType<typeof createServer>>;
  beforeAll(async () => {
    server = await createServer(example, 0);
  });
  afterAll(() => server.stop(true));

  // Every page that read a change was drawn again for each change, one after another, so a room of
  // two hundred took 33-42 s for fifty messages to reach everyone (the production review, 22 October).
  test("a page is drawn once for every change told while it waited: each change is told, and the page drawn fewer times than there were changes", async () => {
    const reader = await open(server, "reader");
    const writer = await open(server, "writer");
    const said = Array.from({ length: 20 }, (_, i) => `said ${i}`);
    for (const text of said) write(writer, "wall", [{ op: "add", path: "/posts/-", value: text }]);
    await heard(writer);
    const told = await heard(reader);
    expect(told.filter((m) => m.type === "patch")).toHaveLength(20); // every change, told
    expect(told.filter((m) => m.type === "render").length).toBeLessThan(20); // and the page drawn for several at once
    for (const text of said) expect(pageOf(reader)).toContain(`>${text}</li>`); // all of them, drawn
    reader.close();
    writer.close();
  });

  // One queue for every connection: an event waited on every other connection's, and on all they set going.
  test("a connection's events wait on its own before them, and on no other connection's", async () => {
    const [a, b] = [await open(server, "a"), await open(server, "b")];
    const go = hold();
    write(a, "wall", [{ op: "add", path: "/posts/-", value: "held" }]); // lands, then what follows it waits
    await landed;
    const after = write(a, "wall", [{ op: "add", path: "/posts/-", value: "a's next" }]);
    const bs = write(b, "wall", [{ op: "add", path: "/posts/-", value: "b's" }]);
    for (let m = await nextMessage(b); m.id !== bs; m = await nextMessage(b)); // b's write is answered while a's waits
    expect(posts().map((p) => p.text)).not.toContain("a's next");
    go();
    let m: WireMessage;
    for (m = await nextMessage(a); m.id !== after; m = await nextMessage(a)); // and a's, once what was before it is done
    expect(m.type).toBe("patch");
    a.close();
    b.close();
  });

  test("an inspect is answered after every event that came before it, any connection's, and all that it set going", async () => {
    const [a, b] = [await open(server, "c"), await open(server, "d")];
    const go = hold();
    write(a, "wall", [{ op: "add", path: "/posts/-", value: "held" }]);
    await landed; // a's event is under way
    const asked = heard(b);
    let answered = false;
    void asked.then(() => (answered = true));
    await Bun.sleep(50);
    expect(answered).toBe(false); // a's event came first, and is not done
    go();
    await asked;
    expect(pageOf(b)).toContain(">what the held one set going</li>"); // and what it set going, done: b's page drawn with it
    a.close();
    b.close();
  });

  // A write of 21k tests blocked everyone for about 20 s; nothing limited what one connection sent.
  test("a write carries at most MOST_OPS ops, its tests among them: more is refused, saying so", async () => {
    const ws = await open(server, "many");
    const ops = Array.from({ length: MOST_OPS + 1 }, () => ({ op: "add" as const, path: "/posts/-", value: "x" }));
    const id = write(ws, "wall", ops);
    expect(await expectMessage(ws, "refused")).toEqual({ type: "refused", id, reason: TOO_MANY_OPS });
    expect(posts().map((p) => p.text)).not.toContain("x");
    ws.close();
  });

  test("a connection with more than MOST_WAITING events waiting is closed: its page connects again, and is drawn afresh", async () => {
    const ws = await open(server, "flood");
    const code = closing(ws);
    const go = hold();
    write(ws, "wall", [{ op: "add", path: "/posts/-", value: "held" }]);
    await landed;
    for (let i = 0; i < MOST_WAITING; i++) ws.send(JSON.stringify({ type: "page" })); // the held write and these: one more than may wait
    expect(await code).toBe(1008);
    go();
  });

  // Bun drops what is sent past 16 MB to a reader that stopped, and keeps its socket open: of 600
  // sends of 60 KB, 252 were dropped (the production review, 22 October), the page wrong for good.
  test("a page that reads slower than it is sent to is closed once a little waits for it, not sent less than it was told", async () => {
    const reader = tcp(server.port!, "127.0.0.1");
    await new Promise<void>((resolve) => reader.once("connect", resolve));
    reader.write(`GET /ws HTTP/1.1\r\nHost: localhost\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nCookie: session_id=slow-reader\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n`);
    await new Promise<void>((resolve) => reader.once("data", () => resolve()));
    reader.pause(); // and reads nothing more
    const writer = await open(server, "fast-writer");
    const big = (i: number) => `${i} ${crypto.randomUUID().repeat(5000)}`; // 180 KB of what does not compress
    for (let i = 0; i < 60 && !closed.includes("slow-reader"); i++) {
      write(writer, "wall", [{ op: "add", path: "/posts/-", value: big(i) }]);
      await heard(writer);
    }
    expect(closed).toContain("slow-reader");
    reader.destroy();
    writer.close();
  });

  test("a page that cannot be drawn is told so, from its first drawing on", async () => {
    const ws = connect(server, "undrawable");
    await opened(ws);
    expect(await nextMessage(ws)).toEqual({ type: "failed" });
    ws.close();
  });
});
