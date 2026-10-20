/**
 * Delta SQLite — relational backend for delta-doc.
 *
 * Backs delta-doc documents with SQLite temporal tables. The schema describes
 * tables and relationships once; doc definitions are lenses (views) into that
 * schema with optional scope filters.
 *
 * Usage:
 *   import { defineSchema, defineDoc, createTables, registerDocs } from "@blueshed/delta/sqlite";
 *
 *   const schema = defineSchema({ ... });
 *   const itineraryDoc = defineDoc("itinerary:", { root: "itineraries", include: [...] });
 *   createTables(db, schema);
 *   registerDocs(ws, db, schema, [itineraryDoc]);
 *
 * Client API is unchanged — openDoc("itinerary:abc") works identically whether
 * the backend is a JSON file or SQLite.
 *
 * `registerDocs` wires the handlers (open, delta, open_at, close) over one
 * `Registration`; the write path is `sqlite/write.ts`, the ledger's walks
 * (undo, redo, history) `sqlite/walk.ts`.
 */
import type { WsServer } from "./server";
import { trackSubscribe, trackUnsubscribe, onClientDrop, failure } from "./server";
import { authless, isAuthError, ownerless, type DeltaAuth } from "./auth";
import { assertOnePrefix, assertOwned, createCustomDocs, isPromise, NOT_FOUND, type CustomDoc } from "./custom";
import { type DeltaOp, splitPath } from "../core";
import { createLogger } from "./logger";
import { createLedger, ledgerWho, socketCursor } from "./ledger";
import { assertScopeKeys, resolveScope, rowId, whereOf } from "./scope";
import { defaultForType, q, showDoc, showOps, type DocDef, type Schema } from "../schema";
import { waitForLocks } from "./sqlite/ddl";
import { keeping } from "./sqlite/keep";
import { loadDocAt, readDoc } from "./sqlite/read";
import { named } from "./sqlite/rows";
import { assertPath, parsePath, pathSql, startOf } from "../paths";
import { createWriter, type Registration, type Written } from "./sqlite/write";
import { registerWalks } from "./sqlite/walk";

export type {
  ColumnType,
  ColumnDef,
  ColumnShorthand,
  TableDef,
  UniqueDef,
  Schema,
  ResolvedTable,
  DocDef,
  ValidationError,
  Snapshot,
} from "../schema";
export { defineSchema, defineDoc } from "../schema";
export { createTables, migrateSchema } from "./sqlite/ddl";
export { migrate, migrationStatus, renameColumn, dropColumn, renameTable, fromFolder } from "./sqlite/migrate";
export type { Migration, MigrateOptions, MigrateResult, MigrationStatus, MigrationTools } from "./sqlite/migrate";
export { validateOps } from "./sqlite/validate";
export { loadDocAt } from "./sqlite/read";
export { exportTables, importTables } from "./sqlite/carry";
export { inverseOf } from "./sqlite/write";

// ---------------------------------------------------------------------------
// Custom doc definition — predicate-based membership over watched collections.
// ---------------------------------------------------------------------------

/**
 * A custom doc on SQLite (`./custom`): its reads take the `bun:sqlite` handle
 * and answer at once, no await. A membership `query` runs once per doc name
 * and identity (the gate's, with `auth`; undefined without), and its result is
 * kept for the subscribers of that name who are that identity -- never
 * another's. SQLite has no RLS: check the rows against the
 * identity here. A `recompute` reads the WHOLE doc, on open and on any write
 * to a watched collection, and sends it to each subscriber as a root-replace
 * op -- for nested, joined or aggregated reads a per-row `matches` can't
 * express: read per subscriber, as that client's identity, never cached.
 */
export interface CustomDocDef<C = unknown, I = any> extends CustomDoc<C, I> {
  query?: (db: any, criteria: C, identity?: I) => Record<string, any[]>;
  recompute?: (db: any, criteria: C, identity?: I) => any;
}

export function defineCustomDoc<C, I = any>(prefix: string, opts: Omit<CustomDocDef<C, I>, "prefix">): CustomDocDef<C, I> {
  return { prefix, ...opts };
}

// ---------------------------------------------------------------------------
// registerDocs
// ---------------------------------------------------------------------------

