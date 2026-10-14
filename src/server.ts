import { assemble } from "./compartments";
import { allOpenSockets, audienceFor, closeConnection, openConnection, readersOf, resolveName, sees, setActiveCompartments, wireName, wireOps } from "./compartments/audience";
import { fragmentsMessage, renderMessage } from "./compartments/render";
import type { ConnectionData } from "./connection";
import { setActiveDocuments, settled, type Documents } from "./documents";
import type { Example } from "./example";
import { isTest, isVerb, isWriteId, patchMessage, refusedMessage, type PatchOp, type Test, type WriteId } from "./json-patch";
import { failed } from "./failed";
import { splitDoc } from "./names";
import { drawing, shownTo } from "./reading";
import { diff, drawnValues, type Drawn } from "./parts";
import { Refusal, refuse, tell } from "./refusal";
import { handleOf, newHandle } from "./compartments/ledger";
import { refuseOrigin } from "@blueshed/delta/server";

type Socket = Bun.ServerWebSocket<ConnectionData>;

/**
 * Sends a message compressed (permessage-deflate, todo n79), each on its own so a connection keeps
 * no context; as it is to a client that did not offer it. The costs measured are in CHANGELOG.md.
 */
const send = (ws: Socket, message: string): void => void ws.send(message, true);

/** Other sites whose pages may open a socket here, from `ETA_ORIGINS` (comma-separated); by default only the page's own. */
const origins = (): string[] | undefined => process.env.ETA_ORIGINS?.split(",").map((o) => o.trim()).filter(Boolean);

/**
 * The cookie that names a session -- its id, a person's only credential: sent back on every
 * request, never readable by a script, never sent from another site. An example that signs people
 * in sets it with a fresh id, never the one the visit had before (a fixed session).
 */
