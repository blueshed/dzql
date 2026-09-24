import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Compartment, WriteResult } from "./compartments/compartment";
import type { Example } from "./example";
import index from "./server.test.fixture.html";
import type { PatchOp } from "./json-patch";
import { patchMessage } from "./json-patch";
import { prefixDoc, record } from "./ledger";
import { renderRequested } from "./compartments/render";
import { notify } from "./compartments/audience";
import { createServer } from "./server";

// A tiny, self-contained compartment + example -- not chat, not anything under
// the examples directory -- so this file can prove the kernel (assemble/createServer/the
// ledger compartment's undo-via-replay) works on its own, without needing
// the chat example to exist at all. State lives in a plain Map, not SQL,
// because only the ledger's record()/undo cursor need to be real for undo
// to be worth testing here.
type NoteState = { text: string };
const notes = new Map<string, NoteState>();

function readNote(id: string): NoteState {
  return notes.get(id) ?? { text: "" };
}

function applyOps(id: string, ops: PatchOp[]): { applied: PatchOp[]; inverse: PatchOp[] } {
  const state = readNote(id);
  const applied: PatchOp[] = [];
  const inverse: PatchOp[] = [];
  for (const op of ops) {
    if (op.path !== "/text" || op.op !== "replace") continue;
    inverse.unshift({ op: "replace", path: "/text", value: state.text });
    state.text = String(op.value ?? "");
    applied.push(op);
  }
  notes.set(id, state);
  return { applied, inverse };
}

function noteWrite(ws: Bun.ServerWebSocket<{ sessionId: string }>, id: string, ops: PatchOp[], undoes?: number): WriteResult {
  const { applied, inverse } = applyOps(id, ops);
  const version = record(prefixDoc("note", id), applied, inverse, ws.data.sessionId, undoes);
  const result: WriteResult = { version, applied };
  if (applied.length > 0) {
    ws.send(patchMessage("note", version, applied));
    // Ask for the render through the bus, naming the write, so `fragments` below gets its say
    // and, absent that, rule 2's default (a single replace of this compartment's own element).
    renderRequested.emit({ sockets: [ws], write: { docType: "note", docId: id, result } });
  }
  return result;
}

const noteCompartment: Compartment = {
  docType: "note",
  resolveDoc(ws) {
    return ws.data.sessionId;
  },
  permit(ws, op) {
    return op.path === "/text" && op.op === "replace";
  },
  write(ws, id, ops, undoes) {
    return noteWrite(ws, id, ops, undoes);
  },
  // Text beginning "frag" is answered as one HTML op; "quiet" as nothing at all; anything
  // else declines, and the kernel sends the page.
  fragments(ws, id) {
    const { text } = readNote(id);
    if (text.startsWith("frag")) return [{ op: "replace", target: ".note", html: `<p class="note">${text}</p>` }];
    if (text.startsWith("quiet")) return [];
    return undefined;
  },
};

// Documents whose name is criteria: a month of appointments, `month:2026-09`. Every connection
// sees July, August and September at once; July is closed, so it is seen and not written; any
// other month is seen by nobody. The month a connection is on (a bare `month`) is September.
const SEEN_MONTHS = ["2026-07", "2026-08", "2026-09"];
const months = new Map<string, string[]>();
const monthPermits: string[] = [];

const monthCompartment: Compartment = {
  docType: "month",
  resolveDoc: () => "2026-09",
  sees: (_ws, docId) => SEEN_MONTHS.includes(docId),
  permit(_ws, op, docId) {
    monthPermits.push(docId);
    return op.op === "add" && op.path === "/appointments/-" && docId !== "2026-07";
  },
  write(ws, id, ops, undoes) {
    const list = months.get(id) ?? [];
    const applied = ops.filter((op) => op.op === "add");
    for (const op of applied) list.push(String(op.value));
    months.set(id, list);
    const inverse = applied.map(() => ({ op: "remove" as const, path: `/appointments/${list.length - 1}` }));
    const result: WriteResult = { version: record(prefixDoc("month", id), applied, inverse, ws.data.sessionId, undoes), applied };
    notify("month", id, result);
    return result;
  },
  fragments: () => [],
};

function makeExample(name: string): Example {
  return {
    name,
    compartments: [noteCompartment, monthCompartment],
    render: (sessionId) => `<p class="note">${readNote(sessionId).text}</p>`,
    active: () => true,
    index,
  };
}

type WireMessage = { type: string; html?: string; doc?: string; version?: number; ops?: unknown[] };

/** A render's HTML, whether it came as the whole page or as fragment ops (rule 2's default: a
 * single replace of the owning compartment's own element, unless it answers `fragments` itself). */
const htmlOf = (m: WireMessage): string =>
  m.html ?? (m.ops as { html?: string }[] | undefined ?? []).map((o) => o.html ?? "").join("");

const queues = new WeakMap<WebSocket, WireMessage[]>();
const waiters = new WeakMap<WebSocket, ((message: WireMessage) => void)[]>();