const log = createLogger("[delta-sqlite]");

/**
 * The prefixes each `registerDocs` on a server answers, by registration. A
 * name is answered by the registration whose prefix matching it is longest --
 * as within one registration, and -- whichever registered
 * first: `fo-board` (a public registration) never answers `fo-board:1` beside
 * a registration of `fo-board:`. A prefix two registrations both claim would
 * leave the name to the order they registered in, so the second is refused.
 */
const registrations = new WeakMap<object, Map<symbol, string[]>>();


/**
 * Claim `prefixes` on `ws` for one registration (refused if one comes twice, or
 * another registration holds one of them), and answer whether a document of
 * prefix length `mine` answers a name: whether no prefix on the server matching
 * it is longer -- another registration's, or this one's other kind (a custom
 * document's or a table document's).
 */
function claim(ws: object, prefixes: string[]): (docName: string, mine: number) => boolean {
  assertOnePrefix(prefixes);
  const registration = Symbol("registerDocs");
  const onServer = registrations.get(ws) ?? new Map<symbol, string[]>();
  for (const theirs of onServer.values()) {
    const both = prefixes.find((p) => theirs.includes(p));
    if (both !== undefined) throw new Error(`registerDocs: "${both}" is registered already on this server -- a name is answered by one registration: give each its own prefix`);
  }
  onServer.set(registration, prefixes);
  registrations.set(ws, onServer);
  return (docName, mine) => {
    for (const theirs of onServer.values()) if (theirs.some((p) => p.length > mine && docName.startsWith(p))) return false;
    return true;
  };
}

export interface RegisterOptions<I = unknown> {
  /**
   * Keep a ledger (`./ledger`): every write recorded with its inverse, its
   * version, who made it and the cursor undo walks; and `undo`, `redo` and
   * `history` actions over it.
   */
  ledger?: boolean;
  /** How an identity is written in the ledger. Default: a string or number as it is, anything else as JSON. */
  who?: (identity: I) => string;
  /** Called after every change that committed -- a write, an undo or redo, a walk recorded as skipped: the JSON file saves itself from it. */
  committed?: () => void;
  /**
   * An auth module (`DeltaAuth`): every
   * open, delta, open_at, history, undo, redo and close of these documents
   * passes `auth.gate(client)` first (401 without an identity), and the
   * identity it gives is who writes (the ledger's `who`, the cursor) and who a
   * custom document is read as. SQLite has no RLS: `owns` is the check.
   */
  auth?: DeltaAuth<I>;
  /**
   * With `auth`: may `identity` open `docName`, write through it and hear what
   * is written to it? False answers 404 -- asked before open, delta, open_at,
   * history, and an undo or redo of an entry written through the document, as
   * `docTypeFromDef`'s `owns`. With auth, this or `shared` is required.
   */
  owns?: (identity: I, docName: string) => boolean | Promise<boolean>;
  /** With `auth`: every identity that passes the gate may open every document registered here, and hear every write to it. */
  shared?: boolean;
}

