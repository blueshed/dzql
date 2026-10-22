import { assemble, forget } from "./resources";
import { allOpenSockets, audienceFor, closeConnection, openConnection, readersOf, resolveName, sees, setActiveResources, wireName, wireOps } from "./resources/audience";
import { drawingFailedMessage, fragmentsMessage, renderMessage } from "./resources/render";
import type { ConnectionData } from "./connection";
import { setActiveDocuments, settled, type Documents } from "./documents";
import type { Example } from "./example";
import { isTest, isVerb, isWriteId, patchMessage, refusedMessage, type PatchOp, type Test, type WriteId } from "./json-patch";
import { failed } from "./failed";
import { splitDoc } from "./names";
import { drawing, shownTo } from "./reading";
import { diff, drawnFields, type Drawn } from "./parts";
import { Refusal, refuse, tell } from "./refusal";
import { handleOf, newHandle } from "./resources/ledger";
import { refuseOrigin } from "@blueshed/delta/server";
import { serve, type App } from "@blueshed/delta/serve";
import { cookieIn, scope, served, unserved, within, type Scope } from "./scope";
import { addressOf } from "./tabs";

type Socket = Bun.ServerWebSocket<ConnectionData>;

/**
 * Sends a message compressed (permessage-deflate), each on its own so a connection keeps
 * no context; as it is to a client that did not offer it. The costs measured are in CHANGELOG.md.
 */
const send = (ws: Socket, message: string): void => void ws.send(message, true);

/**
 * Other sites whose pages may open a socket here, from `ETA_ORIGINS` (comma-separated), each as
 * its origin (`https://app.example.com/` and `https://app.example.com/app` are
 * `https://app.example.com`); by default only the page's own. One that is no origin is reported,
 * and lets nothing in.
 */
const origins = (): string[] | undefined =>
  process.env.ETA_ORIGINS?.split(",").map((o) => o.trim()).filter(Boolean).flatMap((o) => {
    const origin = URL.parse(o)?.origin ?? "null";
    if (origin !== "null") return [origin];
    failed("reading ETA_ORIGINS", new Error(`${JSON.stringify(o)} is not an origin (scheme://host[:port], as https://app.example.com)`));
    return [];
  });

/**
 * What the page's shell is sent with: never framed by another site's page (a click taken there
 * would be the person's here), never sniffed for another type, and saying where it came from to
 * this site alone. No policy of scripts: an applet's are the app's to say.
 */
const SHELL_HEADERS = { "Content-Security-Policy": "frame-ancestors 'self'", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "same-origin" };

/**
 * The cookie that names a session -- a random token, a person's only credential (the session is
 * the row it names: `Example.session`): sent back on every request, never readable by a script,
 * never sent from another site, and lasting the app's `sessionDays` unused (30): every socket sets
 * it again. An example that signs people in sets a fresh one, never the one the visit had before
 * (a fixed session).
 */
export function sessionCookie(cookie: string): string {
  const { name, path, days } = scope().cookie; // the app's own, where a server holds several
  return new Bun.Cookie(name, cookie, { path, httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: days * 86_400 }).serialize();
}

/** This app's session cookie on the request, if it has one: what `sessions.of` turns into a session. */
export const cookieOf = (req: Request): string | undefined => cookieIn(req.headers.get("cookie"), scope().cookie.name);

/** Back to a page after a form, 303, giving the visit its session cookie when one has just started. */
export const seeOther = (to = "/", cookie?: string): Response =>
  new Response(null, { status: 303, headers: { Location: to, ...(cookie ? { "Set-Cookie": sessionCookie(cookie) } : {}) } });

// What each connection was last sent, so the next drawing sends only what differs (src/rendering/parts.ts).
const sent = new WeakMap<Socket, Drawn>();

/**
 * A connection's drawings: the last one asked for, and the one not yet begun, if there is one. Its
 * drawings happen one after another, so a drawing that waited for a document can never land after,
 * and undo, a later one. And one not yet begun gathers every reason to draw the page that comes
 * before it begins -- a change, another, a tab moved -- so a page is drawn at most once for all the
 * changes told meanwhile: it waits a turn of the event loop first, while the changes heard are
 * told, unless its connection waits on it (`drawnFor`).
 */
