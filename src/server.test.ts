import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { connect as tcp } from "node:net";
import { constants, deflateRawSync, inflateRawSync } from "node:zlib";
import { createTables, defineDoc, defineSchema, registerDocs } from "@blueshed/delta/sqlite";
import { createLocal } from "@blueshed/delta/local";
import { registerMemory } from "@blueshed/delta/kinds";
import type { Compartment, Walk } from "./compartments/compartment";
import type { Example } from "./example";
import index from "./server.test.fixture.html";
import { WIRE, type PatchOp, type WriteId } from "./json-patch";
import { closeConnection, openConnection, wireName } from "./compartments/audience";
import { read, serverWrite } from "./documents";
import { part } from "./parts";
import { createServer } from "./server";
import { assemble, type Inspection } from "./compartments";
import { onFailure } from "./failed";
import { refuse, tell, toldAt } from "./refusal";

// A tiny, self-contained example -- not chat, not anything under the examples directory -- so
// this file proves the kernel on its own: a note per session (its own document), and months of
// appointments (documents named by criteria), kept in a delta of this file's own.
const db = new Database(":memory:");
const schema = defineSchema({
  notes: { columns: { text: { type: "text", nullable: false, default: "" } as never }, temporal: false },
  months: { columns: {}, temporal: false },
  appointments: { parent: "months", columns: { what: "text" }, temporal: false },
});
createTables(db, schema);
const delta = createLocal();
registerDocs(
  delta.server,
  db,
  schema,
  [defineDoc("note:", { root: "notes", include: [], implied: true }), defineDoc("month:", { root: "months", include: ["appointments"], implied: true })],
  [],
  { ledger: true },
);
// a live document the server writes from outside any event, as a feed's tick is, and slow to follow
registerMemory(delta.server, { prefix: "tick:", empty: () => ({ n: 0 }) });
const tickCompartment: Compartment = { docType: "tick", kind: "live", resolveDoc: () => undefined, afterChange: () => Bun.sleep(60) };

function readNote(id: string): string {
  return read<{ notes: { text: string } }>(`note:${id}`).notes.text;
}

// what each walk of a note was given
const walks: Walk[] = [];

const noteCompartment: Compartment = {
  docType: "note",
  perSession: true,
  under: "/notes",
  resolveDoc(ws) {
    return ws.data.sessionId;
  },
  onOpen(ws) {
    if (ws.data.sessionId === "opens-badly") throw new Error("an open that fails");
  },
  permit(_ws, op) {
    return op.path === "/text" && op.op === "replace";
  },
  shape(_ws, _id, ops) {
    if (ops.some((op) => op.value === "boom")) throw new Error("boom"); // a write whose handling fails
    if (ops.some((op) => op.value === "")) throw refuse("A note needs words."); // a write refused, and why
    return ops;
  },
  afterWrite(ws, _id, ops) {
    if (ops.some((op) => op.value === "then boom")) throw new Error("then boom"); // a write that lands, then fails what follows
    if (ops.some((op) => op.value === "said")) return tell(ws.data.sessionId, { doc: "note", path: "/text", said: "Noted." }); // what it did, beside the control that sent it
  },
  // what a walk of "said" took back, or put back, said over the page, where Undo is
  afterWalk(ws, _id, walk) {
    walks.push(walk);
    const { text } = (walk.way === "undo" ? walk.inverse : walk.ops)[0]!.value as { text: string };
    if (text === "walks badly") throw new Error("walks badly"); // a walk that lands, then fails what follows
    if (text === "said") return tell(ws.data.sessionId, { doc: "ledger", path: "/latest", said: `${walk.way === "undo" ? "Undone" : "Redone"}: “${text}”.` });
  },
};

// Documents whose name is criteria: a month of appointments, `month:2026-09`. Nothing declares
// who sees one: a session's page shows the months `showing` gives it, and reading them is what
// makes them seen. July is closed, so it can be seen and not written. The month a connection is on
// (a bare `month`) is September.
const monthPermits: string[] = [];
const showing = new Map<string, string[]>();

type Appointment = { id: string; what: string };

/** A month's appointments, in the order made (their ids are time-ordered). */
function readMonth(id: string): Appointment[] {
  return Object.values(read<{ appointments: Record<string, Appointment> }>(`month:${id}`).appointments).sort((a, b) => (a.id < b.id ? -1 : 1));
}

/** The same, from delta directly: for the tests' own questions. */
async function appointments(month: string): Promise<Appointment[]> {
  const doc = (await delta.call("open", { doc: `month:${month}` })).result as { appointments: Record<string, Appointment> };
  return Object.values(doc.appointments).sort((a, b) => (a.id < b.id ? -1 : 1));
}

const monthCompartment: Compartment = {
  docType: "month",
  resolveDoc: () => "2026-09",
  permit(_ws, op, docId) {
    monthPermits.push(docId);
    return op.op === "add" && op.path === "/appointments/-" && docId !== "2026-07";
  },
  shape: (_ws, _id, ops) => ops.map((op) => ({ op: "add", path: `/appointments/${Bun.randomUUIDv7()}`, value: { what: String(op.value) } })),
};