/** Register all doc definitions with the WebSocket server. */
export function registerDocs<I = unknown>(
  ws: WsServer,
  db: any,
  schema: Schema,
  docs: DocDef[],
  customDocs: CustomDocDef<any, I>[] = [],
  options: RegisterOptions<I> = {},
) {
  for (const doc of docs) {
    assertScopeKeys(doc, schema);
    if (doc.owns !== undefined) assertPath(doc as DocDef & { owns: string }, schema);
  }
  // Default-deny, as docTypeFromDef and createDocListener are: with auth, every
  // document says who owns it, or that it is shared. A name is the channel its
  // writes are told on, so whoever has it open hears them.
  const auth = options.auth;
  if (auth) {
    const unsaid = docs.filter((d) => d.owns === undefined);   // a path says it
    if (unsaid.length && !options.owns && !options.shared) throw ownerless(unsaid.map((d) => d.prefix).join(", "), "registerDocs");
  } else if (options.owns || options.shared || docs.some((d) => d.owns !== undefined)) {
    // and owns or shared with no auth module would guard nothing: every socket opens every document
    throw authless(docs.map((d) => d.prefix).join(", "), "registerDocs");
  }
  assertOwned(customDocs, auth);
  // One name, one registration on this server: the longest prefix answers it.
  const answers = claim(ws, [...docs.map((d) => d.prefix), ...customDocs.map((d) => d.prefix)]);
  /** The gate's identity (with `auth`), or its refusal. */
  const gated = (client: any): { identity: I } | { error: { code: number; message: string } } => {
    const g = auth!.gate(client);
    return isAuthError(g) ? { error: { code: 401, message: g.error } } : { identity: g };
  };
  /** Who is writing: with `auth` the gate's identity, else the one the client carries --. */
  const writerOf = (client: any): I | undefined => {
    if (!auth) return client?.data?.identity as I | undefined;
    const g = gated(client);
    return "identity" in g ? g.identity : undefined;
  };
  waitForLocks(db);
  const ledger = options.ledger ? createLedger(db) : undefined;
  const whoOf = (client: any): string | null => ledgerWho(writerOf(client), options.who);
  // The cursor undo walks: named by a caller in this process (`createLocal`),
  // and over the socket the connection itself -- signed in, the person and the
  // connection together, so another person holding the same connection id
  // (a client may choose it, to keep its cursor across a reconnect) cannot walk it.
  const cursorOf = (msg: any, client: any): string | null =>
    client?.data?.local ? (typeof msg.cursor === "string" ? msg.cursor : null) : socketCursor(whoOf(client), client);
  // Build lookup: prefix → DocDef
  const docByPrefix = new Map<string, DocDef>();
  // A scope reads the document's name by the same rule as on Postgres (./scope).
  for (const doc of docs) docByPrefix.set(doc.prefix, doc);

  // The custom documents (./custom): who holds each, who may hear it, what a write tells it.
  const custom = createCustomDocs<I, any>({ defs: customDocs, handle: db, auth, publish: (channel, data) => ws.publish(channel, data), log, answers });

  // In-memory doc cache: docName → loaded doc object
  const cache = new Map<string, any>();

  // Several processes on one file: a copy read before another
  // connection committed is stale, and a write merged over one would put back
  // what the other wrote. `PRAGMA data_version` moves when another connection
  // commits (never for this one's own writes), so before a copy is served or
  // written from, every copy is dropped when it has moved, and read again from
  // the tables. A document open here is not told of another process's write:
  // it reads it when it is next opened, or written through. (Another
  // registration on this handle tells this one: `fanoutsOn`.)
  const dataVersion = db.query("PRAGMA data_version");
  let seenVersion = (dataVersion.get() as { data_version: number }).data_version;
  function heardElsewhere(): boolean {
    const now = (dataVersion.get() as { data_version: number }).data_version;
    if (now === seenVersion) return false;
    seenVersion = now;
    cache.clear();
    implied.clear();
    custom.forget();
    return true;
  }

  /**
   * A handler run under the write lock (BEGIN IMMEDIATE), so what it reads is
   * what it writes over: no other process commits between (an undo's plan and
   * its walk). Inside a caller's own transaction, it runs in that.
   */
  const underLock = (handler: (msg: any, client: any, respond: (r: any) => void) => void) =>
    (msg: any, client: any, respond: (r: any) => void) => db.transaction(() => handler(msg, client, respond)).immediate();

  /** Who a client is, to a custom document: the gate's identity with `auth`, else undefined --. */
  const identityOf = (client: any): I | undefined => (auth ? writerOf(client) : undefined);

  /** An answer that may come later: `go` once `ok` says yes (awaited when it is a promise), else 404 -- not there for this identity. */
  const whenOwned = (ok: boolean | Promise<boolean>, respond: (r: any) => void, go: () => void): void | Promise<void> => {
    const no = () => respond({ error: NOT_FOUND });
    if (!isPromise(ok)) return ok ? go() : no();
    return ok.then((yes) => (yes ? go() : no()), (err: any) => respond({ error: failure(err) }));
  };

  /**
   * With `auth`, a handler for one of these documents asks the gate first
   * (401 without an identity) and then the document's `owns` (404 when it says
   * no; a shared one has none). `owned:
   * false` for close: letting go never needs the owner's say. `gatesCustom: false`
   * where a custom document answers without the gate (a write: 403; a close).
   */
  const guarded = (handler: (msg: any, client: any, respond: (r: any) => void) => any, { owned = true, gatesCustom = true } = {}) =>
    (msg: any, client: any, respond: (r: any) => void) => {
      if (!auth) return handler(msg, client, respond);
      const docName = msg.doc as string;
      const mine = custom.find(docName);
      if (mine ? !gatesCustom : !findDoc(docName)) return handler(msg, client, respond);   // not gated here, or another backend's
      const g = gated(client);
      if ("error" in g) return respond(g);
      const owns = mine ? mine.def.owns : ownsOf(docName);
      if (!owned || !owns) return handler(msg, client, respond);
      return whenOwned(owns(g.identity, docName), respond, () => handler(msg, client, respond));
    };

  /**
   * Does `def`'s path reach `identity` from `docName`'s row, as the tables hold it now? A path
   * from the row's columns reads the row; one from the name's values reads them; a name that gives
   * no row reaches nobody (but TRUE and AUTHENTICATED).
   */
  function reaches(def: DocDef & { owns: string }, docName: string, identity: I): boolean {
    const parsed = parsePath(def.owns);
    if ("literal" in parsed) return parsed.literal !== "FALSE";   // past the gate: someone is signed in
    const scope = resolveScope(def, docName.slice(def.prefix.length));
    const root = schema.tables[def.root]!;
    const params: Record<string, unknown> = { $person: auth!.asSqlArg ? auth!.asSqlArg(identity) : (identity as any)?.id, $now: new Date().toISOString() };
    let none = false;
    const key = (v: string) => (/^-?\d+$/.test(v) ? Number(v) : v);
    const start = (field: string) => {
      const s = startOf(def, scope, field);
      const name = `$s${Object.keys(params).length}`;
      if (!s) return (none = true), "NULL";
      if ("value" in s) return (params[name] = key(s.value)), name;
      params[name] = rowId(s.id);
      return `(SELECT ${q(s.column)} FROM ${q(root.name)} WHERE id = ${name}${root.temporal ? " AND valid_to IS NULL" : ""})`;
    };
    const sql = pathSql(parsed, schema, { start, person: "$person", now: "$now" });
    if (none || params.$person == null) return false;
    return !!db.query(`SELECT CASE WHEN ${sql} THEN 1 ELSE 0 END AS ok`).get(params as any)?.ok;
  }
  /** After a write: its path still reaches the writer, or its root row is gone (a removal hands nothing away). */
  function keepsReach(def: DocDef, docName: string, identity: I): boolean {
    const scope = resolveScope(def, docName.slice(def.prefix.length));
    const root = schema.tables[def.root]!;
    if (scope.mode === "single" && !db.query(`SELECT 1 FROM ${q(root.name)} WHERE id = ?${root.temporal ? " AND valid_to IS NULL" : ""}`).get(rowId(scope.id!) as any)) return true;
    return reaches(def as DocDef & { owns: string }, docName, identity);
  }
  /** Who may open `docName`: its path, else the registration's `owns`. */
  const ownsOf = (docName: string): ((identity: I, docName: string) => boolean | Promise<boolean>) | undefined => {
    const def = findDoc(docName)?.def;
    return def?.owns !== undefined ? (identity, name) => reaches(def as DocDef & { owns: string }, name, identity) : options.owns;
  };

  // Open implied docs whose root row has not been written yet.
  const implied = new Set<string>();

  function emptyDoc(def: DocDef, docId: string): any {
    const rootTable = schema.tables[def.root]!;
    const root: any = { id: rowId(docId) };
    for (const [col, colDef] of Object.entries(rootTable.columns)) {
      root[col] = colDef.default ?? (colDef.nullable ? null : defaultForType(colDef.type));
    }
    const doc: any = { [def.root]: root };
    for (const coll of def.include) doc[coll] = {};
    return doc;
  }

  /** A single document whose root row is not there: the root absent, each included collection empty. */
  const rootless = (def: DocDef, docId: string): any => ({ ...emptyDoc(def, docId), [def.root]: null });


  // Who has each of these documents open, by name (for scoped fan-out)
  const subscriptions = new Map<string, Set<any>>();

  const r: Registration<I> = {
    ws, db, schema, options, auth, ledger, custom, cache, implied, subscriptions,
    findDoc, load, emptyDoc, rootless, heardElsewhere, reloadEvicted, keepsReach, ownsOf, unheld,
    gated, whoOf, cursorOf, identityOf, whenOwned, guarded, underLock,
  };
  const writer = createWriter(r);
  const { write } = writer;

  /** The definition a name belongs to: the longest prefix it starts with. */
  function findDoc(docName: string): { def: DocDef; docId: string } | null {
    let found: DocDef | undefined;
    for (const [prefix, def] of docByPrefix) {
      if (docName.startsWith(prefix) && (!found || prefix.length > found.prefix.length)) found = def;
    }
    // another registration on this server with a longer prefix answers it
    return found && answers(docName, found.prefix.length) ? { def: found, docId: docName.slice(found.prefix.length) } : null;
  }

  // Transport-level teardown (socket drop / logout via dropClientSubscriptions):
  // a dropped socket never sends the polite `close` action, so without this
  // every abandoned doc stayed cached forever and its dead socket sat in
  // `subscriptions`, growing the fan-out set monotonically (v0.5.0 review #7).
  // Mirrors the `close`-action eviction below.
  function releaseClient(client: any): void {
    custom.leave(client);
    for (const [docName, subs] of subscriptions) if (subs.delete(client)) unheld(docName);
  }

  /** A document nobody has open now: its copy is dropped. */
  function unheld(docName: string): void {
    if (subscriptions.get(docName)?.size) return;
    subscriptions.delete(docName);
    cache.delete(docName);
    implied.delete(docName);
  }


  // ---------------------------------------------------------------------------
  // WebSocket handlers
  // ---------------------------------------------------------------------------

  ws.on("open", guarded((msg, client, respond) => {
    const docName = msg.doc as string;
    if (custom.find(docName) || findDoc(docName)) heardElsewhere();

    // Custom doc path first (independent prefix space).
    const customMatch = custom.find(docName);
    if (customMatch) {
      let doc: any;
      try { doc = custom.open(client, docName, customMatch, identityOf(client)); }
      catch (err: any) { log.error(`open custom ${docName} failed: ${err.message}`); return respond({ error: failure(err) }); }
      if (doc == null) return respond({ error: NOT_FOUND });
      trackSubscribe(client, docName);
      onClientDrop(client, releaseClient);
      respond({ result: doc });
      log.info(`opened ${docName} (custom${customMatch.def.recompute ? ", recompute" : ""})`);
      return;
    }

    const match = findDoc(docName);
    if (!match) return;

    let doc: any;
    try { doc = load(docName, match.def, match.docId); }
    catch (err: any) { return respond({ error: failure(named(err)) }); }
    if (!doc) {
      respond({ error: { code: 404, message: `Not found: no ${match.def.root} row ${match.docId}. Make the row first, or declare the document implied: true` } });
      return;
    }

    trackSubscribe(client, docName);
    if (!subscriptions.has(docName)) subscriptions.set(docName, new Set());
    subscriptions.get(docName)!.add(client);
    onClientDrop(client, releaseClient);

    // with a ledger, the version the document is at (`_v`),
    // so a copy kept from the stream of changes knows where it starts; its rows as it shows them
    // (the copy kept here is whole: what undo and the inverse read)
    const shown = showDoc(match.def, schema, doc, resolveScope(match.def, match.docId).mode === "single");
    respond({ result: ledger ? { ...shown, _v: ledger.version(docName) } : shown });
    log.info(`opened ${docName}`);
  }));

  /** A document from the cache, or loaded into it: an implied one opens empty, and its first write makes its row. */
  function load(docName: string, def: DocDef, docId: string): any | null {
    let doc = cache.get(docName);
    if (doc) return doc;
    doc = readDoc(db, schema, def, resolveScope(def, docId));
    if (!doc && def.implied) {
      doc = emptyDoc(def, docId);
      implied.add(docName);
    }
    if (doc) cache.set(docName, doc);
    return doc;
  }


  /**
   * Read back every doc someone has open that `evict()` dropped, before a
   * write: fan-out checks a target's scope against its copy, and one with no
   * copy used to lose its removes and grandchildren for good (v0.5.0 review #6).
   */
  function reloadEvicted(): void {
    for (const [name, subs] of subscriptions) {
      if (!subs.size || cache.has(name)) continue;
      const match = findDoc(name);
      if (match) load(name, match.def, match.docId);
    }
    custom.reread();
  }


  ws.on("delta", guarded((msg, client, respond) => {
    const docName = msg.doc as string;

    if (custom.find(docName)) {
      respond({ error: { code: 403, message: "Custom docs are read-only; write through the source doc." } });
      return;
    }

    const match = findDoc(docName);
    if (!match) return;
    // every op an object and every path a JSON Pointer, asked of the whole write before anything else (400), as delta_apply asks it
    if (!Array.isArray(msg.ops)) return respond({ error: { code: 400, message: "ops must be an array" } });
    if (msg.ops.some((op: unknown) => op === null || typeof op !== "object")) return respond({ error: { code: 400, message: "An op is an object: { op, path, value }" } });
    try { for (const op of msg.ops as DeltaOp[]) splitPath(op.path); }
    catch (err: any) { return respond({ error: failure(err) }); }

    heardElsewhere();
    reloadEvicted();
    const doc = cache.get(docName);
    if (!doc) {
      // a name its root's columns cannot take is the writer's mistake (400), before it is a document not open
      try { whereOf(resolveScope(match.def, match.docId), keeping(db, schema.tables[match.def.root]!)); }
      catch (err: any) { if (typeof err.code === "number") return respond({ error: { code: err.code, message: err.message } }); }
      respond({ error: { code: 404, message: `Doc not loaded: open ${docName} before writing to it` } });
      return;
    }

    const out = write(docName, match.def, doc, msg.ops as DeltaOp[], { who: whoOf(client), cursor: cursorOf(msg, client), undoable: msg.undoable !== false, as: identityOf(client) });
    if ("error" in out) return respond(out);
    // A writer that keeps its own history asks for the inverse (or keeps a
    // ledger): what delta applied, walked back, read from the document as it
    // was. Opt-in, so a browser writer is not sent rows it never asked for.
    // as the document shows them: its writer is answered no column it does not hold (the ledger keeps them whole)
    const shown = (o: Written) => ({ ...o, ops: showOps(match.def, schema, o.ops), inverse: showOps(match.def, schema, o.inverse) });
    respond({ result: msg.inverse || ledger ? { ack: true, ...shown(out) } : { ack: true } });
  }, { gatesCustom: false }));

  if (ledger) registerWalks(r, writer, ledger);

  // A document as it stood at a time (`at`, ISO-8601): its temporal rows as they were then.
  ws.on("open_at", guarded((msg, _client, respond) => {
    const match = findDoc(msg.doc as string);
    if (!match) return;
    if (!msg.at) return respond({ error: { code: 400, message: "at is required" } });
    let doc: any;
    try { doc = loadDocAt(db, schema, match.def, match.docId, String(msg.at)); }
    catch (err: any) { return respond({ error: failure(named(err)) }); }
    respond(doc ? { result: showDoc(match.def, schema, doc, resolveScope(match.def, match.docId).mode === "single") } : { error: NOT_FOUND });
  }));

  ws.on("close", guarded((msg, client, respond) => {
    const docName = msg.doc as string;
    const isCustom = custom.find(docName) != null;
    if (!isCustom && !findDoc(docName)) return;

    trackUnsubscribe(client, docName);
    if (isCustom) custom.leave(client, docName);
    else if (subscriptions.get(docName)?.delete(client)) unheld(docName);

    respond({ result: { ack: true } });
    log.debug(`closed ${docName}`);
  }, { owned: false, gatesCustom: false }));

  return {
    /**
     * Drop a doc's cached copy; the next open, write or fan-out that needs it
     * reads it again from the tables (`reloadEvicted`). Its subscribers stay
     * subscribed, and re-open to see what changed.
     */
    evict(docName: string) {
      cache.delete(docName);
      implied.delete(docName);
      custom.forget(docName);
    },
  };
}