function connect(server: ReturnType<typeof createServer>): WebSocket {
  const url = new URL("/ws", server.url);
  url.protocol = "ws:";
  const ws = new WebSocket(url);

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
    expect(patch.ops).toEqual([{ op: "replace", path: "/text", value: "hello kernel" }]);
    // "hello kernel" doesn't start with "frag"/"quiet", so fragments() declines and the page goes whole
    const rendered = await expectMessage(ws, "render");
    expect(rendered.ops).toBeUndefined();
    expect(rendered.html).toBe('<p class="note">hello kernel</p>');

    write(ws, "ledger", [{ op: "remove", path: "/latest" }]);
    const undonePatch = await expectMessage(ws, "patch");
    expect(undonePatch.doc).toBe("note");
    expect(undonePatch.ops).toEqual([{ op: "replace", path: "/text", value: "" }]);
    const undoneRender = await expectMessage(ws, "render");
    expect(htmlOf(undoneRender)).not.toContain("hello kernel");

    // redo: the undo walked forward again, through the same replay
    write(ws, "ledger", [{ op: "add", path: "/latest" }]);
    const redonePatch = await expectMessage(ws, "patch");
    expect(redonePatch.ops).toEqual([{ op: "replace", path: "/text", value: "hello kernel" }]);
    expect(htmlOf(await expectMessage(ws, "render"))).toContain("hello kernel");
    // nothing left to redo: a render, no patch
    write(ws, "ledger", [{ op: "add", path: "/latest" }]);
    await expectMessage(ws, "render");

    ws.close();
  });

  test("a compartment's fragments are sent instead of the page; nothing is sent when it says nothing changed; its own element (not the page) when it declines", async () => {
    const ws = connect(server);
    await opened(ws);
    await expectMessage(ws, "render");

    write(ws, "note", [{ op: "replace", path: "/text", value: "frag one" }]);
    await expectMessage(ws, "patch");
    const fragment = await expectMessage(ws, "render");
    expect(fragment.html).toBeUndefined();
    expect(fragment.ops).toEqual([{ op: "replace", target: ".note", html: '<p class="note">frag one</p>' }]);

    write(ws, "note", [{ op: "replace", path: "/text", value: "quiet" }]);
    await expectMessage(ws, "patch");
    // no render follows: the next thing this connection hears is the next write's echo
    write(ws, "note", [{ op: "replace", path: "/text", value: "plain" }]);
    await expectMessage(ws, "patch");
    // "plain" declines fragments(), so the page goes whole
    const own = await expectMessage(ws, "render");
    expect(own.ops).toBeUndefined();
    expect(own.html).toBe('<p class="note">plain</p>');

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
    expect(note?.entries?.[0]).toMatchObject({ ops: [{ op: "replace", path: "/text", value: "inspect me" }] });
    // a session id is the only credential: it never goes on the wire, not even your own. "Was this
    // write mine" is all a reader may ask.
    expect(note?.entries?.[0]).toMatchObject({ mine: true });
    expect(JSON.stringify(inspection)).not.toContain("sessionId");

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

  test("calling it again with the very same example object does not throw", () => {
    const example = makeExample("reused");
    const a = createServer(example, 0);
    const b = createServer(example, 0);
    a.stop(true);
    b.stop(true);
  });
});

describe("one socket, any documents: a document is named whole on the wire", () => {
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

  test("this month and last month, side by side on one socket, each echoed by its whole name", async () => {
    const a = connect(server);
    const b = connect(server);
    await Promise.all([opened(a), opened(b)]);

    write(a, "month:2026-09", [{ op: "add", path: "/appointments/-", value: "dentist" }]);
    expect(await nextPatch(a)).toMatchObject({ doc: "month:2026-09", ops: [{ value: "dentist" }] });
    expect(await nextPatch(b)).toMatchObject({ doc: "month:2026-09", ops: [{ value: "dentist" }] });

    write(a, "month:2026-08", [{ op: "add", path: "/appointments/-", value: "optician" }]);
    expect(await nextPatch(a)).toMatchObject({ doc: "month:2026-08", ops: [{ value: "optician" }] });
    expect(await nextPatch(b)).toMatchObject({ doc: "month:2026-08", ops: [{ value: "optician" }] });

    a.close();
    b.close();
  });

  test("a bare type is the document of that type the connection is on", async () => {
    const ws = connect(server);
    await opened(ws);
    write(ws, "month", [{ op: "add", path: "/appointments/-", value: "haircut" }]);
    expect(await nextPatch(ws)).toMatchObject({ doc: "month:2026-09", ops: [{ value: "haircut" }] });
    ws.close();
  });

  test("permit judges by the name: last month's closed one is seen and not written", async () => {
    const ws = connect(server);
    await opened(ws);
    await expectMessage(ws, "render");
    const before = months.get("2026-07")?.length ?? 0;
    write(ws, "month:2026-07", [{ op: "add", path: "/appointments/-", value: "too late" }]);
    await expectMessage(ws, "render"); // refused: the page again, and nothing else
    expect(months.get("2026-07")?.length ?? 0).toBe(before);
    expect(monthPermits.at(-1)).toBe("2026-07");
    ws.close();
  });

  test("a document the connection does not see is refused before its owner is asked", async () => {
    const ws = connect(server);
    await opened(ws);
    await expectMessage(ws, "render");
    const asked = monthPermits.length;
    write(ws, "month:1999-01", [{ op: "add", path: "/appointments/-", value: "sneaky" }]);
    await expectMessage(ws, "render");
    expect(months.has("1999-01")).toBe(false);
    expect(monthPermits.length).toBe(asked);
    ws.close();
  });

  test("a name nothing owns is refused", async () => {
    const ws = connect(server);
    await opened(ws);
    await expectMessage(ws, "render");
    write(ws, "nothing:here", [{ op: "add", path: "/x", value: 1 }]);
    expect((await nextMessage(ws)).type).toBe("render");
    ws.close();
  });
});