function makeExample(name: string): Example {
  return {
    name,
    compartments: [noteCompartment, monthCompartment, tickCompartment],
    render: (sessionId) => {
      if (readNote(sessionId) === "undrawable") throw new Error("undrawable"); // a page whose drawing fails
      return `<p class="note">${readNote(sessionId)}</p>` + toldAt(sessionId, "note", "/text") +
        (showing.get(sessionId) ?? []).map((m) => part(`month-${m}`, `<ul data-month="${m}">${readMonth(m).map((a) => part(`a-${a.id}`, `<li>${a.what}</li>`)).join("")}</ul>`)).join("");
    },
    active: () => true,
    index,
    delta,
  };
}

type WireMessage = { type: string; html?: string; doc?: string; version?: number; ops?: unknown[]; id?: WriteId; reason?: string; wire?: number };

/** A render's HTML, whether it came as the whole page or as the parts that changed (src/parts.ts). */
const htmlOf = (m: WireMessage): string =>
  m.html ?? (m.ops as { html?: string }[] | undefined ?? []).map((o) => o.html ?? "").join("");

const queues = new WeakMap<WebSocket, WireMessage[]>();
const waiters = new WeakMap<WebSocket, ((message: WireMessage) => void)[]>();

function connect(server: ReturnType<typeof createServer>, sessionId?: string): WebSocket {
  const url = new URL("/ws", server.url);
  url.protocol = "ws:";
  // @ts-expect-error Bun's runtime-only `headers` option on WebSocket
  const ws: WebSocket = sessionId ? new WebSocket(url, { headers: { Cookie: `session_id=${sessionId}` } }) : new WebSocket(url);

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

async function expectMessage(ws: WebSocket, type: string): Promise<WireMessage> {
  const message = await nextMessage(ws);
  expect(message.type).toBe(type);
  return message;
}

/** A write, as a page sends it: with an id of its own, or -- a page from before ids, the CLI -- without. */
function write(ws: WebSocket, doc: string, ops: PatchOp[], id?: WriteId) {
  ws.send(JSON.stringify({ id, doc, ops }));
}

/** Everything a socket is sent, up to the answer to an inspect sent now: events are handled in order, so all a write before it caused comes first. */
async function until(ws: WebSocket): Promise<WireMessage[]> {
  ws.send(JSON.stringify({ type: "inspect" }));
  const messages: WireMessage[] = [];
  for (let m = await nextMessage(ws); m.type !== "inspect"; m = await nextMessage(ws)) messages.push(m);
  return messages;
}

describe("createServer, generically (no example from the examples directory involved)", () => {
  let server: ReturnType<typeof createServer>;
  const example = makeExample("kernel-note-test");

  beforeAll(() => {
    server = createServer(example, 0);
  });

  afterAll(() => {
    server.stop(true);
  });

  test("/ serves the example's page, /api/health answers, and any other path serves the same page (item 3: a page in the URL is the client's to read, not a route the server resolves)", async () => {
    const page = await fetch(new URL("/", server.url));
    expect(page.status).toBe(200);
    expect(page.headers.get("content-type")).toContain("text/html");

    const health = await fetch(new URL("/api/health", server.url));
    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({ ok: true });

    const other = await fetch(new URL("/nope", server.url));
    expect(other.status).toBe(200);
    expect(other.headers.get("content-type")).toContain("text/html");
  });

  test("a socket opened from another site is refused, unless ETA_ORIGINS lists it", async () => {
    const from = (origin: string) => fetch(new URL("/ws", server.url), { headers: { Origin: origin } });
    expect((await from("https://elsewhere.example")).status).toBe(403);
    process.env.ETA_ORIGINS = "https://allowed.example, https://also.example";
    try {
      expect((await from("https://allowed.example")).status).toBe(400); // let through: then not an upgrade at all
      expect((await from("https://elsewhere.example")).status).toBe(403);
    } finally {
      delete process.env.ETA_ORIGINS;
    }
  });

  test("a non-upgrade request to /ws is rejected", async () => {
    const res = await fetch(new URL("/ws", server.url));
    expect(res.status).toBe(400);
  });

  test("a page crosses the wire compressed to a socket that offers it, as every browser does, each message on its own; as it is to one that does not", async () => {
    /** A socket opened by hand, offering permessage-deflate or not: the extension the answer names, and the first frame, a page. */
    async function opening(offer: boolean): Promise<{ extension: string | undefined; compressed: boolean; message: unknown }> {
      const socket = tcp(Number(server.port), "127.0.0.1");
      socket.write(
        "GET /ws HTTP/1.1\r\nHost: 127.0.0.1\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n" +
          (offer ? "Sec-WebSocket-Extensions: permessage-deflate; client_max_window_bits\r\n" : "") + "\r\n",
      );
      let got = Buffer.alloc(0);
      let end = -1;
      for await (const chunk of socket) {
        got = Buffer.concat([got, chunk as Buffer]);
        end = got.indexOf("\r\n\r\n");
        if (end >= 0 && got.length >= end + 6 && got.length >= end + 6 + (got[end + 5]! & 0x7f)) break;
      }
      socket.destroy();
      const [answer, frame] = [got.subarray(0, end).toString("latin1"), got.subarray(end + 4)];
      expect(frame[1]! & 0x7f).toBeLessThan(126); // a short page, its length in the one byte
      const payload = frame.subarray(2, 2 + (frame[1]! & 0x7f));
      const compressed = (frame[0]! & 0x40) !== 0; // RSV1: this message is compressed
      const text = compressed ? inflateRawSync(Buffer.concat([payload, Buffer.from([0, 0, 0xff, 0xff])])) : payload;
      return { extension: /^sec-websocket-extensions: (.*)$/im.exec(answer)?.[1], compressed, message: JSON.parse(text.toString("utf8")) };
    }
    const page = { type: "render", html: '<p class="note"></p>', wire: WIRE };
    expect(await opening(true)).toEqual({ extension: "permessage-deflate; client_no_context_takeover; server_no_context_takeover", compressed: true, message: page });
    expect(await opening(false)).toEqual({ extension: undefined, compressed: false, message: page });
  });

  test("a message is at most 1 MiB, inflated: a compressed frame that inflates past it is refused and its socket closed, as Bun does; one under it is written", async () => {
    /** A socket opened by hand for `sessionId`, offering permessage-deflate, that sends one write compressed: whether the server closed it, or answered. */
    async function writing(sessionId: string, text: string): Promise<"closed" | "answered"> {
      const socket = tcp(Number(server.port), "127.0.0.1");
      socket.write(
        "GET /ws HTTP/1.1\r\nHost: 127.0.0.1\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n" +
          `Sec-WebSocket-Extensions: permessage-deflate\r\nCookie: session_id=${sessionId}\r\n\r\n`,
      );
      const closed = new Promise<"closed">((done) => socket.on("close", () => done("closed")));
      let heard = (): void => {};
      socket.on("data", () => heard());
      await new Promise<void>((paged) => (heard = paged)); // the answer, and the page
      await Bun.sleep(20);
      const answered = new Promise<"answered">((done) => (heard = () => done("answered")));
      // a client's frame is masked; compressed, it ends without deflate's last four bytes (RFC 7692)
      const body = deflateRawSync(JSON.stringify({ doc: "note", ops: [{ op: "replace", path: "/text", value: text }] }), { finishFlush: constants.Z_SYNC_FLUSH }).subarray(0, -4);
      const mask = Buffer.from([1, 2, 3, 4]);
      expect(body.length).toBeLessThan(65536);
      socket.write(Buffer.concat([Buffer.from([0xc1, 0x80 | 126, body.length >> 8, body.length & 255]), mask, body.map((b, i) => b ^ mask[i % 4]!)]));
      const outcome = await Promise.race([closed, answered]);
      socket.destroy();
      return outcome;
    }
    const [under, over] = [crypto.randomUUID(), crypto.randomUUID()];
    expect(await writing(under, "x".repeat(1 << 19))).toBe("answered"); // 512 KiB, in a frame of about 500 B
    expect(await writing(over, "x".repeat(1 << 20))).toBe("closed"); // past 1 MiB with the write around it, in a frame of about 1 KB

    // what was written, as each session's next page says it
    for (const [sessionId, length] of [[under, 1 << 19], [over, 0]] as const) {
      const ws = connect(server, sessionId);
      await opened(ws);
      expect((await expectMessage(ws, "render")).html).toBe(`<p class="note">${"x".repeat(length)}</p>`);
      ws.close();
    }
  });

  test("a write over the websocket is permitted, applied, echoed, and rendered -- then undo walks it back", async () => {
    const ws = connect(server);
    await opened(ws);
    await expectMessage(ws, "render"); // initial empty note

    write(ws, "note", [{ op: "replace", path: "/text", value: "hello kernel" }]);
    const patch = await expectMessage(ws, "patch");
    expect(patch.doc).toBe("note");
    expect(patch.ops).toEqual([{ op: "replace", path: "", value: { text: "hello kernel" } }]); // the note as it is now, told whole, its id (the session) left out
    // the note's page has no parts: a change to it sends it whole
    const rendered = await expectMessage(ws, "render");
    expect(rendered.ops).toBeUndefined();
    expect(rendered.html).toBe('<p class="note">hello kernel</p>');
    expect(rendered.wire).toBe(WIRE); // a page sent whole says which wire its server speaks

    write(ws, "ledger", [{ op: "remove", path: "/latest" }]);
    const undonePatch = await expectMessage(ws, "patch");
    expect(undonePatch.doc).toBe("note");
    expect(undonePatch.ops).toEqual([{ op: "replace", path: "", value: { text: "" } }]);
    const undoneRender = await expectMessage(ws, "render");
    expect(htmlOf(undoneRender)).not.toContain("hello kernel");

    // redo: the undo walked forward again
    write(ws, "ledger", [{ op: "add", path: "/latest" }]);
    const redonePatch = await expectMessage(ws, "patch");
    expect(redonePatch.ops).toEqual([{ op: "replace", path: "", value: { text: "hello kernel" } }]);
    expect(htmlOf(await expectMessage(ws, "render"))).toContain("hello kernel");
    // nothing left to redo: a render, no patch
    write(ws, "ledger", [{ op: "add", path: "/latest" }]);
    await expectMessage(ws, "render");

    ws.close();
  });

  test("a write whose handling fails is logged and handed back, and the events after it are still handled", async () => {
    const ws = connect(server);
    await opened(ws);
    await expectMessage(ws, "render");
    const logged: unknown[] = [];
    const error = console.error;
    console.error = (...args: unknown[]) => void logged.push(args);
    try {
      write(ws, "note", [{ op: "replace", path: "/text", value: "boom" }]);
      write(ws, "note", [{ op: "replace", path: "/text", value: "after the boom" }]);
      expect(htmlOf(await expectMessage(ws, "render"))).not.toContain("boom"); // the page, handed back as it was
      expect((await expectMessage(ws, "patch")).ops).toEqual([{ op: "replace", path: "", value: { text: "after the boom" } }]);
      expect(logged).toHaveLength(1);
      expect(String((logged[0] as unknown[])[1])).toContain("boom");
    } finally {
      console.error = error;
    }
    ws.close();
  });

  test("a drawing that fails is logged, and the connection's next drawing goes ahead", async () => {
    const ws = connect(server);
    await opened(ws);
    await expectMessage(ws, "render");
    const logged: unknown[] = [];
    const error = console.error;
    console.error = (...args: unknown[]) => void logged.push(args);
    try {
      write(ws, "note", [{ op: "replace", path: "/text", value: "undrawable" }]);
      await expectMessage(ws, "patch"); // the write is told; its drawing fails
      write(ws, "note", [{ op: "replace", path: "/text", value: "drawn again" }]);
      await expectMessage(ws, "patch");
      expect(htmlOf(await nextMessage(ws))).toContain("drawn again");
      expect(logged).toHaveLength(1);
      expect(String((logged[0] as unknown[])[1])).toContain("undrawable");
    } finally {
      console.error = error;
    }
    ws.close();
  });

  test("inspect reports the note doc's version and last ops, generically", async () => {
    const ws = connect(server);
    await opened(ws);
    await expectMessage(ws, "render");

    write(ws, "note", [{ op: "replace", path: "/text", value: "inspect me" }]);
    await expectMessage(ws, "patch");
    await expectMessage(ws, "render");

    ws.send(JSON.stringify({ type: "inspect" }));
    const inspection = await expectMessage(ws, "inspect");

    const docs = (inspection as unknown as { docs: { doc: string; version: number; entries?: unknown[] }[] }).docs;
    const note = docs.find((d) => d.doc === "note");
    expect(note?.version).toBeGreaterThan(0);
    expect(note?.entries?.[0]).toMatchObject({ ops: [{ op: "replace", path: "", value: { text: "inspect me" } }] });
    expect((note?.entries?.[0] as { id: number }).id).toBeGreaterThan(0); // the ledger entry's own id
    // a session id is the only credential: it never goes on the wire, not even your own. "Was this
    // write mine" is all a reader may ask.
    expect(note?.entries?.[0]).toMatchObject({ mine: true });
    expect(JSON.stringify(inspection)).not.toContain("sessionId");

    ws.close();
  });

  test("an open that fails is reported, and the page is drawn all the same", async () => {
    const failures: string[] = [];
    const stop = onFailure((what, err) => void failures.push(`${what}: ${(err as Error).message}`));
    try {
      const ws = connect(server, "opens-badly");
      await opened(ws);
      expect(htmlOf(await expectMessage(ws, "render"))).toContain('<p class="note">');
      expect(failures).toEqual(["handling an event: an open that fails"]);
      ws.close();
    } finally {
      stop();
    }
  });

  test("a message that is not a write is refused as one: the page handed back, nothing failing, nothing written", async () => {
    const ws = connect(server);
    await opened(ws);
    await expectMessage(ws, "render");
    const failures: string[] = [];
    const stop = onFailure((what) => void failures.push(what));
    try {
      for (const raw of [
        "not json",
        "7",
        "null",
        JSON.stringify({ doc: 7, ops: [{ op: "replace", path: "/text", value: "x" }] }),
        JSON.stringify({ doc: "note", ops: "boom" }),
        JSON.stringify({ doc: "note", ops: [] }),
        JSON.stringify({ doc: "note", ops: [null] }),
        JSON.stringify({ doc: "note", ops: [{ op: "move", path: "/text" }] }),
        JSON.stringify({ doc: "note", ops: [{ op: "replace", path: "text", value: "x" }] }),
        JSON.stringify({ doc: "note", ops: [{ op: "replace", path: 7, value: "x" }] }),
      ]) {
        ws.send(raw);
        expect(htmlOf(await expectMessage(ws, "render"))).toContain('<p class="note">');
      }
    } finally {
      stop();
    }
    expect(failures).toEqual([]);
    ws.close();
  });

  test("inspect gives at most a hundred entries a document, however many it asks for", async () => {
    const ws = connect(server);
    await opened(ws);
    await expectMessage(ws, "render");
    for (let i = 0; i <= 100; i++) {
      write(ws, "note", [{ op: "replace", path: "/text", value: `note ${i}` }]);
      await expectMessage(ws, "patch");
      await expectMessage(ws, "render");
    }
    const entries = async (limit: unknown): Promise<number> => {
      ws.send(JSON.stringify({ type: "inspect", limit }));
      const answer = (await expectMessage(ws, "inspect")) as unknown as Inspection;
      return answer.docs.find((d) => d.doc === "note")!.entries.length;
    };
    expect(await entries(1e9)).toBe(100);
    expect(await entries(-5)).toBe(1);
    expect(await entries("lots")).toBe(1); // not a count: the default, the latest
    expect(await entries(3)).toBe(3);
    ws.close();
  });

  test("a refusal that says why is shown to its writer alone, off the ledger, until their next write; nobody writes one from the wire", async () => {
    const ws = connect(server);
    const other = connect(server);
    await Promise.all([opened(ws), opened(other)]);
    await expectMessage(ws, "render");
    await expectMessage(other, "render");
    // everything a write is answered with: events are handled in order, so all that comes before
    // the answer to an inspect sent after it, and the inspect's own answer
    const answer = async (doc: string, ops: PatchOp[]): Promise<{ messages: WireMessage[]; inspection: Inspection }> => {
      write(ws, doc, ops);
      ws.send(JSON.stringify({ type: "inspect" }));
      const messages: WireMessage[] = [];
      for (let m = await nextMessage(ws); ; m = await nextMessage(ws)) {
        if (m.type === "inspect") return { messages, inspection: m as unknown as Inspection };
        messages.push(m);
      }
    };
    const page = (messages: WireMessage[]): string => htmlOf(messages.filter((m) => m.type === "render").at(-1)!);
    const patched = (messages: WireMessage[]): (string | undefined)[] => messages.filter((m) => m.type === "patch").map((m) => m.doc);
    const reason = '<p class="refused" role="alert">A note needs words.</p>';

    const told = await answer("note", [{ op: "replace", path: "/text", value: "" }]);
    expect(page(told.messages)).toContain(reason);
    expect(patched(told.messages)).toEqual(["told"]); // its own, named by type alone
    expect(told.inspection.docs.find((d) => d.doc === "note")!.entries).toEqual([]); // nothing happened
    await server.idle();
    expect(queues.get(other)!).toEqual([]); // the other session is told nothing

    // nobody writes a refusal from the wire; and that write, refused without a word, is the
    // session's next, so what it was told goes
    const next = await answer("told", [{ op: "replace", path: "/reason", value: "I say so." }]);
    expect(page(next.messages)).not.toContain("refused");
    expect(patched(next.messages)).toEqual(["told"]);
    ws.close();
    other.close();
  });

  test("a session may be told what went well -- a route that answered a form tells it -- drawn beside the control as a status, where a refusal is an alert; its next write takes it away", async () => {
    const ws = connect(server, "told-by-a-route");
    await opened(ws);
    await expectMessage(ws, "render");
    await tell("told-by-a-route", { doc: "note", path: "/text", said: "Your note is kept." });
    await server.idle();
    expect(htmlOf((await until(ws)).at(-1)!)).toContain('<p class="note"></p><p class="said" role="status">Your note is kept.</p>');

    write(ws, "note", [{ op: "replace", path: "/text", value: "kept" }], 1);
    expect(htmlOf((await until(ws)).filter((m) => m.type === "render").at(-1)!)).toBe('<p class="note">kept</p>');
    ws.close();
  });

  test("a refused write is answered `refused` with its own id, and why when it says, before the page is handed back", async () => {
    const ws = connect(server);
    await opened(ws);
    await expectMessage(ws, "render");
    const answered = async (sent: () => void): Promise<WireMessage[]> => (sent(), until(ws));

    const told = await answered(() => write(ws, "note", [{ op: "replace", path: "/text", value: "" }], 3));
    expect(told[0]).toEqual({ type: "refused", id: 3, reason: "A note needs words." });
    expect(told.at(-1)).toMatchObject({ type: "render", wire: WIRE }); // then the page, handed back whole
    expect(htmlOf(told.at(-1)!)).toContain('<p class="refused" role="alert">A note needs words.</p>');

    const silent = await answered(() => write(ws, "note", [{ op: "remove", path: "/text" }], "four")); // permit says no, without a word
    expect(silent[0]).toEqual({ type: "refused", id: "four" });

    const notAWrite = await answered(() => ws.send(JSON.stringify({ id: 5, doc: "note", ops: [] })));
    expect(notAWrite[0]).toEqual({ type: "refused", id: 5 }); // whatever else is wrong with it, its id is answered

    // an id that is not one: not a write, and nothing to answer it by but the page
    const badId = await answered(() => ws.send(JSON.stringify({ id: { not: "an id" }, doc: "note", ops: [{ op: "replace", path: "/text", value: "sneaked" }] })));
    expect(badId.map((m) => m.type)).not.toContain("refused");
    expect(badId.at(-1)).toMatchObject({ type: "render" });
    expect(htmlOf(badId.at(-1)!)).not.toContain("sneaked");

    // a write without an id -- a page from before ids, the CLI -- is refused as it always was: the page alone
    const bare = await answered(() => write(ws, "note", [{ op: "replace", path: "/text", value: "" }]));
    expect(bare.map((m) => m.type)).not.toContain("refused");
    expect(htmlOf(bare.at(-1)!)).toContain("A note needs words.");
    ws.close();
  });

  test("an undo or redo with an id is answered as a write is: the change it walked echoed with the id, and nothing to walk refused with it", async () => {
    const ws = connect(server);
    await opened(ws);
    await expectMessage(ws, "render");
    write(ws, "note", [{ op: "replace", path: "/text", value: "walked" }], 1);
    expect(await expectMessage(ws, "patch")).toMatchObject({ doc: "note", id: 1 });
    await expectMessage(ws, "render");
    write(ws, "ledger", [{ op: "remove", path: "/latest" }], 2);
    expect(await expectMessage(ws, "patch")).toMatchObject({ doc: "note", id: 2, ops: [{ value: { text: "" } }] });
    await expectMessage(ws, "render");
    write(ws, "ledger", [{ op: "add", path: "/latest" }], 3);
    expect(await expectMessage(ws, "patch")).toMatchObject({ doc: "note", id: 3, ops: [{ value: { text: "walked" } }] });
    await expectMessage(ws, "render");
    write(ws, "ledger", [{ op: "add", path: "/latest" }], 4); // nothing left to redo
    expect(await nextMessage(ws)).toEqual({ type: "refused", id: 4 });
    ws.close();
  });

  test("what a write did is told to its writer beside the control that sent it, and what its undo or redo did over the page, where Undo is; each until the next write", async () => {
    const ws = connect(server);
    await opened(ws);
    await expectMessage(ws, "render");
    const pageAfter = async (doc: string, ops: PatchOp[], id: WriteId): Promise<string> => (write(ws, doc, ops, id), htmlOf((await until(ws)).filter((m) => m.type === "render").at(-1)!));
    walks.length = 0;
    expect(await pageAfter("note", [{ op: "replace", path: "/text", value: "said" }], 1)).toBe('<p class="note">said</p><p class="said" role="status">Noted.</p>');
    expect(await pageAfter("ledger", [{ op: "remove", path: "/latest" }], 2)).toBe('<p class="note"></p><div class="undo-said"><p class="said" role="status">Undone: “said”.</p></div>');
    expect(await pageAfter("ledger", [{ op: "add", path: "/latest" }], 3)).toBe('<p class="note">said</p><div class="undo-said"><p class="said" role="status">Redone: “said”.</p></div>');
    // each walk is told which way it went, what it wrote and what that wrote over
    expect(walks).toEqual([
      { way: "undo", ops: [{ op: "replace", path: "", value: { text: "" } }], inverse: [{ op: "replace", path: "", value: { text: "said" } }] },
      { way: "redo", ops: [{ op: "replace", path: "", value: { text: "said" } }], inverse: [{ op: "replace", path: "", value: { text: "" } }] },
    ]);
    expect(await pageAfter("note", [{ op: "replace", path: "/text", value: "quiet" }], 4)).toBe('<p class="note">quiet</p>'); // says nothing: what was said goes
    ws.close();
  });

  test("an undo or redo that says nothing takes away what its walker was told before, as a write does", async () => {
    const ws = connect(server, "told-then-walks");
    await opened(ws);
    await expectMessage(ws, "render");
    write(ws, "note", [{ op: "replace", path: "/text", value: "unsaid" }], 1);
    await until(ws);
    await tell("told-then-walks", { doc: "note", path: "/text", said: "Kept." }); // as a route might, after
    await server.idle();
    write(ws, "ledger", [{ op: "remove", path: "/latest" }], 2);
    expect(htmlOf((await until(ws)).filter((m) => m.type === "render").at(-1)!)).toBe('<p class="note"></p>');
    ws.close();
  });

  test("a change told from outside any event -- a feed's tick, slow to follow -- does not cost a write made meanwhile its id", async () => {
    const ws = connect(server);
    await opened(ws);
    await expectMessage(ws, "render");
    const tick = serverWrite("tick:1", [{ op: "replace", path: "/n", value: 1 }]);
    await Bun.sleep(10); // told, and still being followed (afterChange)
    write(ws, "note", [{ op: "replace", path: "/text", value: "during the tick" }], 42);
    await tick;
    expect((await until(ws)).filter((m) => m.type === "patch").map((m) => m.id)).toEqual([42]);
    ws.close();
  });

  test("what follows a write or a walk failing is the server's failure, not a refusal: it landed, and its writer is told so once", async () => {
    const ws = connect(server);
    await opened(ws);
    await expectMessage(ws, "render");
    const failures: string[] = [];
    const stop = onFailure((what, err) => void failures.push(`${what}: ${(err as Error).message}`));
    const error = console.error;
    console.error = () => {};
    try {
      write(ws, "note", [{ op: "replace", path: "/text", value: "then boom" }], 9);
      const answers = (await until(ws)).filter((m) => m.id === 9);
      expect(answers.map((m) => m.type)).toEqual(["patch"]);
      expect(failures).toEqual(["following a write to note: then boom"]); // a session's own, named by its type
      write(ws, "note", [{ op: "replace", path: "/text", value: "walks badly" }], 10);
      await until(ws);
      write(ws, "ledger", [{ op: "remove", path: "/latest" }], 11);
      expect((await until(ws)).filter((m) => m.id === 11).map((m) => m.type)).toEqual(["patch"]);
      expect(failures).toEqual(["following a write to note: then boom", "following a walk of note: walks badly"]);
    } finally {
      console.error = error;
      stop();
    }
    ws.close();
  });

  test("an id is at most 64 characters, and a number JSON can say: a longer one is not a write, a number it cannot is no id", async () => {
    const ws = connect(server);
    await opened(ws);
    await expectMessage(ws, "render");
    const longest = "x".repeat(64);
    write(ws, "note", [{ op: "replace", path: "/text", value: "a long id" }], longest);
    expect((await until(ws)).find((m) => m.type === "patch")?.id).toBe(longest);

    write(ws, "note", [{ op: "replace", path: "/text", value: "too long an id" }], "x".repeat(65));
    const tooLong = await until(ws);
    expect(tooLong.map((m) => m.type)).toEqual(["render"]); // not a write: the page handed back, and no id sent back to say so
    expect(htmlOf(tooLong[0]!)).not.toContain("too long an id");

    ws.send(`{"id":1e400,"doc":"note","ops":[{"op":"replace","path":"/text","value":"beyond a number"}]}`); // Infinity, which JSON says back as null
    const beyond = (await until(ws)).find((m) => m.type === "patch");
    expect(beyond).toMatchObject({ ops: [{ value: { text: "beyond a number" } }] });
    expect(beyond).not.toHaveProperty("id");
    ws.close();
  });

  test("an unpermitted op is rejected without crashing: no patch echo, just a re-render", async () => {
    const ws = connect(server);
    await opened(ws);
    await expectMessage(ws, "render");

    write(ws, "note", [{ op: "remove", path: "/text" }]); // permit() only allows replace
    await expectMessage(ws, "render"); // falls straight through, no patch

    ws.close();
  });
});

describe("createServer's one-example-per-process invariant", () => {
  test("calling it with a second, different example object while the first is still active throws", () => {
    const first = createServer(makeExample("first"), 0);
    try {
      expect(() => createServer(makeExample("second"), 0)).toThrow(/already called with a different example/);
    } finally {
      first.stop(true);
    }
  });

  test("two compartments owning one document type throw, the kernel's ledger among them", () => {
    const twice = { ...makeExample("twice"), compartments: [noteCompartment, noteCompartment] };
    expect(() => assemble(twice)).toThrow('twice: two compartments own "note"');
    const ledgered = { ...makeExample("ledgered"), compartments: [{ ...noteCompartment, docType: "ledger" }] };
    expect(() => assemble(ledgered)).toThrow(`ledgered: two compartments own "ledger" (the kernel's own)`);
  });

  test("calling it again with the very same example object does not throw", () => {
    const example = makeExample("reused");
    const a = createServer(example, 0);
    const b = createServer(example, 0);
    a.stop(true);
    b.stop(true);
  });
});

describe("one socket, any documents: a document is named whole, and seen because the page read it", () => {
  let server: ReturnType<typeof createServer>;

  beforeAll(() => {
    server = createServer(makeExample("kernel-month-test"), 0);
  });

  afterAll(() => {
    server.stop(true);
  });

  /** The next patch this socket is sent, passing over renders. */
  async function nextPatch(ws: WebSocket): Promise<WireMessage> {
    let message = await nextMessage(ws);
    while (message.type !== "patch") message = await nextMessage(ws);
    return message;
  }

  /** A connection whose page shows `shows`, opened and drawn. */
  async function showingMonths(...shows: string[]): Promise<{ ws: WebSocket; sessionId: string }> {
    const sessionId = crypto.randomUUID();
    showing.set(sessionId, shows);
    const ws = connect(server, sessionId);
    await opened(ws);
    await expectMessage(ws, "render");
    return { ws, sessionId };
  }

  test("this month and last month, side by side on one page, each told by its whole name", async () => {
    const { ws: a } = await showingMonths("2026-08", "2026-09");
    const { ws: b } = await showingMonths("2026-08", "2026-09");

    write(a, "month:2026-09", [{ op: "add", path: "/appointments/-", value: "dentist" }]);
    expect(await nextPatch(a)).toMatchObject({ doc: "month:2026-09", ops: [{ value: { what: "dentist" } }] });
    expect(await nextPatch(b)).toMatchObject({ doc: "month:2026-09", ops: [{ value: { what: "dentist" } }] });

    write(a, "month:2026-08", [{ op: "add", path: "/appointments/-", value: "optician" }]);
    expect(await nextPatch(a)).toMatchObject({ doc: "month:2026-08", ops: [{ value: { what: "optician" } }] });
    expect(await nextPatch(b)).toMatchObject({ doc: "month:2026-08", ops: [{ value: { what: "optician" } }] });

    a.close();
    b.close();
  });

  test("a new appointment goes out as the one row, beside the row before it, to every page showing the month", async () => {
    const { ws: a } = await showingMonths("2026-08");
    const { ws: b } = await showingMonths("2026-08", "2026-09");
    if ((await appointments("2026-08")).length === 0) {
      write(a, "month:2026-08", [{ op: "add", path: "/appointments/-", value: "first" }]); // a list that was empty is replaced whole
      await nextPatch(a);
      await expectMessage(a, "render");
      await nextPatch(b);
      await expectMessage(b, "render");
    }
    const before = (await appointments("2026-08")).at(-1)!;

    write(a, "month:2026-08", [{ op: "add", path: "/appointments/-", value: "physio" }]);
    await nextPatch(a);
    const sentToA = await expectMessage(a, "render");
    expect(sentToA.html).toBeUndefined();
    expect(sentToA.wire).toBeUndefined(); // only a page sent whole says the wire
    const physio = (await appointments("2026-08")).at(-1)!;
    expect(sentToA.ops).toEqual([{ op: "after", target: `[data-eta-part="a-${before.id}"]`, html: `<li data-eta-part="a-${physio.id}">physio</li>` }]);
    await nextPatch(b);
    expect((await expectMessage(b, "render")).ops).toEqual(sentToA.ops);

    a.close();
    b.close();
  });

  test("stop showing a month and you stop being told about it, or writing it", async () => {
    const { ws: a, sessionId } = await showingMonths("2026-08", "2026-09");
    const { ws: b } = await showingMonths("2026-08");

    showing.set(sessionId, ["2026-09"]);
    write(a, "nothing:here", [{ op: "add", path: "/x", value: 1 }]); // refused: the page is drawn again, without August
    await expectMessage(a, "render");

    write(b, "month:2026-08", [{ op: "add", path: "/appointments/-", value: "vet" }]);
    await nextPatch(b);
    write(a, "month:2026-08", [{ op: "add", path: "/appointments/-", value: "not mine now" }]);
    expect((await nextMessage(a)).type).toBe("render"); // no patch about August came first, and the write was refused
    expect((await appointments("2026-08")).map((a) => a.what)).not.toContain("not mine now");

    a.close();
    b.close();
  });

  test("a write's id comes back to its writer alone, on the echo of the change it made: another's echo of the same document is not theirs", async () => {
    const { ws: a } = await showingMonths("2026-08");
    const { ws: b } = await showingMonths("2026-08");

    write(a, "month:2026-08", [{ op: "add", path: "/appointments/-", value: "a's" }], 7);
    expect(await nextPatch(a)).toMatchObject({ doc: "month:2026-08", id: 7, ops: [{ value: { what: "a's" } }] });
    expect(await nextPatch(b)).not.toHaveProperty("id"); // b sees the change, and it is not b's

    write(b, "month:2026-08", [{ op: "add", path: "/appointments/-", value: "b's" }], "b-1");
    expect(await nextPatch(a)).not.toHaveProperty("id");
    expect(await nextPatch(b)).toMatchObject({ id: "b-1", ops: [{ value: { what: "b's" } }] });

    // a's refusal between them is a's: b is told nothing of it
    write(a, "month:2026-07", [{ op: "add", path: "/appointments/-", value: "too late" }], 8);
    write(b, "month:2026-08", [{ op: "add", path: "/appointments/-", value: "b's again" }], "b-2");
    const toA = await until(a);
    expect(toA.filter((m) => m.type === "refused")).toEqual([{ type: "refused", id: 8 }]);
    expect(toA.filter((m) => m.type === "patch").map((m) => m.id)).toEqual([undefined]); // b's write, echoed to a: not a's
    expect((await until(b)).filter((m) => m.type === "refused" || m.id !== undefined)).toMatchObject([{ type: "patch", id: "b-2" }]);

    // a write without an id -- a page from before ids, the CLI -- is echoed as it always was
    write(a, "month:2026-08", [{ op: "add", path: "/appointments/-", value: "no id" }]);
    expect(await nextPatch(a)).not.toHaveProperty("id");

    a.close();
    b.close();
  });

  test("a bare type is the document of that type the connection is on, seen without being shown", async () => {
    const { ws } = await showingMonths();
    write(ws, "month", [{ op: "add", path: "/appointments/-", value: "haircut" }]);
    expect(await nextPatch(ws)).toMatchObject({ doc: "month:2026-09", ops: [{ value: { what: "haircut" } }] });
    ws.close();
  });

  test("permit judges by the name: last month's closed one is seen and not written", async () => {
    const { ws } = await showingMonths("2026-07");
    const before = (await appointments("2026-07")).length;
    write(ws, "month:2026-07", [{ op: "add", path: "/appointments/-", value: "too late" }]);
    await expectMessage(ws, "render"); // refused: the page again, and nothing else
    expect((await appointments("2026-07")).length).toBe(before);
    expect(monthPermits.at(-1)).toBe("2026-07");
    ws.close();
  });

  test("a document the page does not show is refused before its owner is asked", async () => {
    const { ws } = await showingMonths("2026-08");
    const asked = monthPermits.length;
    write(ws, "month:1999-01", [{ op: "add", path: "/appointments/-", value: "sneaky" }]);
    await expectMessage(ws, "render");
    expect(await appointments("1999-01")).toEqual([]);
    expect(monthPermits.length).toBe(asked);
    ws.close();
  });

  test("a name nothing owns is refused", async () => {
    const { ws } = await showingMonths();
    write(ws, "nothing:here", [{ op: "add", path: "/x", value: 1 }]);
    expect((await nextMessage(ws)).type).toBe("render");
    ws.close();
  });

  test("a session's own document goes by its type; one keyed by a live session and not perSession is refused by name", () => {
    const me = { data: { sessionId: "s-me" } } as unknown as Bun.ServerWebSocket<{ sessionId: string }>;
    const other = { data: { sessionId: "s-other" } } as unknown as Bun.ServerWebSocket<{ sessionId: string }>;
    openConnection(other);
    try {
      expect(wireName("note", "s-other", me)).toBe("note"); // note is `perSession`
      expect(wireName("month", "2026-09", me)).toBe("month:2026-09");
      expect(() => wireName("month", "s-other", me)).toThrow("perSession");
    } finally {
      closeConnection(other);
    }
  });
});
