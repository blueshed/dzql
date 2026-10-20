import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { connect as tcp } from "node:net";
import { constants, deflateRawSync, inflateRawSync } from "node:zlib";
import { createTables, defineDoc, defineSchema, registerDocs } from "@blueshed/delta/sqlite";
import { createLocal } from "@blueshed/delta/local";
import { registerMemory } from "@blueshed/delta/kinds";
import type { Resource, Walk } from "../../src/rendering/resources/resource";
import type { Example } from "../../src/rendering/example";
import type { ConnectionData } from "../../src/rendering/connection";
import index from "./server.test.fixture.html";
import { WIRE, type PatchOp, type WriteId } from "../../src/rendering/json-patch";
import { closeConnection, openConnection, setCookieIsSession, wireName, wireOps } from "../../src/rendering/resources/audience";
import { read, serverWrite } from "../../src/rendering/documents";
import { part } from "../../src/rendering/parts";
import { appOf, CHANGED_SINCE, compose, createServer } from "../../src/rendering/server";
import { serve } from "@blueshed/delta/serve";
import { createWs } from "@blueshed/delta/server";
import { assemble, type Inspection } from "../../src/rendering/resources";
import { onFailure } from "../../src/rendering/failed";
import { refuse, tell, toldAt } from "../../src/rendering/refusal";
import { moveTab } from "../../src/rendering/tabs";
import { connect, expectMessage, expectQuiet, heard, htmlOf, nextMessage, open, opened, pageOf, rawOf, write, type WireMessage } from "../../src/rendering/test-socket";

// A tiny, self-contained example -- not chat, not anything under the examples directory -- so
// this file proves the kernel on its own: a note per session (its own document), and months of
// appointments (documents named by criteria), kept in a delta of this file's own. Where a tab
// stands is written as the note's `/at`, which the note never holds: the tab does.
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
const tickResource: Resource = { docType: "tick", kind: "memory", resolveDoc: () => undefined, afterChange: () => Bun.sleep(60) };

function readNote(id: string): string {
  return read<{ notes: { text: string } }>(`note:${id}`).notes.text;
}

// what each walk of a note was given
const walks: Walk[] = [];