export function sessionCookie(sessionId: string): string {
  return new Bun.Cookie("session_id", sessionId, { path: "/", httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production" }).serialize();
}

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
 * different page) or `whole` says so (a first drawing).
 * A drawing that fails is logged, and the connection's next drawing goes ahead.
 */
function redraw(ws: Socket, whole = false): Promise<void> {
  const next = (drawingFor.get(ws) ?? Promise.resolve()).then(async () => {
    if (!active) return;
    const { assembled } = active;
    const drawn = await settled(assembled.documents, () => drawing(ws, () => assembled.page(ws.data.sessionId)));
    const prev = sent.get(ws);
    sent.set(ws, drawn);
    const ops = prev && !whole ? diff(prev, drawn) : undefined;
    if (ops === undefined) send(ws, renderMessage(drawn.html));
    else if (ops.length > 0) send(ws, fragmentsMessage(ops));
  });
  const done = next.catch((err) => failed("drawing a page", err));
  drawingFor.set(ws, done);
  track(done);
  return done;
}

/**
 * Resolves when everything set going so far -- redraws, and the documents' changes -- is done. The
 * changes are waited for even when no redraw is: one told from outside any event (a feed's tick)
 * may hold the telling, with a write's change still to be told behind it.
 */
async function quiet(documents: Documents): Promise<void> {
  do {
    await Promise.allSettled([...pending]);
    await documents.quiet();
  } while (pending.size > 0);
}

// Every document copy is told its changes once, whichever server is serving it.
const heard = new WeakSet<Documents>();

/**
 * A write with an id, being made: the change it makes to the document it names is "yours" to its
 * writer, echoed to it with the id and the ledger entry that names it. Which change that is, is the
 * one told at the version the write made -- known once delta answers (null: it made none) -- so a
 * change to the same document from elsewhere meanwhile (another process's, over Postgres) is
 * nobody's here.
 */
type Made = { version?: number; entry?: number } | null;
type Claim = { ws: Socket; id: WriteId; doc: string; made: Promise<Made> };
const claims = new Set<Claim>();

/** Makes a write for `ws`, claiming its change to `doc` for the write's id, if it has one. */
function claimed<T>(ws: Socket, id: WriteId | undefined, doc: string, writing: Promise<T>, made: (done: T) => Made): Promise<T> {
  if (id === undefined) return writing;
  claims.add({ ws, id, doc, made: Promise.allSettled([writing]).then(([done]) => (done!.status === "fulfilled" ? made(done.value) : null)) }); // a write that throws made no change
  return writing;
}

/**
 * The changes each session's writes made, by the handle its writer was given for each (todo n99):
 * the echo names a change by a handle of the session's own, never by delta's entry, a serial whose
 * gaps count everyone's writes, in documents this person cannot read too. Undo by change takes a
 * handle and nothing else. Kept while the session has a page open, the last MOST_HANDLES of them.
 */
const handles = new Map<string, Map<string, number>>();
const MOST_HANDLES = 100;

/** A handle for `entry`, a change `sessionId` made. */
function handleFor(sessionId: string, entry: number): string {
  const mine = handles.get(sessionId) ?? handles.set(sessionId, new Map()).get(sessionId)!;
  const handle = newHandle();
  mine.set(handle, entry);
  if (mine.size > MOST_HANDLES) mine.delete(mine.keys().next().value!);
  return handle;
}

/** The claim a change answers, if any: a write's to that document, at that version, with the entry it made. Taken, so it answers once. */
async function claimOf(doc: string, v: number | undefined): Promise<{ ws: Socket; id: WriteId; entry?: number } | undefined> {
  for (const claim of [...claims].filter((c) => c.doc === doc)) {
    const made = await claim.made;
    if (!made || made.version !== v || !claims.delete(claim)) continue;
    return { ws: claim.ws, id: claim.id, entry: made.entry };
  }
  return undefined;
}

/**
 * A change to a document -- a write here, an undo, or another process's over Postgres -- is told
 * from here, and only here: its ops echoed to everyone who sees the document, in eta's paths (a
 * compartment's `under` taken off), and every page that read it drawn again.
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
    const yours = await claimOf(doc, v);
    const echoTo = await settled(documents, () => audienceFor(docType, docId));
    const change = yours?.entry === undefined ? undefined : handleFor(yours.ws.data.sessionId, yours.entry);
    for (const ws of echoTo) send(ws, ws === yours?.ws ? patchMessage(wireName(docType, docId, ws), v ?? 0, wire, yours.id, change) : patchMessage(wireName(docType, docId, ws), v ?? 0, wire));
    for (const ws of new Set([...echoTo, ...readersOf(docType, docId)])) void redraw(ws);
    await owner.afterChange?.(docId, wire);
  });
}

type Write = { id?: unknown; doc: string; ops: (PatchOp | Test)[] };

/** Why a write whose `test` fails is refused, beside the field (todo n4). */
export const CHANGED_SINCE = "This was changed elsewhere as you typed: here it is now.";

/** The most ledger entries `inspect` gives a document: it asks delta's history, and every event waits on it. */
const MOST_INSPECTED = 100;

const isInspect = (message: unknown): message is { type: "inspect"; limit?: unknown } => (message as { type?: unknown } | null)?.type === "inspect";

/** How many entries an inspect asked for, as a count from 1 to MOST_INSPECTED; undefined, the default. */
const inspected = (limit: unknown): number | undefined => (Number.isInteger(limit) ? Math.min(Math.max(limit as number, 1), MOST_INSPECTED) : undefined);

/** A message's id, when it carries one that is an id: what its answer hands back. */
const idOf = (message: unknown): WriteId | undefined => {
  const id = (message as { id?: unknown } | null)?.id;
  return isWriteId(id) ? id : undefined;
};

/**
 * A write as the wire says it: a document's name, and ops, each a verb or a `test` and a JSON
 * Pointer, a verb among them; and an id that is one (`isWriteId`), or none (none given, or a
 * number JSON cannot say back: 1e400 parses as Infinity). One whose id is anything else -- a string longer than an id, an
 * object -- is not a write, so nothing is ever sent back larger than an id.
 */
function isWrite(message: unknown): message is Write {
  const m = message as { id?: unknown; doc?: unknown; ops?: unknown } | null;
  return (
    (m?.id === undefined || typeof m.id === "number" || isWriteId(m.id)) &&
    typeof m?.doc === "string" &&
    Array.isArray(m.ops) &&
    m.ops.some((op: { op?: unknown } | null) => isVerb(op?.op)) &&
    m.ops.every((op: { op?: unknown; path?: unknown } | null) => (isVerb(op?.op) || op?.op === "test") && typeof op!.path === "string" && (op!.path === "" || op!.path.startsWith("/")))
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

  /**
   * A write or a walk has landed: what fails after it is the server's, not a refusal, and its writer
   * is told it landed; what they were told before it goes, so what follows may say what it did.
   */
  async function landed(ws: Socket, follow: () => unknown, what: string): Promise<void> {
    await tell(ws.data.sessionId);
    try {
      await follow();
    } catch (err) {
      failed(what, err);
    }
  }

  /** A permitted write from the wire: shaped, written through delta as the person. */
  async function writeDelta(ws: Socket, owner: (typeof compartments)[number], docId: string, ops: PatchOp[], id?: WriteId): Promise<boolean> {
    const kind = owner.kind ?? "written";
    const shaped = owner.shape ? await settled(documents, () => owner.shape!(ws, docId, ops)) : ops;
    if (shaped.length === 0) return false;
    const at = owner.under ?? "";
    const doc = `${owner.docType}:${docId}`;
    const writing = documents.write(doc, shaped.map((op) => ({ ...op, path: at + op.path })) as never, { identity: who(ws), cursor: ws.data.sessionId, undoable: kind !== "fact" });
    // a fact is never undone: its echo names no change
    const written = await claimed(ws, id, doc, writing, (w) => ("error" in w || w.ops.length === 0 ? null : { version: w.version, entry: kind === "fact" ? undefined : w.entry }));
    if ("error" in written || written.ops.length === 0) return false;
    const named = owner.perSession ? owner.docType : doc; // a session's own named by type: its id is a credential
    if ((written.entry === undefined) !== (owner.ledger === false)) {
      const why = owner.ledger === false ? "its compartment keeps it off the ledger (ledger: false), yet delta recorded the write" : "delta recorded no ledger entry: register it with { ledger: true }, or say its compartment keeps it off the ledger (ledger: false)";
      failed(`writing ${named}`, new Error(why));
    }
    await landed(ws, () => owner.afterWrite?.(ws, docId, ops), `following a write to ${named}`);
    return true;
  }

  /**
   * A permitted undo or redo: delta walks the session's cursor -- its next entry (`/latest`), or one
   * change of the session's named by its handle (`/<change>`) -- and the change is told like any
   * other. The walk is looked at first, and the document's owner may refuse it (`permitUndo`). One that meets
   * someone else's later write changes nothing -- delta moves the cursor past it -- and says so; so
   * does a named change that is not the session's, or goes nowhere. One that lands is followed as a
   * fresh write is (`afterWalk`), knowing which way it went; one that changes nothing lands all the
   * same, and tells no change, so its walker is answered by an echo of nothing.
   */
  async function walk(ws: Socket, ops: PatchOp[], id?: WriteId): Promise<boolean> {
    const way = ops[0]!.op === "add" ? "redo" : "undo";
    const handle = handleOf(ops[0]!.path);
    const change = handle === undefined ? undefined : handles.get(ws.data.sessionId)?.get(handle);
    const unknown = () => refuse(`No change of yours is called ${handle}.`);
    if (handle !== undefined && change === undefined) throw unknown();
    const by = { identity: who(ws), cursor: ws.data.sessionId };
    const plan = await documents.walk(way, by, { dry: true, change });
    if (!plan || "error" in plan) {
      if (change === undefined) return false; // nothing to walk, or no ledger to walk it
      throw plan ? unknown() : refuse(way === "undo" ? "That change is undone already." : "That change has not been undone.");
    }
    const { docType, docId } = splitDoc(plan.doc);
    const owner = byDocType.get(docType);
    if (!plan.conflict && owner?.permitUndo && !(await settled(documents, () => owner.permitUndo!(ws, docId, wireOps(owner, docId, plan.ops as PatchOp[]))))) return false;
    const walking = documents.walk(way, by, { change, entry: plan.entry });
    const walked = await claimed(ws, id, plan.doc, walking, (w) => (w && !("error" in w) && !w.conflict && w.ops.length > 0 ? { version: w.version, entry: w.entry } : null));
    const done = walked && !("error" in walked) ? walked : undefined; // none: walked meanwhile, by another process over Postgres
    if (done?.conflict) throw refuse(`Someone has changed that since, so it cannot be ${way === "undo" ? "undone" : "redone"}.`);
    if (!done) return false;
    await landed(
      ws,
      () => owner?.afterWalk?.(ws, docId, { way, ops: wireOps(owner, docId, done.ops as PatchOp[]), inverse: wireOps(owner, docId, (done.inverse ?? []) as PatchOp[]) }),
      `following a walk of ${owner?.perSession ? owner.docType : plan.doc}`,
    );
    if (id !== undefined && done.ops.length === 0) send(ws, patchMessage(wireName(docType, docId, ws), done.version ?? 0, [], id));
    return true;
  }

  /**
   * A write names its document: whole (`room:general`), or by type alone for the one of that type
   * this connection is on. Whichever, a connection writes only what it sees, of a kind written from
   * the wire (not live, sourced or static), and then only what the owner permits. True when
   * something was applied.
   */
  async function write(ws: Socket, { doc, ops: all }: Write, id: WriteId | undefined): Promise<boolean> {
    const ops = all.filter((op): op is PatchOp => !isTest(op));
    const target = await settled(documents, () => resolveName(byDocType, doc, ws));
    if (!target || !(await settled(documents, () => sees(target.owner, ws, target.docId)))) return false;
    const { owner, docId } = target;
    const kind = owner.kind ?? "written";
    if (kind !== "written" && kind !== "fact") return false;
    if (!(await settled(documents, () => ops.every((op) => owner.permit?.(ws, op, docId) ?? false)))) return false;
    // A field typed in says what it was drawn with as the typing began (todo n4): drawn otherwise on
    // this page now, someone changed it since, unseen, and the typing would write over it.
    const page = sent.get(ws)?.html ?? "";
    if (all.filter(isTest).some((t) => !drawnValues(page, doc, t.path).includes(t.value))) throw refuse(CHANGED_SINCE);
    return owner.docType === "ledger" ? walk(ws, ops, id) : writeDelta(ws, owner, docId, ops, id);
  }

  async function handle(ws: Socket, message: unknown): Promise<void> {
    if (isInspect(message)) {
      send(ws, JSON.stringify({ type: "inspect", ...(await inspectFor(ws, inspected(message.limit))) }));
      return;
    }
    // A write that applied something is told from its change, its echo carrying its id. Nothing
    // applied is answered `refused` (by its id, if it has one, and why when the refusal says, kept
    // for the page until the session's next write: src/refusal.ts), then the page as what differs
    // (todo n103). A message that is no write at all asks for the page whole.
    const id = idOf(message);
    const asWrite = isWrite(message) ? message : undefined;
    let wrote = false;
    let refusal: Refusal | undefined;
    try {
      wrote = asWrite !== undefined && (await write(ws, asWrite, id));
    } catch (err) {
      if (err instanceof Refusal) refusal = err;
      else failed("handling a write", err);
    }
    if (!wrote) {
      if (id !== undefined) send(ws, refusedMessage(id, refusal?.reason));
      if (asWrite) await tell(ws.data.sessionId, refusal && { doc: asWrite.doc, path: asWrite.ops[0]!.path, reason: refusal.reason });
      void redraw(ws, !asWrite); // a message that is no write asks for the page (src/client/app.ts)
    }
    await quiet(documents);
    for (const claim of claims) if (claim.ws === ws) claims.delete(claim); // its change told by now, or never to be
  }

  /** Lets go of the documents no open page reads any more. */
  async function release(): Promise<void> {
    const keep = new Set<string>();
    for (const ws of allOpenSockets()) for (const doc of shownTo(ws)) keep.add(doc);
    await documents.release(keep);
  }

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
      "/ws": async (req: Bun.BunRequest, server: Bun.Server<ConnectionData>) => {
        // A socket is not bound by the same-origin policy: one opened from another site is refused
        // before it is a session (delta's rule: no Origin, or the page's own, or ETA_ORIGINS).
        const refused = refuseOrigin(req, origins());
        if (refused) return refused;
        // Then who it is, where the example can say before it opens (a proxy's header, a token).
        const identified = await example.identify?.(req);
        if (identified instanceof Response) return identified;
        const cookie = req.cookies.get("session_id");
        const sessionId = identified ?? cookie ?? crypto.randomUUID();
        const headers = new Headers();
        if (sessionId !== cookie) headers.append("Set-Cookie", sessionCookie(sessionId));

        if (server.upgrade(req, { data: { sessionId }, headers })) return;
        return new Response("Upgrade failed", { status: 400 });
      },
    },
    websocket: {
      perMessageDeflate: true, // "shared", both ways: a message compressed on its own, as `send` says
      // A message in is at most 1 MiB, inflated: a write is small (a picture goes by HTTP), and past
      // it the socket is closed. Bun's own 16 MB would let a 15 KB compressed frame be a 15 MB write.
      maxPayloadLength: 1 << 20,
      open(ws) {
        openConnection(ws);
        enqueue(async () => {
          try {
            for (const compartment of compartments) await compartment.onOpen?.(ws);
          } finally {
            await redraw(ws, true); // the page is drawn, whatever failed opening it
          }
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
        if (![...allOpenSockets()].some((open) => open.data.sessionId === ws.data.sessionId)) handles.delete(ws.data.sessionId);
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
