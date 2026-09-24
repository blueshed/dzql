import { assemble } from "./compartments";
import { audienceFor, closeConnection, openConnection, readersOf, resolveName, sees, setActiveCompartments, wireName, wireOps } from "./compartments/audience";
import { fragmentsMessage, renderMessage } from "./compartments/render";
import type { ConnectionData } from "./connection";
import { setActiveDocuments, settled, type Documents } from "./documents";
import type { Example } from "./example";
import { patchMessage, type PatchOp } from "./json-patch";
import { failed } from "./failed";
import { splitDoc } from "./names";
import { drawing, shownTo } from "./reading";
import { diff, type Drawn } from "./parts";

type Socket = Bun.ServerWebSocket<ConnectionData>;

// One example per process is an invariant: a running eta process serves exactly one example, and
// this tracks which, so the one place changes are told from (below) draws through it. It's cleared
// when that example's server(s) are all stopped, so a test suite that creates one example's server,
// stops it, then creates a *different* example's server (as the kernel's own generic tests and an
// example's own tests do, in the same process) doesn't trip the guard below.
let active: { example: Example; assembled: ReturnType<typeof assemble>; servers: number } | undefined;

// What each connection was last sent, so the next drawing sends only what differs (src/parts.ts).
const sent = new WeakMap<Socket, Drawn>();

// A connection's redraws happen one after another, so a drawing that waited for a document can
// never land after, and undo, a later one.
const drawingFor = new WeakMap<Socket, Promise<void>>();

// Everything an event set going -- redraws, and the changes behind them -- so the event is done
// only when all of it is.
const pending = new Set<Promise<unknown>>();
const track = (p: Promise<unknown>): void => {
  pending.add(p);
  void p.finally(() => pending.delete(p));
};

/**
 * Draws a connection's page -- until every document it reads is held -- and sends what changed:
 * the parts that differ, nothing if none do, or the page whole when its outline changed (a
 * different page) or `whole` says so (a first drawing, a refused write handing the page back).
 * A drawing that fails is logged, and the connection's next drawing goes ahead.
 */
function redraw(ws: Socket, whole = false, written?: { docType: string; docId: string }): Promise<void> {
  const next = (drawingFor.get(ws) ?? Promise.resolve()).then(async () => {
    if (!active) return;
    const { assembled } = active;
    const drawn = await settled(assembled.documents, () => drawing(ws, () => assembled.renderFor(ws.data.sessionId)));
    const prev = sent.get(ws);
    sent.set(ws, drawn);
    const ops = prev && !whole ? diff(prev, drawn, written && wireName(written.docType, written.docId, ws)) : undefined;
    if (ops === undefined) ws.send(renderMessage(drawn.html));
    else if (ops.length > 0) ws.send(fragmentsMessage(ops));
  });
  const done = next.catch((err) => failed("drawing a page", err));
  drawingFor.set(ws, done);
  track(done);
  return done;
}

/** Resolves when everything set going so far -- redraws, and the documents' changes -- is done. */
async function quiet(documents: Documents): Promise<void> {
  while (pending.size > 0) {
    await Promise.allSettled([...pending]);
    await documents.quiet();
  }
}

// Every document copy is told its changes once, whichever server is serving it.
const heard = new WeakSet<Documents>();

/**
 * A change to a document -- a write here, an undo, or another process's over Postgres -- is told
 * from here, and only here: its ops echoed to everyone who sees the document, in eta's paths (a
 * compartment's `at` taken off), and every page that read it drawn again.
 */
function tellChanges(documents: Documents): void {
  if (heard.has(documents)) return;
  heard.add(documents);
  documents.onChange(async ({ doc, ops, v }) => {
    if (active?.assembled.documents !== documents) return; // a copy of an example no longer served
    const { docType, docId } = splitDoc(doc);
    const owner = active.assembled.byDocType.get(docType);
    if (!owner) return;
    const wire = wireOps(owner, docId, ops as PatchOp[]);
    const echoTo = await settled(documents, () => audienceFor(docType, docId));
    for (const ws of echoTo) ws.send(patchMessage(wireName(docType, docId, ws), v ?? 0, wire));
    for (const ws of new Set([...echoTo, ...readersOf(docType, docId)])) void redraw(ws, false, { docType, docId });
    await owner.changed?.(docId, wire);
  });
}