type Drawings = { last: Promise<void>; next?: { whole: boolean; now: boolean; go?: () => void } };
const drawingsOf = new WeakMap<Socket, Drawings>();

/** A turn of the event loop: what is heard meanwhile is told before the drawings that wait on it begin. */
const aTurn = (next: NonNullable<Drawings["next"]>): Promise<void> | undefined => (next.now ? undefined : new Promise((go) => setImmediate((next.go = go))));

// Everything an event set going -- redraws, and the changes behind them -- so the event is done
// only when all of it is.
const pending = new Set<Promise<unknown>>();
const track = (p: Promise<unknown>): void => {
  pending.add(p);
  void p.finally(() => pending.delete(p));
};

/**
 * Draws a connection's page -- its session's, where its tab stands (./tabs.ts), until every
 * document it reads is held -- and sends what changed:
 * the parts that differ, nothing if none do, or the page whole when its outline changed (a
 * different page) or `whole` says so (a first drawing). Asked again before it begins, it is the same
 * drawing (`Drawings`), whole if either asked so.
 * A drawing that fails is logged and the page told (src/rendering/client/app.ts says so), and the
 * connection's next drawing goes ahead.
 */
function redraw(ws: Socket, whole = false): Promise<void> {
  const app = scope();
  const drawings = drawingsOf.get(ws) ?? drawingsOf.set(ws, { last: Promise.resolve() }).get(ws)!;
  if (drawings.next) {
    drawings.next.whole ||= whole;
    return drawings.last;
  }
  const next: NonNullable<Drawings["next"]> = { whole, now: false };
  drawings.next = next;
  const done = drawings.last
    .then(() => aTurn(next))
    .then(() =>
      within(app, async () => {
        drawings.next = undefined; // begun: what asks from now on is drawn after it
        if (!app.page) return; // the app is no longer served
        const page = app.page;
        const drawn = await settled(app.documents, () => drawing(ws, () => page(ws.data.sessionId, addressOf(ws))));
        const prev = sent.get(ws);
        const ops = prev && !next.whole ? diff(prev, drawn) : undefined;
        sent.set(ws, drawn);
        if (ops === undefined) send(ws, renderMessage(drawn.html));
        else if (ops.length > 0) send(ws, fragmentsMessage(ops));
      }),
    )
    .catch((err) => {
      failed("drawing a page", err);
      send(ws, drawingFailedMessage());
    });
  drawings.last = done;
  track(done);
  return done;
}

/**
 * Resolves once `ws`'s page is drawn after every change heard so far: each told, and the drawing it
 * asked for done, begun at once rather than after a turn. What a connection's event is handled
 * against -- what its page shows, what its fields were drawn with -- is its page as drawn now.
 */