const noteResource: Resource = {
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
    return (op.path === "/text" || op.path === "/at") && op.op === "replace";
  },
  shape(_ws, _id, ops) {
    if (ops.some((op) => op.value === "boom")) throw new Error("boom"); // a write whose handling fails
    if (ops.some((op) => op.value === "")) throw refuse("A note needs words."); // a write refused, and why
    return ops;
  },
  afterWrite(ws, _id, ops) {
    if (ops.some((op) => op.value === "then boom")) throw new Error("then boom"); // a write that lands, then fails what follows
    if (ops.some((op) => op.value === "said")) return tell(ws.data.sessionId, { doc: "note", path: "/text", said: "Noted." }); // what it did, beside the control that sent it
    if (ops.some((op) => op.value === "move me")) moveTab(ws, "moved"); // where it leaves the tab that wrote it
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
const followed: { sent: PatchOp[]; landed: PatchOp[] }[] = [];

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

const monthResource: Resource = {
  docType: "month",
  resolveDoc: () => "2026-09",
  permit(_ws, op, docId) {
    monthPermits.push(docId);
    return op.op === "add" && op.path === "/appointments/-" && docId !== "2026-07";
  },
  shape: (_ws, _id, ops) => ops.map((op) => ({ op: "add", path: `/appointments/${Bun.randomUUIDv7()}`, value: { what: String(op.value) } })),
  // what follows each write is given: as the page sent it, and as it landed
  afterWrite: (_ws, _id, sent, landed) => void followed.push({ sent, landed }),
};

function makeExample(name: string): Example {
  return {
    name,
    resources: [noteResource, monthResource, tickResource],
    render: (sessionId, address) => {
      if (readNote(sessionId) === "undrawable") throw new Error("undrawable"); // a page whose drawing fails
      // one typing in the note draws it in a field
      const field = sessionId.startsWith("typing") ? `<textarea data-write='{"doc":"note","op":"replace","path":"/text"}'>\n${readNote(sessionId)}</textarea>` : "";
      // where the tab stands, when it stands anywhere but the page alone
      return `<p class="note">${readNote(sessionId)}</p>` + (address && `<p class="at">${address}</p>`) + field + toldAt(sessionId, "note", "/text") +
        (showing.get(sessionId) ?? []).map((m) => part(`month-${m}`, `<ul data-month="${m}">${readMonth(m).map((a) => part(`a-${a.id}`, `<li>${a.what}</li>`)).join("")}</ul>`)).join("");
    },
    active: () => true,
    index,
    delta,
    // where a tab stands is written as the note's `/at`: the note says where it may, and the tab goes there
    address: { doc: "note", path: "/at" },
    // who a request is, by a header of this test's own: a session, a refusal, or a visit
    identify: (req) => {
      const who = req.headers.get("x-test-who");
      return who === "refused" ? new Response("not you", { status: 401 }) : (who ?? undefined);
    },
  };
}

/** The page `ws` was last handed, once everything before is done. */
const pageNow = async (ws: WebSocket): Promise<string> => htmlOf((await heard(ws)).filter((m) => m.type === "render").at(-1)!);

/** A change's handle, as its writer's echo gives it: opaque, the session's own. */
const HANDLE = /^[0-9a-f]{16}$/;

describe("createServer, generically (no example from the examples directory involved)", () => {
  let server: Awaited<ReturnType<typeof createServer>>;
  const example = makeExample("kernel-note-test");

  beforeAll(async () => {
    server = await createServer(example, 0);
  });

  afterAll(() => {
    server.stop(true);
  });

  test("/ serves the example's page, /api/health answers, and any other path serves the same page: a screen, whose socket names it", async () => {
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

  test("who a socket is, the example says before it opens: a session, its cookie set when it is not the one sent; or a refusal", async () => {
    /** The answer to a socket's opening, by hand: its status line and headers. */
    async function answer(headers: string): Promise<string> {
      const socket = tcp(Number(server.port), "127.0.0.1");
      socket.write(`GET /ws HTTP/1.1\r\nHost: 127.0.0.1\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n${headers}\r\n`);
      let got = "";
      for await (const chunk of socket) if ((got += (chunk as Buffer).toString("latin1")).includes("\r\n\r\n")) break;
      socket.destroy();
      return got.slice(0, got.indexOf("\r\n\r\n"));
    }
    const given = await answer("X-Test-Who: ada-session\r\nCookie: session_id=a-visit\r\n");
    expect(given).toStartWith("HTTP/1.1 101");
    expect(given).toMatch(/^set-cookie: session_id=ada-session;/im); // never the visit's
    expect(await answer("X-Test-Who: ada-session\r\nCookie: session_id=ada-session\r\n")).not.toMatch(/^set-cookie:/im);
    expect(await answer("X-Test-Who: refused\r\n")).toStartWith("HTTP/1.1 401");
    expect(await answer("Cookie: session_id=a-visit\r\n")).not.toMatch(/^set-cookie:/im); // nobody said: the visit's own
  });

  test("a tab opened at an address is routed there before its page is drawn, by the example's own write of it, which moves the tab and never the session; a refused route leaves it at the page alone", async () => {
    const at = async (sessionId: string, address?: string): Promise<string> => {
      const ws = connect(server, sessionId, address);
      await opened(ws);
      const page = htmlOf(await expectMessage(ws, "render"));
      ws.close();
      return page;
    };
    expect(await at("routed", "guests?guest=2")).toBe('<p class="note"></p><p class="at">guests?guest=2</p>'); // the first page drawn is the route's, and the note holds none of it
    expect(await at("routed")).toBe('<p class="note"></p>'); // a socket that names none (the CLI's) stands at the page alone: where another tab went is that tab's
    expect(await at("routed", "")).toBe('<p class="note"></p>'); // refused ("A note needs words."): at the page alone
    const failures: string[] = [];
    const stop = onFailure((what, err) => void failures.push(`${what}: ${(err as Error).message}`));
    try {
      expect(await at("routed", "boom")).toBe('<p class="note"></p>'); // a route whose write fails is the server's failure, and the page is drawn all the same
      expect(failures).toEqual(["handling an event: boom"]);
    } finally {
      stop();
    }
  });

  test("two tabs of one session stand on two screens: a tab moves alone, answered by an echo of nothing; a change reaches both, wherever they stand; what follows a write moves its writer's tab alone", async () => {
    const [up, down] = [connect(server, "two-tabs", "upstairs"), connect(server, "two-tabs", "downstairs")];
    await Promise.all([opened(up), opened(down)]);
    expect(htmlOf(await expectMessage(up, "render"))).toBe('<p class="note"></p><p class="at">upstairs</p>');
    expect(htmlOf(await expectMessage(down, "render"))).toBe('<p class="note"></p><p class="at">downstairs</p>');

    // going somewhere changes no document: its writer is answered by an echo of nothing, and the other tab is sent nothing
    write(up, "note", [{ op: "replace", path: "/at", value: "attic" }], "go");
    expect(await heard(up)).toMatchObject([{ type: "patch", doc: "note", ops: [], id: "go" }, { type: "render" }]);
    expect(pageOf(up)).toBe('<p class="note"></p><p class="at">attic</p>');
    expect(await heard(down)).toEqual([]);

    // a write that goes somewhere too: the note is written, and told to both tabs; the writer's tab alone goes
    write(down, "note", [{ op: "replace", path: "/text", value: "both" }, { op: "replace", path: "/at", value: "cellar" }], "both");
    expect((await heard(down)).filter((m) => m.type === "patch")).toMatchObject([{ doc: "note", ops: [{ op: "replace", path: "/text", value: "both" }], id: "both" }]);
    expect(pageOf(down)).toBe('<p class="note">both</p><p class="at">cellar</p>');
    expect((await heard(up)).filter((m) => m.type === "patch")).toMatchObject([{ doc: "note", ops: [{ op: "replace", path: "/text", value: "both" }] }]);
    expect(pageOf(up)).toBe('<p class="note">both</p><p class="at">attic</p>');

    // what follows a write (`moveTab`) moves the tab that wrote it, never the session's other
    write(up, "note", [{ op: "replace", path: "/text", value: "move me" }]);
    await heard(up);
    expect(pageOf(up)).toBe('<p class="note">move me</p><p class="at">moved</p>');
    await heard(down);
    expect(pageOf(down)).toBe('<p class="note">move me</p><p class="at">cellar</p>');
    up.close();
    down.close();
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
    expect(rawOf(patch)).toBe(JSON.stringify(patch)); // as it came, for counting its bytes
    expect(patch.doc).toBe("note");
    expect(patch.ops).toEqual([{ op: "replace", path: "/text", value: "hello kernel" }]); // what changed of the note, at eta's paths
    // the note's page has no parts: a change to it sends it whole
    const rendered = await expectMessage(ws, "render");
    expect(rendered.ops).toBeUndefined();
    expect(rendered.html).toBe('<p class="note">hello kernel</p>');
    expect(rendered.wire).toBe(WIRE); // a page sent whole says which wire its server speaks

    write(ws, "ledger", [{ op: "remove", path: "/latest" }]);
    const undonePatch = await expectMessage(ws, "patch");
    expect(undonePatch.doc).toBe("note");
    expect(undonePatch.ops).toEqual([{ op: "replace", path: "/text", value: "" }]);
    const undoneRender = await expectMessage(ws, "render");
    expect(htmlOf(undoneRender)).not.toContain("hello kernel");

    // redo: the undo walked forward again
    write(ws, "ledger", [{ op: "add", path: "/latest" }]);
    const redonePatch = await expectMessage(ws, "patch");
    expect(redonePatch.ops).toEqual([{ op: "replace", path: "/text", value: "hello kernel" }]);
    expect(htmlOf(await expectMessage(ws, "render"))).toContain("hello kernel");
    // nothing left to redo: refused, and the page it holds is the page still, so nothing more
    write(ws, "ledger", [{ op: "add", path: "/latest" }], 9);
    expect(await heard(ws)).toEqual([{ type: "refused", id: 9 }]);

    ws.close();
  });

  test("a write whose handling fails is logged and handed back, and the events after it are still handled", async () => {
    const ws = await open(server);
    const failures: string[] = [];
    const stop = onFailure((what, err) => void failures.push(`${what}: ${(err as Error).message}`));
    try {
      write(ws, "note", [{ op: "replace", path: "/text", value: "boom" }], 1);
      write(ws, "note", [{ op: "replace", path: "/text", value: "after the boom" }]);
      expect(await expectMessage(ws, "refused")).toEqual({ type: "refused", id: 1 }); // the page it holds is as it was: nothing more
      expect((await expectMessage(ws, "patch")).ops).toEqual([{ op: "replace", path: "/text", value: "after the boom" }]);
      expect(failures).toEqual(["handling a write: boom"]);
    } finally {
      stop();
    }
    ws.close();
  });

  test("a drawing that fails is logged, and the connection's next drawing goes ahead", async () => {
    const ws = await open(server);
    const failures: string[] = [];
    const stop = onFailure((what, err) => void failures.push(`${what}: ${(err as Error).message}`));
    try {
      write(ws, "note", [{ op: "replace", path: "/text", value: "undrawable" }]);
      await expectMessage(ws, "patch"); // the write is told; its drawing fails
      write(ws, "note", [{ op: "replace", path: "/text", value: "drawn again" }]);
      await expectMessage(ws, "patch");
      expect(htmlOf(await nextMessage(ws))).toContain("drawn again");
      expect(failures).toEqual(["drawing a page: undrawable"]);
    } finally {
      stop();
    }
    ws.close();
  });

  test("inspect reports the note doc's version and last ops, generically", async () => {
    const ws = await open(server);

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
    const ws = await open(server);
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
    const ws = await open(server);
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
    // everything a write is answered with
    const answer = (doc: string, ops: PatchOp[]): Promise<WireMessage[]> => (write(ws, doc, ops), heard(ws));
    const page = (messages: WireMessage[]): string => htmlOf(messages.filter((m) => m.type === "render").at(-1)!);
    const patched = (messages: WireMessage[]): (string | undefined)[] => messages.filter((m) => m.type === "patch").map((m) => m.doc);
    const reason = '<p class="refused" role="alert">A note needs words.</p>';

    const told = await answer("note", [{ op: "replace", path: "/text", value: "" }]);
    expect(page(told)).toContain(reason);
    expect(patched(told)).toEqual(["told"]); // its own, named by type alone
    ws.send(JSON.stringify({ type: "inspect" }));
    expect(((await expectMessage(ws, "inspect")) as unknown as Inspection).docs.find((d) => d.doc === "note")!.entries).toEqual([]); // nothing happened
    await server.idle();
    await expectQuiet(other); // the other session is told nothing

    // nobody writes a refusal from the wire; and that write, refused without a word, is the
    // session's next, so what it was told goes
    const next = await answer("told", [{ op: "replace", path: "/reason", value: "I say so." }]);
    expect(page(next)).not.toContain("refused");
    expect(patched(next)).toEqual(["told"]);
    ws.close();
    other.close();
  });

  test("a session may be told what went well -- a route that answered a form tells it -- drawn beside the control as a status, where a refusal is an alert; its next write takes it away", async () => {
    const ws = await open(server, "told-by-a-route");
    await tell("told-by-a-route", { doc: "note", path: "/text", said: "Your note is kept." });
    await server.idle();
    expect(htmlOf((await heard(ws)).at(-1)!)).toContain('<p class="note"></p><p class="said" role="status">Your note is kept.</p>');

    write(ws, "note", [{ op: "replace", path: "/text", value: "kept" }], 1);
    expect(await pageNow(ws)).toBe('<p class="note">kept</p>');
    ws.close();
  });

  test("a refused write is answered `refused` with its own id, and why when it says, before the page is handed back", async () => {
    const ws = await open(server);
    const answered = async (sent: () => void): Promise<WireMessage[]> => (sent(), heard(ws));

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
    const bare = await answered(() => ws.send(JSON.stringify({ doc: "note", ops: [{ op: "replace", path: "/text", value: "" }] })));
    expect(bare.map((m) => m.type)).not.toContain("refused");
    expect(htmlOf(bare.at(-1)!)).toContain("A note needs words.");
    ws.close();
  });

  test("a write the store refuses (403: the model's guards; 401: nobody they know) is refused on the page with the store's reason; another error is reported", async () => {
    // an app of its own: the store's refusal stands in front of it, as the model's guards do (dzql/modelling/guards)
    const guarded = createLocal();
    guarded.server.on("delta", (msg, _client, respond) => {
      if (JSON.stringify(msg.ops ?? []).includes('"forbidden"')) respond({ error: { code: 403, message: "The store says no." } });
      if (JSON.stringify(msg.ops ?? []).includes('"anonymous"')) respond({ error: { code: 401, message: "Sign in to write to note." } });
      if (JSON.stringify(msg.ops ?? []).includes('"clashing"')) respond({ error: { code: 500, message: "The disk is full." } });
    });
    const store = new Database(":memory:");
    createTables(store, schema);
    registerDocs(guarded.server, store, schema, [defineDoc("note:", { root: "notes", include: [], implied: true })], [], { ledger: true });
    const app = await createServer({ name: "guarded", resources: [{ ...noteResource, shape: undefined }], render: () => "<p>guarded</p>", active: () => true, index, delta: guarded }, 0);
    try {
      const ws = await open(app);
      const id = write(ws, "note", [{ op: "replace", path: "/text", value: "forbidden" }]);
      expect(await expectMessage(ws, "refused")).toEqual({ type: "refused", id, reason: "The store says no." });
      // the next refusal, past what the last one told the page
      const refusal = async () => {
        for (let m = await nextMessage(ws); ; m = await nextMessage(ws)) if (m.type === "refused") return m;
      };
      // a 401 is a refusal too, saying why (cafe-d's feedback: it was "delta applied nothing")
      const unsigned = write(ws, "note", [{ op: "replace", path: "/text", value: "anonymous" }]);
      expect(await refusal()).toEqual({ type: "refused", id: unsigned, reason: "Sign in to write to note." });
      // the store failing is reported, and the write refused
      const heard: string[] = [];
      const stop = onFailure((what, err) => heard.push(`${what}: ${(err as Error).message}`));
      const clash = write(ws, "note", [{ op: "replace", path: "/text", value: "clashing" }]);
      expect(await refusal()).toMatchObject({ type: "refused", id: clash });
      stop();
      expect(heard).toEqual(["writing note: 500: The disk is full."]);
      ws.close();
    } finally {
      app.stop(true);
    }
  });

  test("a refused write from a test's socket is answered within a second: `write` gives every write an id, so its refusal has one to answer", async () => {
    const ws = await open(server);
    const id = write(ws, "note", [{ op: "replace", path: "/text", value: "" }]);
    expect(await expectMessage(ws, "refused")).toEqual({ type: "refused", id, reason: "A note needs words." });
    expect(write(ws, "note", [{ op: "replace", path: "/text", value: "" }])).not.toBe(id); // each its own
    ws.close();
  }, 1000);

  test("an undo or redo with an id is answered as a write is: the change it walked echoed with the id, and nothing to walk refused with it", async () => {
    const ws = await open(server);
    write(ws, "note", [{ op: "replace", path: "/text", value: "walked" }], 1);
    expect(await expectMessage(ws, "patch")).toMatchObject({ doc: "note", id: 1 });
    await expectMessage(ws, "render");
    write(ws, "ledger", [{ op: "remove", path: "/latest" }], 2);
    expect(await expectMessage(ws, "patch")).toMatchObject({ doc: "note", id: 2, ops: [{ path: "/text", value: "" }] });
    await expectMessage(ws, "render");
    write(ws, "ledger", [{ op: "add", path: "/latest" }], 3);
    expect(await expectMessage(ws, "patch")).toMatchObject({ doc: "note", id: 3, ops: [{ path: "/text", value: "walked" }] });
    await expectMessage(ws, "render");
    write(ws, "ledger", [{ op: "add", path: "/latest" }], 4); // nothing left to redo
    expect(await nextMessage(ws)).toEqual({ type: "refused", id: 4 });
    ws.close();
  });

  test("what a write did is told to its writer beside the control that sent it, and what its undo or redo did over the page, where Undo is; each until the next write", async () => {
    const ws = await open(server);
    const pageAfter = async (doc: string, ops: PatchOp[], id: WriteId): Promise<string> => (write(ws, doc, ops, id), pageNow(ws));
    walks.length = 0;
    expect(await pageAfter("note", [{ op: "replace", path: "/text", value: "said" }], 1)).toBe('<p class="note">said</p><p class="said" role="status">Noted.</p>');
    expect(await pageAfter("ledger", [{ op: "remove", path: "/latest" }], 2)).toBe('<p class="note"></p><div data-eta-part="undo-said" class="undo-said"><p class="said" role="status">Undone: “said”.</p></div>');
    expect(await pageAfter("ledger", [{ op: "add", path: "/latest" }], 3)).toBe('<p class="note">said</p><div data-eta-part="undo-said" class="undo-said"><p class="said" role="status">Redone: “said”.</p></div>');
    // each walk is told which way it went, what it wrote and what that wrote over
    expect(walks).toEqual([
      { way: "undo", ops: [{ op: "replace", path: "", value: { text: "" } }], inverse: [{ op: "replace", path: "", value: { text: "said" } }] },
      { way: "redo", ops: [{ op: "replace", path: "", value: { text: "said" } }], inverse: [{ op: "replace", path: "", value: { text: "" } }] },
    ]);
    expect(await pageAfter("note", [{ op: "replace", path: "/text", value: "quiet" }], 4)).toBe('<p class="note">quiet</p>'); // says nothing: what was said goes
    ws.close();
  });

  test("an undo or redo that says nothing takes away what its walker was told before, as a write does", async () => {
    const ws = await open(server, "told-then-walks");
    write(ws, "note", [{ op: "replace", path: "/text", value: "unsaid" }], 1);
    await heard(ws);
    await tell("told-then-walks", { doc: "note", path: "/text", said: "Kept." }); // as a route might, after
    await server.idle();
    write(ws, "ledger", [{ op: "remove", path: "/latest" }], 2);
    expect(await pageNow(ws)).toBe('<p class="note"></p>');
    ws.close();
  });

  test("an undo that changes nothing -- it reaches a write that changed nothing -- lands, and is answered by its id with an echo of nothing, not left unanswered", async () => {
    const ws = await open(server);
    write(ws, "note", [{ op: "replace", path: "/text", value: "same" }], 1);
    write(ws, "note", [{ op: "replace", path: "/text", value: "same" }], 2);
    expect((await heard(ws)).filter((m) => m.type === "patch").map((m) => m.id)).toEqual([1, 2]);
    write(ws, "ledger", [{ op: "remove", path: "/latest" }], 3);
    expect((await heard(ws)).find((m) => m.id === 3)).toMatchObject({ type: "patch", doc: "note", ops: [], id: 3 });
    ws.close();
  });

  test("a change told from outside any event -- a feed's tick, slow to follow -- does not cost a write made meanwhile its id", async () => {
    const ws = await open(server);
    const tick = serverWrite("tick:1", [{ op: "replace", path: "/n", value: 1 }]);
    await Bun.sleep(10); // told, and still being followed (afterChange)
    write(ws, "note", [{ op: "replace", path: "/text", value: "during the tick" }], 42);
    await tick;
    expect((await heard(ws)).filter((m) => m.type === "patch").map((m) => m.id)).toEqual([42]);
    ws.close();
  });

  test("what follows a write or a walk failing is the server's failure, not a refusal: it landed, and its writer is told so once", async () => {
    const ws = await open(server);
    const failures: string[] = [];
    const stop = onFailure((what, err) => void failures.push(`${what}: ${(err as Error).message}`));
    const error = console.error;
    console.error = () => {};
    try {
      write(ws, "note", [{ op: "replace", path: "/text", value: "then boom" }], 9);
      const answers = (await heard(ws)).filter((m) => m.id === 9);
      expect(answers.map((m) => m.type)).toEqual(["patch"]);
      expect(failures).toEqual(["following a write to note: then boom"]); // a session's own, named by its type
      write(ws, "note", [{ op: "replace", path: "/text", value: "walks badly" }], 10);
      await heard(ws);
      write(ws, "ledger", [{ op: "remove", path: "/latest" }], 11);
      expect((await heard(ws)).filter((m) => m.id === 11).map((m) => m.type)).toEqual(["patch"]);
      expect(failures).toEqual(["following a write to note: then boom", "following a walk of note: walks badly"]);
    } finally {
      console.error = error;
      stop();
    }
    ws.close();
  });

  test("an id is at most 64 characters, and a number JSON can say: a longer one is not a write, a number it cannot is no id", async () => {
    const ws = await open(server);
    const longest = "x".repeat(64);
    write(ws, "note", [{ op: "replace", path: "/text", value: "a long id" }], longest);
    expect((await heard(ws)).find((m) => m.type === "patch")?.id).toBe(longest);

    write(ws, "note", [{ op: "replace", path: "/text", value: "too long an id" }], "x".repeat(65));
    const tooLong = await heard(ws);
    expect(tooLong.map((m) => m.type)).toEqual(["render"]); // not a write: the page handed back, and no id sent back to say so
    expect(htmlOf(tooLong[0]!)).not.toContain("too long an id");

    ws.send(`{"id":1e400,"doc":"note","ops":[{"op":"replace","path":"/text","value":"beyond a number"}]}`); // Infinity, which JSON says back as null
    const beyond = (await heard(ws)).find((m) => m.type === "patch");
    expect(beyond).toMatchObject({ ops: [{ path: "/text", value: "beyond a number" }] });
    expect(beyond).not.toHaveProperty("id");
    ws.close();
  });

  test("a field typed in says what it was drawn with when the typing began: drawn otherwise now, its write is refused and says so; drawn so, it lands", async () => {
    const ws = await open(server, "typing-ann");
    write(ws, "note", [{ op: "replace", path: "/text", value: "Ben's" }], 1); // as though someone changed it under the caret
    await heard(ws);
    const typed = (was: string, value: string, id: number) => write(ws, "note", [{ op: "test", path: "/text", value: was }, { op: "replace", path: "/text", value }], id);

    typed("", "Ann's", 2);
    const refused = await heard(ws);
    expect(refused[0]).toEqual({ type: "refused", id: 2, reason: CHANGED_SINCE });
    expect(htmlOf(refused.at(-1)!)).toContain(CHANGED_SINCE); // beside the field
    expect(readNote("typing-ann")).toBe("Ben's");

    typed("Ben's", "Ann's", 3); // the textarea's first newline is the browser's to drop, as the server does
    expect((await heard(ws)).find((m) => m.type === "patch" && m.doc === "note")).toMatchObject({ id: 3, ops: [{ op: "replace", path: "/text", value: "Ann's" }] }); // a test is no change: its echo carries none

    ws.send(JSON.stringify({ id: 4, doc: "note", ops: [{ op: "test", path: "/text", value: "Ann's" }] })); // a test alone is no write
    expect((await heard(ws))[0]).toEqual({ type: "refused", id: 4 });
    ws.close();
  });

  test("an unpermitted op is rejected without crashing: no patch echo, and the page not sent again", async () => {
    const ws = await open(server);

    write(ws, "note", [{ op: "remove", path: "/text" }], 1); // permit() only allows replace
    expect(await heard(ws)).toEqual([{ type: "refused", id: 1 }]); // no patch, and no page: the one it holds is the page still

    ws.close();
  });
});

describe("a server is routes to resources: apps composed side by side", () => {
  test("two apps never answer one path: composing them says which", () => {
    const hello = () => new Response("hello");
    expect(() => compose({ routes: { "/hello": hello } }, { routes: { "/hello": hello } })).toThrow("two apps serve /hello: mount one at its own path (Example.at)");
  });

  test("two examples on one server, each under its path: its page, its socket, its cookie, its own state", async () => {
    const app = (name: string, at: string): Example => ({ name, at, resources: [], render: () => `<p>${name}</p>`, active: () => true, index, delta: createLocal(), routes: { "/menu": () => new Response(name) } });
    const [a, b] = [await appOf(app("cafe", "")), await appOf(app("model", "/model"))];
    // and delta's own socket, its actions registered as resources: a JSON-RPC call answered on its path
    const rpc = createWs({ path: "/rpc" });
    rpc.on("ping", (msg, _ws, respond) => respond({ result: `pong ${msg.n}` }));
    const { server } = serve(compose(a, b, { routes: { "/model/hello": () => new Response("a route of its own") }, ws: rpc }), { port: 0 });
    try {
      const socket = async (path: string) => {
        const ws = new WebSocket(new URL(path, server.url.href.replace("http", "ws")));
        const first = await new Promise<{ type: string; html: string }>((resolve) => ws.addEventListener("message", (e) => resolve(JSON.parse(String(e.data))), { once: true }));
        ws.close();
        return first;
      };
      expect((await socket("/ws")).html).toContain("<p>cafe</p>");
      expect((await socket("/model/ws")).html).toContain("<p>model</p>");
      expect((await fetch(new URL("/model/hello", server.url))).status).toBe(200);
      expect([await (await fetch(new URL("/menu", server.url))).text(), await (await fetch(new URL("/model/menu", server.url))).text()]).toEqual(["cafe", "model"]);
      const called = new WebSocket(new URL("/rpc", server.url.href.replace("http", "ws")));
      await new Promise((r) => called.addEventListener("open", r, { once: true }));
      called.send(JSON.stringify({ id: 1, action: "ping", n: 7 }));
      expect(await new Promise((resolve) => called.addEventListener("message", (e) => resolve(JSON.parse(String(e.data))), { once: true }))).toEqual({ id: 1, result: "pong 7" });
      called.close();
      expect((await fetch(new URL("/model/api/health", server.url))).status).toBe(200);
      const upgrade = (path: string) => fetch(new URL(path, server.url), { headers: { Connection: "Upgrade", Upgrade: "websocket", "Sec-WebSocket-Version": "13", "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==" } });
      expect((await upgrade("/model/ws")).headers.get("set-cookie")).toContain("Path=/model");
      expect((await upgrade("/ws")).headers.get("set-cookie")).toContain("Path=/;");
      expect(a.scope).not.toBe(b.scope);
    } finally {
      server.stop(true);
      for (const close of [...a.close, ...b.close]) close();
    }
  });

  test("two resources owning one document type throw, the kernel's ledger among them", () => {
    const twice = { ...makeExample("twice"), resources: [noteResource, noteResource] };
    expect(() => assemble(twice)).toThrow('twice: two resources own "note"');
    const ledgered = { ...makeExample("ledgered"), resources: [{ ...noteResource, docType: "ledger" }] };
    expect(() => assemble(ledgered)).toThrow(`ledgered: two resources own "ledger" (the kernel's own)`);
  });

  test("calling it again with the very same example object does not throw", async () => {
    const example = makeExample("reused");
    const a = await createServer(example, 0);
    const b = await createServer(example, 0);
    a.stop(true);
    b.stop(true);
  });
});

describe("one socket, any documents: a document is named whole, and seen because the page read it", () => {
  let server: Awaited<ReturnType<typeof createServer>>;

  beforeAll(async () => {
    server = await createServer(makeExample("kernel-month-test"), 0);
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
    const ws = await open(server, sessionId);
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
    write(a, "nothing:here", [{ op: "add", path: "/x", value: 1 }], 1); // refused: the page is drawn again, without August
    expect((await heard(a)).map((m) => m.type)).toEqual(["refused", "render"]);

    write(b, "month:2026-08", [{ op: "add", path: "/appointments/-", value: "vet" }]);
    await nextPatch(b);
    write(a, "month:2026-08", [{ op: "add", path: "/appointments/-", value: "not mine now" }], 2);
    expect(await heard(a)).toEqual([{ type: "refused", id: 2 }]); // no patch about August came first, and the write was refused
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
    const toA = await heard(a);
    expect(toA.filter((m) => m.type === "refused")).toEqual([{ type: "refused", id: 8 }]);
    expect(toA.filter((m) => m.type === "patch").map((m) => m.id)).toEqual([undefined]); // b's write, echoed to a: not a's
    expect((await heard(b)).filter((m) => m.type === "refused" || m.id !== undefined)).toMatchObject([{ type: "patch", id: "b-2" }]);

    // a write without an id -- a page from before ids, the CLI -- is echoed as it always was
    write(a, "month:2026-08", [{ op: "add", path: "/appointments/-", value: "no id" }]);
    expect(await nextPatch(a)).not.toHaveProperty("id");

    a.close();
    b.close();
  });

  test("a write's echo to its writer names its change by a handle of the session's own -- never the ledger's entry, whose numbers count everyone's writes -- which undoes that change, not the session's last, and redoes it", async () => {
    const { ws: a } = await showingMonths("2026-10");
    const { ws: b } = await showingMonths("2026-10");
    const whats = async () => (await appointments("2026-10")).map((x) => x.what);

    write(a, "month:2026-10", [{ op: "add", path: "/appointments/-", value: "dentist" }], 1);
    const dentist = await nextPatch(a);
    expect({ id: dentist.id, change: HANDLE.test(dentist.change!), entry: dentist.entry }).toEqual({ id: 1, change: true, entry: undefined });
    expect(await nextPatch(b)).not.toHaveProperty("change");
    write(a, "month:2026-10", [{ op: "add", path: "/appointments/-", value: "haircut" }], 2);
    expect((await nextPatch(a)).change).not.toBe(dentist.change);
    await nextPatch(b);

    write(a, "ledger", [{ op: "remove", path: `/${dentist.change}` }], 3);
    const undone = await nextPatch(a);
    expect(undone).toMatchObject({ doc: "month:2026-10", id: 3, ops: [{ op: "remove" }] });
    expect(HANDLE.test(undone.change!)).toBe(true);
    expect(await nextPatch(b)).not.toHaveProperty("change");
    expect(await whats()).toEqual(["haircut"]);

    write(a, "ledger", [{ op: "add", path: `/${undone.change}` }], 4); // named by its undo's handle: the same change
    expect(await nextPatch(a)).toMatchObject({ id: 4, ops: [{ op: "add", value: { what: "dentist" } }] });
    expect(await whats()).toEqual(["dentist", "haircut"]);
    a.close();
    b.close();
  });

  test("a named undo or redo by a handle this session was not given -- another's, or a ledger entry's number -- or one that goes nowhere, is refused, and says why", async () => {
    const { ws: a } = await showingMonths("2026-11");
    const { ws: b } = await showingMonths("2026-11");
    const refusal = async (ws: WebSocket) => (await heard(ws)).find((m) => m.type === "refused");

    write(b, "month:2026-11", [{ op: "add", path: "/appointments/-", value: "b's" }], "b-1");
    const theirs = await nextPatch(b);
    write(a, "ledger", [{ op: "remove", path: `/${theirs.change}` }], 1);
    expect(await refusal(a)).toEqual({ type: "refused", id: 1, reason: `No change of yours is called ${theirs.change}.` });

    write(a, "month:2026-11", [{ op: "add", path: "/appointments/-", value: "a's" }], 2);
    const mine = (await heard(a)).find((m) => m.id === 2)!;
    write(a, "ledger", [{ op: "add", path: `/${mine.change}` }], 3);
    expect(await refusal(a)).toEqual({ type: "refused", id: 3, reason: "That change has not been undone." });
    write(a, "ledger", [{ op: "remove", path: `/${mine.change}` }], 4);
    expect((await heard(a)).find((m) => m.id === 4)).toMatchObject({ type: "patch", ops: [{ op: "remove" }] });
    write(a, "ledger", [{ op: "remove", path: `/${mine.change}` }], 5);
    expect(await refusal(a)).toEqual({ type: "refused", id: 5, reason: "That change is undone already." });

    // a ledger entry's number, or anything else that is no handle, is no change: the ledger refuses it
    for (const path of ["/1", "/2", "/latest/1", "/x", `/${mine.change}0`, ""]) {
      write(a, "ledger", [{ op: "remove", path }], path);
      expect(await refusal(a)).toEqual({ type: "refused", id: path });
    }
    expect((await appointments("2026-11")).map((x) => x.what)).toEqual(["b's"]);
    a.close();
    b.close();
  });

  test("a session's handles go with its last page: open again, the one it was given is no change of its", async () => {
    const { ws: first, sessionId } = await showingMonths("2026-12");
    write(first, "month:2026-12", [{ op: "add", path: "/appointments/-", value: "kept" }], 1);
    const kept = await nextPatch(first);
    const again = await open(server, sessionId);
    write(again, "ledger", [{ op: "remove", path: `/${kept.change}` }], 2); // a second page of the session's: its handles hold
    expect((await heard(again)).find((m) => m.id === 2)).toMatchObject({ type: "patch", ops: [{ op: "remove" }] });
    write(again, "ledger", [{ op: "add", path: `/${kept.change}` }], 3);
    expect((await heard(again)).find((m) => m.id === 3)).toMatchObject({ type: "patch" });
    first.close();
    again.close();
    await server.idle();
    await Bun.sleep(20);
    const later = await open(server, sessionId);
    write(later, "ledger", [{ op: "remove", path: `/${kept.change}` }], 4);
    expect((await heard(later)).find((m) => m.id === 4)).toEqual({ type: "refused", id: 4, reason: `No change of yours is called ${kept.change}.` });
    later.close();
  });

  test("a bare type is the document of that type the connection is on, seen without being shown", async () => {
    const { ws } = await showingMonths();
    write(ws, "month", [{ op: "add", path: "/appointments/-", value: "haircut" }]);
    expect(await nextPatch(ws)).toMatchObject({ doc: "month:2026-09", ops: [{ value: { what: "haircut" } }] });
    ws.close();
  });

  test("what follows a write is given its ops as the page sent them and as they landed: a new row by the id it was made with, never the page's `-`", async () => {
    const { ws } = await showingMonths("2026-09");
    write(ws, "month:2026-09", [{ op: "add", path: "/appointments/-", value: "osteopath" }], 1);
    await nextPatch(ws);
    const made = (await appointments("2026-09")).at(-1)!;
    expect(followed.at(-1)!.sent).toEqual([{ op: "add", path: "/appointments/-", value: "osteopath" }]);
    expect(followed.at(-1)!.landed).toEqual([{ op: "add", path: `/appointments/${made.id}`, value: expect.objectContaining({ what: "osteopath" }) }]);
    ws.close();
  });

  test("permit judges by the name: last month's closed one is seen and not written", async () => {
    const { ws } = await showingMonths("2026-07");
    const before = (await appointments("2026-07")).length;
    write(ws, "month:2026-07", [{ op: "add", path: "/appointments/-", value: "too late" }], 1);
    expect(await heard(ws)).toEqual([{ type: "refused", id: 1 }]); // refused, and nothing else
    expect((await appointments("2026-07")).length).toBe(before);
    expect(monthPermits.at(-1)).toBe("2026-07");
    ws.close();
  });

  test("a document the page does not show is refused before its owner is asked", async () => {
    const { ws } = await showingMonths("2026-08");
    const asked = monthPermits.length;
    write(ws, "month:1999-01", [{ op: "add", path: "/appointments/-", value: "sneaky" }], 1);
    expect(await heard(ws)).toEqual([{ type: "refused", id: 1 }]);
    expect(await appointments("1999-01")).toEqual([]);
    expect(monthPermits.length).toBe(asked);
    ws.close();
  });

  test("a name nothing owns is refused", async () => {
    const { ws } = await showingMonths();
    write(ws, "nothing:here", [{ op: "add", path: "/x", value: 1 }], 1);
    expect(await heard(ws)).toEqual([{ type: "refused", id: 1 }]);
    ws.close();
  });

  test("a session's own document goes by its type; any other by its whole name, a session's number among ids like any other", () => {
    const was = setCookieIsSession(false); // sessions are numbered rows (an example with `session`)
    try {
      expect(wireName("note", "1")).toBe("note"); // note is `perSession`
      expect(wireName("month", "2026-09")).toBe("month:2026-09");
      expect(wireName("month", "1")).toBe("month:1"); // the same number as a session's: a row's, not a credential
    } finally {
      setCookieIsSession(was);
    }
  });

  // 7707774 took this guard out with numbered sessions; an example with no `session` keeps its
  // cookie as the session's id, a credential, and lost it: a document keyed by another's went on the wire.
  test("where the cookie is the session: one keyed by your own goes by its type; one keyed by another live session, not perSession, is refused by name", () => {
    const was = setCookieIsSession(true);
    const me = { data: { sessionId: "s-me" } } as unknown as Bun.ServerWebSocket<ConnectionData>;
    const other = { data: { sessionId: "s-other" } } as unknown as Bun.ServerWebSocket<ConnectionData>;
    openConnection(other);
    try {
      expect(wireName("note", "s-other", me)).toBe("note"); // note is `perSession`
      expect(wireName("month", "2026-09", me)).toBe("month:2026-09");
      expect(wireName("month", "s-me", me)).toBe("month");
      expect(() => wireName("month", "s-other", me)).toThrow("month is keyed by a session id: declare its resource `perSession`, so the id never goes on the wire");
    } finally {
      closeConnection(other);
      setCookieIsSession(was);
    }
  });

  test("where the cookie is the session, a session's own document is told with every value equal to it taken out, whatever field holds it", () => {
    const was = setCookieIsSession(true);
    try {
      const ops: PatchOp[] = [{ op: "add", path: "/notes", value: { id: "c-1", owner: "c-1", text: "c-1 said", n: 3 } }];
      expect(wireOps(noteResource, "c-1", ops)).toEqual([{ op: "add", path: "", value: { text: "c-1 said", n: 3 } }]);
    } finally {
      setCookieIsSession(was);
    }
  });

  // A value equal to the session's number was taken out too: session 3 writing "3" was echoed a `replace` with no value.
  test("a session's own document is told without its id -- a row's `id`, number or text -- and with every other value whatever it says", () => {
    const was = setCookieIsSession(false); // sessions are numbered rows
    const ops: PatchOp[] = [
      { op: "replace", path: "/notes/text", value: "3" },
      { op: "add", path: "/notes", value: { id: 3, text: "3", count: 3 } },
      { op: "add", path: "/notes", value: { id: "3", text: "a" } },
    ];
    expect(wireOps(noteResource, "3", ops)).toEqual([
      { op: "replace", path: "/text", value: "3" },
      { op: "add", path: "", value: { text: "3", count: 3 } },
      { op: "add", path: "", value: { text: "a" } },
    ]);
    setCookieIsSession(was);
  });
});
