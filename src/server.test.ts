import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { createTables, defineDoc, defineSchema, registerDocs } from "@blueshed/delta/sqlite";
import { createLocal } from "@blueshed/delta/local";
import type { Compartment } from "./compartments/compartment";
import type { Example } from "./example";
import index from "./server.test.fixture.html";
import type { PatchOp } from "./json-patch";
import { closeConnection, openConnection, wireName } from "./compartments/audience";
import { read } from "./documents";
import { part } from "./parts";
import { createServer } from "./server";
import { assemble, type Inspection } from "./compartments";
import { onFailure } from "./failed";

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

function readNote(id: string): string {
  return read<{ notes: { text: string } }>(`note:${id}`).notes.text;
}

const noteCompartment: Compartment = {
  docType: "note",
  own: true,
  at: "/notes",
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
    return ops;
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
    compartments: [noteCompartment, monthCompartment],
    render: (sessionId) => {
      if (readNote(sessionId) === "undrawable") throw new Error("undrawable"); // a page whose drawing fails
      return `<p class="note">${readNote(sessionId)}</p>` +
        (showing.get(sessionId) ?? []).map((m) => part(`month-${m}`, `<ul data-month="${m}">${readMonth(m).map((a) => part(`a-${a.id}`, `<li>${a.what}</li>`)).join("")}</ul>`)).join("");
    },
    active: () => true,
    index,
    delta,
  };
}

type WireMessage = { type: string; html?: string; doc?: string; version?: number; ops?: unknown[] };

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

function write(ws: WebSocket, doc: string, ops: PatchOp[]) {
  ws.send(JSON.stringify({ doc, ops }));
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

  test("a non-upgrade request to /ws is rejected", async () => {
    const res = await fetch(new URL("/ws", server.url));
    expect(res.status).toBe(400);
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
    expect(() => assemble(ledgered)).toThrow(`ledgered: two compartments own "ledger" (the kernel's own ledger)`);
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

  test("a session's own document goes by its type; one keyed by a live session and not own is refused by name", () => {
    const me = { data: { sessionId: "s-me" } } as unknown as Bun.ServerWebSocket<{ sessionId: string }>;
    const other = { data: { sessionId: "s-other" } } as unknown as Bun.ServerWebSocket<{ sessionId: string }>;
    openConnection(other);
    try {
      expect(wireName("note", "s-other", me)).toBe("note"); // note is `own`
      expect(wireName("month", "2026-09", me)).toBe("month:2026-09");
      expect(() => wireName("month", "s-other", me)).toThrow("own");
    } finally {
      closeConnection(other);
    }
  });
});