async function drawnFor(ws: Socket, documents: Documents): Promise<void> {
  await documents.toldSoFar();
  const drawings = drawingsOf.get(ws);
  if (drawings?.next) {
    drawings.next.now = true;
    drawings.next.go?.();
  }
  await drawings?.last;
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

// Every document copy is told its changes once, in the scope of the app serving it now (an example
// served again, in a test, is a new app over the same copy).
const heard = new WeakMap<Documents, Scope>();

/**
 * A write with an id, being made: the change it makes to the document it names is "yours" to its
 * writer, echoed to it with the id and the ledger entry that names it. Which change that is, is the
 * one told at the version the write made -- known once delta answers (null: it made none) -- so a
 * change to the same document from elsewhere meanwhile (another process's, over Postgres) is
 * nobody's here.
 */
type Made = { version?: number; entry?: number } | null;
type Claim = { ws: Socket; id: WriteId; doc: string; made: Promise<Made> };
/** The app's writes awaiting their echo (its scope's). */
const claims = () => scope().claims as Set<Claim>;

/** Makes a write for `ws`, claiming its change to `doc` for the write's id, if it has one. */
function claimed<T>(ws: Socket, id: WriteId | undefined, doc: string, writing: Promise<T>, made: (done: T) => Made): Promise<T> {
  if (id === undefined) return writing;
  claims().add({ ws, id, doc, made: Promise.allSettled([writing]).then(([done]) => (done!.status === "fulfilled" ? made(done.value) : null)) }); // a write that throws made no change
  return writing;
}

/**
 * The changes each session's writes made, by the handle its writer was given for each:
 * the echo names a change by a handle of the session's own, never by delta's entry, a serial whose
 * gaps count everyone's writes, in documents this person cannot read too. Undo by change takes a
 * handle and nothing else. Kept while the session has a page open, and HANDLES_KEPT after its last
 * closes, so a reconnect (a network's blip, a reload) undoes as before; the last MOST_HANDLES of them.
 */
/** The app's sessions' handles (its scope's): two apps may each have a session "1". */
const handles = () => scope().handles;
const MOST_HANDLES = 100;
const HANDLES_KEPT = 5 * 60_000;

/** When each session of an app's closed its last page, while its handles are kept. */
const leftBy = new WeakMap<Scope, Map<string, number>>();
const left = () => leftBy.get(scope()) ?? leftBy.set(scope(), new Map()).get(scope())!;

/** Lets go of the handles of every session whose last page closed HANDLES_KEPT ago, or longer. */
function forgetLeft(): void {
  for (const [sessionId, at] of left()) {
    if (Date.now() - at < HANDLES_KEPT) continue;
    left().delete(sessionId);
    handles().delete(sessionId);
  }
}

/** A handle for `entry`, a change `sessionId` made. */
function handleFor(sessionId: string, entry: number): string {
  const mine = handles().get(sessionId) ?? handles().set(sessionId, new Map()).get(sessionId)!;
  const handle = newHandle();
  mine.set(handle, entry);
  if (mine.size > MOST_HANDLES) mine.delete(mine.keys().next().value!);
  return handle;
}

/** The claim a change answers, if any: a write's to that document, at that version, with the entry it made. Taken, so it answers once. */
async function claimOf(doc: string, v: number | undefined): Promise<{ ws: Socket; id: WriteId; entry?: number } | undefined> {
  for (const claim of [...claims()].filter((c) => c.doc === doc)) {
    const made = await claim.made;
    if (!made || made.version !== v || !claims().delete(claim)) continue;
    return { ws: claim.ws, id: claim.id, entry: made.entry };
  }
  return undefined;
}

/**
 * A change to a document -- a write here, an undo, or another process's over Postgres -- is told
 * from here, and only here: its ops echoed to everyone who sees the document, in eta's paths (a
 * resource's `under` taken off), and every page that read it drawn again.
 */
function tellChanges(documents: Documents, serving: Scope): void {
  const told = heard.has(documents);
  heard.set(documents, serving);
  if (told) return;
  documents.onChange(({ doc, ops, v }) => {
    const app = heard.get(documents)!;
    return within(app, () => changed(app, doc, ops, v));
  });
  async function changed(app: Scope, doc: string, ops: unknown[], v: number | undefined) {
    if (app.documents !== documents) return; // a copy of an example no longer served
    const { docType, docId } = splitDoc(doc);
    const owner = app.byDocType?.get(docType);
    if (!owner) return;
    const wire = wireOps(owner, docId, ops as PatchOp[]);
    const yours = await claimOf(doc, v);
    // a tab not yet drawn is told nothing: its first page, drawn after (a route's write before it), holds it
    const echoTo = (await settled(documents, () => audienceFor(docType, docId))).filter((ws) => sent.has(ws));
    const change = yours?.entry === undefined ? undefined : handleFor(yours.ws.data.sessionId, yours.entry);
    for (const ws of echoTo) send(ws, ws === yours?.ws ? patchMessage(wireName(docType, docId, ws), v ?? 0, wire, yours.id, change) : patchMessage(wireName(docType, docId, ws), v ?? 0, wire));
    for (const ws of new Set([...echoTo, ...readersOf(docType, docId)])) void redraw(ws); // a reader has been drawn
    await owner.afterChange?.(docId, wire);
  }
}

type Write = { id?: unknown; doc: string; ops: (PatchOp | Test)[] };

/** Why a write whose `test` fails is refused, beside the field. */
export const CHANGED_SINCE = "This was changed elsewhere as you typed: here it is now.";

/** The most ops a write may carry, its tests among them: a page's control sends a handful. */
export const MOST_OPS = 1000;

/** Why a write of more is refused. */
export const TOO_MANY_OPS = `That is too much to change at once: at most ${MOST_OPS} changes a write.`;

/**
 * The most events a connection may have waiting to be handled: past it, it is sending faster than
 * it is answered, and its socket is closed (1008), as one that will not be held up for everyone
 * else's sake; its page connects again, and is drawn afresh.
 */
export const MOST_WAITING = 100;

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

/** Each example's app while it is served, and by how many servers. */
const scopes = new WeakMap<Example, { app: Scope; apps: number }>();

/** An app as a server takes it: its routes and its socket's handlers (delta's `App`), with its scope, and `idle` for its tests. */
export type DzqlApp = App & { websocket: Bun.WebSocketHandler<ConnectionData>; scope: Scope; idle(): Promise<void>; close: (() => void | Promise<void>)[] };

/**
 * An example as routes and resources, never a server of its own: its page at `Example.at` (the
 * root, unless it says a path), every screen under it, its routes, and its socket at `<at>/ws`, all
 * in a scope of its own. `compose` puts several on one server; delta's `serve` serves them. Its
 * store is opened first (`Example.store`, one that opens: Postgres's), on the data folder it is given (`dataDir`: none, in memory),
 * and closed once the server stops, after what the app drew: a store is open only while a server holds it.
 */
export async function appOf(example: Example, { dataDir }: { dataDir?: string } = {}): Promise<DzqlApp> {
  await example.store?.open?.({ dataDir });
  // one example served twice (a test's two servers) is one app: one scope, its sockets all told
  const held = scopes.get(example) ?? scopes.set(example, { app: served(example.at ?? ""), apps: 0 }).get(example)!;
  held.apps++;
  const { app } = held;
  app.cookie.days = example.sessionDays ?? 30;
  const at = example.at ?? "";
  const assembled = within(app, () => assemble(example));
  const { resources, byDocType, inspectFor, documents } = assembled;
  within(app, () => {
    setActiveResources(byDocType, { cookieIsSession: example.session === undefined });
    setActiveDocuments(documents);
  });
  app.page = assembled.page;
  app.moved = (ws) => void (sent.has(ws) && redraw(ws)); // a tab not yet drawn is drawn where it stands when it is
  tellChanges(documents, app);

  const who = (ws: Socket): unknown => (example.who ? example.who(ws.data.sessionId) : ws.data.sessionId);

  // Each connection's events are handled one at a time, in the order they came, each on its page as
  // drawn after every event before it (`drawnFor`); another connection's go on meanwhile, so none
  // waits behind a busy one. An `inspect` is answered after every event that came before it, any
  // connection's, and everything they set going. At most MOST_WAITING wait for a connection: past
  // that, it is closed.
  const queues = new Map<Socket, { tail: Promise<void>; waiting: number }>();
  const enqueue = (ws: Socket, fn: () => Promise<void>, { closing = false } = {}): void => {
    const queue = queues.get(ws) ?? queues.set(ws, { tail: Promise.resolve(), waiting: 0 }).get(ws)!;
    if (!closing && queue.waiting >= MOST_WAITING) return void ws.close(1008, "too many messages waiting");
    queue.waiting++;
    queue.tail = queue.tail
      .then(fn)
      .catch((err) => failed("handling an event", err))
      .finally(() => void queue.waiting--);
  };
  /** Every event that came before now, on every connection but `ws`, handled. */
  const before = (ws?: Socket): Promise<unknown> => Promise.all([...queues].filter(([other]) => other !== ws).map(([, q]) => q.tail));

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

  /**
   * A permitted write from the wire: shaped, written through delta as the person. What it says of
   * where the tab goes (`Example.address`) is the tab's: taken off the write, it moves the tab that
   * sent it, and the rest is written.
   */
  async function writeDelta(ws: Socket, owner: (typeof resources)[number], docId: string, ops: PatchOp[], id?: WriteId): Promise<boolean> {
    const shaped = owner.shape ? await settled(documents, () => owner.shape!(ws, docId, ops)) : ops;
    if (shaped.length === 0) return false;
    const going = owner.docType === example.address?.doc ? shaped.filter((op) => op.path === example.address!.path) : [];
    if (going.length > 0) ws.data.address = String(going.at(-1)!.value ?? "");
    const rest = shaped.filter((op) => !going.includes(op));
    if (rest.length === 0) return movedOnly(ws, owner, docId, id);
    const said = owner.undoable; // false: never undone; or asked of this write
    const undoable = typeof said === "function" ? await settled(documents, () => said(ws, docId, rest)) : said !== false;
    const at = owner.under ?? "";
    const doc = `${owner.docType}:${docId}`;
    const writing = documents.write(doc, rest.map((op) => ({ ...op, path: at + op.path })) as never, { identity: who(ws), cursor: ws.data.sessionId, undoable });
    // a write never undone: its echo names no change
    const written = await claimed(ws, id, doc, writing, (w) => ("error" in w || w.ops.length === 0 ? null : { version: w.version, entry: undoable ? w.entry : undefined }));
    // a store's own refusal (4xx) says why, as a resource's does: the model's guards or a document's
    // permission (403), or nobody the guards know (401), in the store's words, the app's own; any
    // other (a value the schema does not take, 400; a row not there; a clash) in the resource's
    // (`refused`), else delta's; the store itself failing (5xx) is reported, never silent
    if ("error" in written && written.error.code >= 400 && written.error.code < 500) {
      const guarded = written.error.code === 403 || written.error.code === 401;
      throw refuse(guarded ? written.error.message : (owner.refused ?? written.error.message));
    }
    const named = owner.perSession ? owner.docType : doc; // a session's own named by type: its id is a credential
    if ("error" in written && written.error.code >= 500) failed(`writing ${named}`, new Error(`${written.error.code}: ${written.error.message}`));
    if ("error" in written || written.ops.length === 0) return false;
    if ((written.entry === undefined) !== (owner.ledger === false)) {
      const why = owner.ledger === false ? "its resource keeps it off the ledger (ledger: false), yet delta recorded the write" : "delta recorded no ledger entry: register it with { ledger: true }, or say its resource keeps it off the ledger (ledger: false)";
      failed(`writing ${named}`, new Error(why));
    }
    await landed(ws, () => owner.afterWrite?.(ws, docId, ops, wireOps(owner, docId, written.ops as PatchOp[])), `following a write to ${named}`);
    if (going.length > 0) app.moved!(ws); // its page read the document, or not: it is drawn where it went
    return true;
  }

  /**
   * A write that moved its tab and wrote nothing: it landed, so its writer is answered by an echo of
   * nothing (by its id, if it has one) and what they were told before goes; no document changed, so
   * no `afterWrite` follows, and the tab is drawn where it now stands -- once it has been drawn at all.
   */
  async function movedOnly(ws: Socket, owner: (typeof resources)[number], docId: string, id?: WriteId): Promise<true> {
    // its version as held, loaded first: a resource that keeps no document (a session with no row) is at none
    if (id !== undefined) send(ws, patchMessage(wireName(owner.docType, docId, ws), (await settled(documents, () => documents.version(`${owner.docType}:${docId}`))) ?? 0, [], id));
    await tell(ws.data.sessionId);
    app.moved!(ws);
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
    const change = handle === undefined ? undefined : handles().get(ws.data.sessionId)?.get(handle);
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
    if (all.length > MOST_OPS) throw refuse(TOO_MANY_OPS);
    const ops = all.filter((op): op is PatchOp => !isTest(op));
    const target = await settled(documents, () => resolveName(byDocType, doc, ws));
    if (!target || !(await settled(documents, () => sees(target.owner, ws, target.docId)))) return false;
    const { owner, docId } = target;
    if (owner.kind !== undefined) return false; // stored documents alone are written from the wire
    if (!(await settled(documents, () => ops.every((op) => owner.permit?.(ws, op, docId) ?? false)))) return false;
    // A field typed in says what it was drawn with as the typing began: drawn otherwise on
    // this page now, someone changed it since, unseen, and the typing would write over it.
    const tests = all.filter(isTest);
    const fields = tests.length > 0 ? drawnFields(sent.get(ws)?.html ?? "", doc) : undefined; // the page read once
    if (tests.some((t) => !(fields!.get(t.path) ?? []).includes(t.value))) throw refuse(CHANGED_SINCE);
    return owner.docType === "ledger" ? walk(ws, ops, id) : writeDelta(ws, owner, docId, ops, id);
  }

  /**
   * The route: a tab opened at an address is put there before its page is drawn, through the
   * example's own write of it (`Example.address`), permitted and shaped as any, which moves this tab
   * alone. Refused, the tab stays at the page alone, and the page drawn says so (the client puts it
   * in the URL).
   */
  async function route(ws: Socket): Promise<void> {
    if (ws.data.at === undefined || !example.address) return;
    const { doc, path } = example.address;
    try {
      await write(ws, { doc, ops: [{ op: "replace", path, value: ws.data.at }] }, undefined);
    } catch (err) {
      if (!(err instanceof Refusal)) throw err;
    }
  }

  async function handle(ws: Socket, message: unknown): Promise<void> {
    if (isInspect(message)) {
      send(ws, JSON.stringify({ type: "inspect", ...(await inspectFor(ws, inspected(message.limit))) }));
      return;
    }
    // A write that applied something is told from its change, its echo carrying its id. Nothing
    // applied is answered `refused` (by its id, if it has one, and why when the refusal says, kept
    // for the page until the session's next write: src/rendering/refusal.ts), then the page as what differs.
    // A message that is no write at all asks for the page whole.
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
      void redraw(ws, !asWrite); // a message that is no write asks for the page (src/rendering/client/app.ts)
    }
    await documents.toldSoFar();
    for (const claim of claims()) if (claim.ws === ws) claims().delete(claim); // its change told by now, or never to be
  }

  /** Lets go of the documents no open page reads any more. */
  async function release(): Promise<void> {
    const keep = new Set<string>();
    for (const ws of allOpenSockets()) for (const doc of shownTo(ws)) keep.add(doc);
    await documents.release(keep);
  }

  // The page's shell, sent with the headers a page needs (SHELL_HEADERS). Bun serves an HTML bundle
  // itself, headers and all, so the bundle is served at a path of its own that nobody else knows,
  // and fetched from there by the routes that answer with the shell: fetched once in production,
  // where the bundle is fixed; each time in development, where it is built again as it changes.
  const hidden = `${at}/__shell/${crypto.randomUUID()}`;
  const fetchShell = async (server: Bun.Server<ConnectionData>) => {
    const res = await fetch(new URL(hidden, server.url));
    return { type: res.headers.get("content-type") ?? "text/html;charset=utf-8", body: await res.arrayBuffer() };
  };
  let fixed: Awaited<ReturnType<typeof fetchShell>> | undefined; // kept once fetched, in production
  const shell = async (req: Request, server: Bun.Server<ConnectionData>): Promise<Response> => {
    const { type, body } = fixed ?? (await fetchShell(server));
    if (process.env.NODE_ENV === "production") fixed = { type, body };
    // a path that is none of the app's screens (`Example.screens`) is 404: the page alone, all the same
    const path = new URL(req.url).pathname.slice(at.length).replace(/^\//, "");
    const status = path === "" || !example.screens || example.screens(path) ? 200 : 404;
    return new Response(body, { status, headers: { "Content-Type": type, "Cache-Control": "no-cache", ...SHELL_HEADERS } });
  };

  // Every route the app's, in its scope; under its path, when it has one
  const inScope = (route: unknown): unknown => (typeof route === "function" ? (...args: unknown[]) => within(app, () => (route as (...a: unknown[]) => unknown)(...args)) : route);
  const own: Record<string, unknown> = {
    ...example.routes,
    "/": shell,
    // A tab's address is its URL (`Example.address`): any path that is no route above is a
    // screen, served the same shell, whose socket names the address (`/ws?at=`), and the tab is
    // routed there as it opens: its first page is drawn there, for it alone.
    "/*": shell,
    "/api/health": () => Response.json({ ok: true }),
    "/ws": async (req: Bun.BunRequest, server: Bun.Server<ConnectionData>) => {
        // A socket is not bound by the same-origin policy: one opened from another site is refused
        // before it is a session (delta's rule: no Origin, or the page's own, or ETA_ORIGINS).
        const refused = refuseOrigin(req, origins());
        if (refused) return refused;
        // Then who it is, where the example can say before it opens (a proxy's header, a token).
        const identified = await example.identify?.(req);
        if (identified instanceof Response) return identified;
        // the first of its name: the cookie of the app under the longest path, as a browser sends them
        const cookie = cookieIn(req.headers.get("cookie"), app.cookie.name); // this app's, by name (cookieOf reads the scope's)
        const token = identified ?? cookie ?? crypto.randomUUID();
        const sessionId = example.session ? await example.session(token) : token;
        const headers = new Headers();
        headers.append("Set-Cookie", sessionCookie(token)); // a new one, or the one sent: renewed as it is used

        const at = new URL(req.url).searchParams.get("at") ?? undefined; // the screen the tab's URL names
        if (server.upgrade(req, { data: { sessionId, ...(at !== undefined && { at }), on: handlers }, headers })) return;
        return new Response("Upgrade failed", { status: 400 });
    },
  };
  const routes = Object.fromEntries(Object.entries(own).map(([path, route]) => [path === "/" ? at || "/" : `${at}${path}`, inScope(route)]));
  if (at) routes[`${at}/`] = routes[at]; // the page, with or without its last slash
  routes[hidden] = example.index; // the bundle itself, fetched by `shell`

  // The app's socket: what it opens, says and closes, in its scope
  const handlers: Bun.WebSocketHandler<ConnectionData> = {
      open: (ws) => within(app, () => {
        openConnection(ws);
        forgetLeft();
        left().delete(ws.data.sessionId); // back: its handles are its own again
        enqueue(ws, async () => {
          try {
            for (const resource of resources) await resource.onOpen?.(ws);
            await route(ws);
          } finally {
            void redraw(ws, true); // the page is drawn, whatever failed opening it
            await drawnFor(ws, documents);
          }
        });
      }),
      message: (ws, raw) => within(app, () => {
        let message: unknown;
        try {
          message = JSON.parse(String(raw));
        } catch {
          message = undefined; // not JSON: no write, so the page is handed back
        }
        // an inspect is answered after every event before it, any connection's, and all they set going
        const others = isInspect(message) ? before(ws) : undefined;
        enqueue(ws, async () => {
          if (others) await others.then(() => quiet(documents));
          await drawnFor(ws, documents);
          await handle(ws, message);
        });
      }),
      close: (ws) => within(app, () => {
        closeConnection(ws);
        if (![...allOpenSockets()].some((open) => open.data.sessionId === ws.data.sessionId)) left().set(ws.data.sessionId, Date.now()); // its handles kept a while yet
        forgetLeft();
        enqueue(
          ws,
          async () => {
            for (const resource of resources) await resource.onClose?.(ws);
            await quiet(documents);
            await release();
            queues.delete(ws);
          },
          { closing: true },
        );
      }),
  };

  return {
    routes: routes as App["routes"],
    websocket: { ...SOCKET, ...handlers },
    scope: app,
    /** Resolves when every event so far has been handled and everything it set going is done. */
    idle: async () => {
      do {
        await before();
        await quiet(documents);
      } while ([...queues.values()].some((q) => q.waiting > 0));
    },
    // no longer served: what it draws and who sees what go with it
    close: [() => {
      if (--held.apps > 0) return;
      scopes.delete(example);
      within(app, () => {
        // sockets on handlers no longer served (a `bun --hot` reload) reconnect to the new ones
        for (const ws of app.openSockets) ws.close(1012, "restarting");
        app.page = undefined;
        setActiveResources(undefined);
        setActiveDocuments(undefined);
      });
      unserved(app);
      forget(example); // the next server of it holds its documents afresh, from the store it opens
    }, async () => {
      await example.store?.close?.();
    }],
  };
}

/** How every app's socket is held: compressed, each message on its own (as `send` says), and small. */
const SOCKET = {
  perMessageDeflate: true, // "shared", both ways: a message compressed on its own, as `send` says
  // A message in is at most 1 MiB, inflated: a write is small (a picture goes by HTTP), and past
  // it the socket is closed. Bun's own 16 MB would let a 15 KB compressed frame be a 15 MB write.
  maxPayloadLength: 1 << 20,
  // A page that reads slower than it is sent to is closed once 1 MiB waits for it, past what the
  // system holds: its page connects again, and is drawn afresh. Bun's own is to drop what is sent
  // past 16 MB and keep the socket open, its page wrong for good, never told it missed anything.
  backpressureLimit: 1 << 20,
  closeOnBackpressureLimit: true,
} as const;

/**
 * Apps on one server: their routes together (a later app's route of the same path wins), and one
 * socket handler that gives each socket to the app it was opened on. Any of delta's apps composes
 * too -- routes of its own, or delta's socket (`createWs`, its actions registered with `on`).
 */
export function compose(...apps: (App | false | undefined)[]): App & { close: (() => void | Promise<void>)[] } {
  const all = apps.filter((a): a is App => !!a);
  // two apps never answer one path: mount one of them elsewhere (`at`)
  const taken = all.flatMap((a) => Object.keys(a.routes ?? {}));
  const clash = taken.find((path, i) => taken.indexOf(path) !== i);
  if (clash) throw new Error(`two apps serve ${clash}: mount one at its own path (Example.at)`);
  const ws = all.find((a) => a.ws)?.ws;
  // a socket an app opened goes to that app; any other is delta's (its actions, its pub/sub)
  const dispatch = (name: "open" | "message" | "close") => (socket: Bun.ServerWebSocket<any>, ...rest: unknown[]) => {
    const on = (socket.data as ConnectionData | undefined)?.on ?? (ws!.websocket as Bun.WebSocketHandler<any>);
    return (on[name] as (...a: unknown[]) => unknown)(socket, ...rest);
  };
  return {
    routes: Object.assign({}, ...all.map((a) => a.routes)),
    ...(ws && { ws }),
    websocket: { ...SOCKET, open: dispatch("open"), message: dispatch("message"), close: dispatch("close") } as Bun.WebSocketHandler<any>,
    close: all.flatMap((a) => a.close ?? []),
  };
}

/** One example served on its own: `serve(await appOf(example))`, its server told how to wait for it and stop it (then what the app opened is closed). */
export async function createServer(example: Example, port: number | string = process.env.PORT ?? 3000) {
  const app = await appOf(example);
  const { server } = serve<string>(app as never, { port: Number(port) });
  const stop = server.stop.bind(server);
  let stopped = false;
  server.stop = (async (...args: Parameters<typeof server.stop>) => {
    const [drawn, ...opened] = stopped ? [] : app.close;
    stopped = true;
    await drawn?.(); // its pages first, their sockets closed, so a stop that waits for them ends
    await stop(...args);
    for (const close of opened) await close(); // then its store
  }) as typeof server.stop;
  return Object.assign(server as Bun.Server<ConnectionData>, { idle: app.idle });
}