type Write = { doc: string; ops: PatchOp[] };

/** The most ledger entries `inspect` gives a document: it asks delta's history, and every event waits on it. */
const MOST_INSPECTED = 100;

const isInspect = (message: unknown): message is { type: "inspect"; limit?: unknown } => (message as { type?: unknown } | null)?.type === "inspect";

/** How many entries an inspect asked for, as a count from 1 to MOST_INSPECTED; undefined, the default. */
const inspected = (limit: unknown): number | undefined => (Number.isInteger(limit) ? Math.min(Math.max(limit as number, 1), MOST_INSPECTED) : undefined);

const VERBS = new Set(["add", "replace", "remove"]);

/** A write as the wire says it: a document's name, and one op or more, each a verb and a JSON Pointer. */
function isWrite(message: unknown): message is Write {
  const m = message as { doc?: unknown; ops?: unknown } | null;
  return (
    typeof m?.doc === "string" &&
    Array.isArray(m.ops) &&
    m.ops.length > 0 &&
    m.ops.every((op: { op?: unknown; path?: unknown } | null) => VERBS.has(op?.op as string) && typeof op!.path === "string" && (op!.path === "" || op!.path.startsWith("/")))
  );
}

export function createServer(example: Example, port: number | string = process.env.PORT ?? 3000) {
  if (active && active.example !== example) {
    throw new Error(
      `createServer was already called with a different example ("${active.example.name}"); ` +
        `a process may only ever serve one example at a time.`,
    );
  }
  const assembled = assemble(example);
  active = { example, assembled, servers: (active?.servers ?? 0) + 1 };
  const { compartments, byDocType, inspectFor, documents } = assembled;
  setActiveCompartments(byDocType);
  setActiveDocuments(documents);
  tellChanges(documents);

  const who = (ws: Socket): unknown => (example.who ? example.who(ws.data.sessionId) : ws.data.sessionId);

  // Events are handled one at a time, in the order they came: each is done when what it set going
  // is done, so an `inspect` after a write is answered after everything the write caused.
  let queue: Promise<void> = Promise.resolve();
  const enqueue = (fn: () => Promise<void>): void => {
    queue = queue
      .then(fn)
      .then(() => quiet(documents))
      .catch((err) => failed("handling an event", err));
  };

  /** A write from the wire: permitted, shaped, written through delta as the person. */
  async function writeDelta(ws: Socket, owner: (typeof compartments)[number], docId: string, ops: PatchOp[]): Promise<boolean> {
    const kind = owner.kind ?? "written";
    if (kind !== "written" && kind !== "fact") return false; // live, sourced, static: nobody writes them from the wire
    if (!(await settled(documents, () => ops.every((op) => owner.permit?.(ws, op, docId) ?? false)))) return false;
    const shaped = owner.shape ? await settled(documents, () => owner.shape!(ws, docId, ops)) : ops;
    if (shaped.length === 0) return false;
    const at = owner.at ?? "";
    const written = await documents.write(
      `${owner.docType}:${docId}`,
      shaped.map((op) => ({ ...op, path: at + op.path })) as never,
      { identity: who(ws), cursor: ws.data.sessionId, undoable: kind !== "fact" },
    );
    if ("error" in written || written.ops.length === 0) return false;
    if ((written.entry === undefined) !== (owner.ledger === false)) {
      const why = owner.ledger === false ? "its compartment keeps it off the ledger (ledger: false), yet delta recorded the write" : "delta recorded no ledger entry: register it with { ledger: true }, or say its compartment keeps it off the ledger (ledger: false)";
      failed(`writing ${owner.own ? owner.docType : `${owner.docType}:${docId}`}`, new Error(why)); // a session's own named by type: its id is a credential
    }
    await owner.wrote?.(ws, docId, ops);
    return true;
  }

  /** Undo or redo: delta walks the session's cursor; the change is told like any other. */
  async function walk(ws: Socket, ops: PatchOp[]): Promise<boolean> {
    const ledger = byDocType.get("ledger")!;
    if (!(await settled(documents, () => ops.every((op) => ledger.permit!(ws, op, ws.data.sessionId))))) return false;
    return (await documents.walk(ops[0]!.op === "add" ? "redo" : "undo", { identity: who(ws), cursor: ws.data.sessionId })) !== null;
  }

  /**
   * A write names its document: whole (`room:general`), or by type alone for the one of that type
   * this connection is on. Whichever, a connection writes only what it sees, and then only what the
   * owner permits. True when something was applied.
   */
  async function write(ws: Socket, { doc, ops }: Write): Promise<boolean> {
    const target = await settled(documents, () => resolveName(byDocType, doc, ws));
    if (!target || !(await settled(documents, () => sees(target.owner, ws, target.docId)))) return false;
    return target.owner.docType === "ledger" ? walk(ws, ops) : writeDelta(ws, target.owner, target.docId, ops);
  }

  async function handle(ws: Socket, message: unknown): Promise<void> {
    if (isInspect(message)) {
      ws.send(JSON.stringify({ type: "inspect", ...(await inspectFor(ws, inspected(message.limit))) }));
      return;
    }
    // A write that applied something is told from its change, the writer's page with the rest.
    // Nothing applied -- refused, not a write at all, an unknown document, nothing to walk, or a
    // failure on the way -- hands the page back.
    let wrote = false;
    try {
      wrote = isWrite(message) && (await write(ws, message));
    } catch (err) {
      failed("handling a write", err);
    }
    if (!wrote) void redraw(ws, true);
  }

  /** Lets go of the documents no open page reads any more. */
  async function release(): Promise<void> {
    const keep = new Set<string>();
    for (const ws of openSockets) for (const doc of shownTo(ws)) keep.add(doc);
    await documents.release(keep);
  }
  const openSockets = new Set<Socket>();

  const server = Bun.serve<ConnectionData>({
    port,
    routes: {
      ...example.routes,
      "/": example.index,
      // A page an example puts in the URL (change-request.md item 3) is a path the server has
      // never heard of -- it doesn't resolve one, it just hands back the same shell for any path
      // that isn't an exact route above, and the client reads the URL itself once it connects.
      "/*": example.index,
      "/api/health": () => Response.json({ ok: true }),
      "/ws": (req: Bun.BunRequest, server: Bun.Server<ConnectionData>) => {
        const sessionId = req.cookies.get("session_id") ?? crypto.randomUUID();
        if (!req.cookies.has("session_id")) {
          req.cookies.set("session_id", sessionId, {
            path: "/",
            httpOnly: true,
            sameSite: "lax",
            secure: process.env.NODE_ENV === "production",
          });
        }

        const headers = new Headers();
        for (const setCookie of req.cookies.toSetCookieHeaders()) {
          headers.append("Set-Cookie", setCookie);
        }

        if (server.upgrade(req, { data: { sessionId }, headers })) return;
        return new Response("Upgrade failed", { status: 400 });
      },
    },
    websocket: {
      open(ws) {
        openConnection(ws);
        openSockets.add(ws);
        enqueue(async () => {
          for (const compartment of compartments) await compartment.onOpen?.(ws);
          await redraw(ws, true);
        });
      },
      message(ws, raw) {
        let message: unknown;
        try {
          message = JSON.parse(String(raw));
        } catch {
          message = undefined; // not JSON: no write, so the page is handed back
        }
        enqueue(() => handle(ws, message));
      },
      close(ws) {
        closeConnection(ws);
        openSockets.delete(ws);
        enqueue(async () => {
          for (const compartment of compartments) await compartment.onClose?.(ws);
          await quiet(documents);
          await release();
        });
      },
    },
    development: process.env.NODE_ENV !== "production",
  });

  const stop = server.stop.bind(server);
  let stopped = false;
  server.stop = ((...args: Parameters<typeof server.stop>) => {
    if (!stopped && active?.example === example && --active.servers === 0) {
      active = undefined;
      setActiveCompartments(undefined);
      setActiveDocuments(undefined);
    }
    stopped = true;
    return stop(...args);
  }) as typeof server.stop;

  /** Resolves when every event so far has been handled and everything it set going is done. */
  const settledServer = Object.assign(server, { idle: () => queue.then(() => quiet(documents)) });
  return settledServer;
}
