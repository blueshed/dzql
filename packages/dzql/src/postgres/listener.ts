/**
 * DocListener — one server, one LISTEN, many doc types.
 *
 * A listener answers for the doc types it is given (`types`, and `register`
 * later); two servers in one process each have their own.
 *
 * Auth is pluggable via `opts.auth`. When provided, every doc message passes
 * through `auth.gate(client)` and the resulting identity is threaded into
 * `type.open / apply / openAt` so backends can scope queries (e.g. with
 * `withAppAuth` + RLS), and a type's `owns(identity, docName)` decides whether
 * that identity may have the document at all (404 when not). When auth is
 * omitted, no gate runs and identity is undefined — delta itself has no
 * opinion on authentication.
 */
import type { WsServer } from "@blueshed/delta/backend";
import { trackSubscribe, trackUnsubscribe, onClientDrop } from "@blueshed/delta/backend";
import { createLogger } from "@blueshed/delta/logger";
import type { Pool, PoolClient } from "pg";
import { callAs, docTypes, showAnswer } from "./registry";
import { refusedBy, shapedBy, showDoc, showOps, type DocDef, type Schema } from "@blueshed/delta/backend";
import { resolveScope } from "@blueshed/delta/backend";
import type { DocType } from "./registry";
import type { DeltaAuth } from "@blueshed/delta/auth";
import { isAuthError } from "@blueshed/delta/auth";
import { splitPath, type DeltaOp } from "@blueshed/delta/core";
import { isEntryId, ledgerWho, socketCursor } from "@blueshed/delta/backend";
import { assertOwned, createCustomDocs, NOT_FOUND, sendTo, type CustomDoc, type Owns, type Refusal } from "@blueshed/delta/backend";
import { namespaceOf } from "./sql";

const log = createLogger("[doc]");

// ---------------------------------------------------------------------------
// Custom doc — predicate-based membership view over watched collections.
// ---------------------------------------------------------------------------

/**
 * A custom doc on Postgres (`../custom`): its reads take the pool and answer
 * with a promise. A membership `query` runs once per doc name and identity
 * (the gated identity, undefined without auth), and its result is cached and
 * shared by the subscribers of that name who are that identity -- never by
 * another: bind the identity yourself (`withAppAuth(pool, id, …)`) so RLS
 * scopes what it reads, as recompute does. A `recompute` reads the WHOLE doc,
 * on open and on any write to a watched collection, and republishes it to each
 * subscriber as a root-replace op -- for nested/joined reads a per-row
 * `matches` can't express: re-evaluated PER SUBSCRIBER under that client's
 * identity, so RLS applies, hence it binds `app.user_id` itself.
 */
export interface CustomDocDef<C = unknown, I = any> extends CustomDoc<C, I, Pool> {
  query?: (pool: Pool, criteria: C, identity?: I) => Promise<Record<string, any[]>>;
  recompute?: (pool: Pool, criteria: C, identity?: I) => Promise<any>;
}

export function defineCustomDoc<C, I = any>(
  prefix: string,
  opts: Omit<CustomDocDef<C, I>, "prefix">,
): CustomDocDef<C, I> {
  return { prefix, ...opts };
}

/**
 * The schema the database declares (`_delta_collections`, the last
 * `generateSql` applied), as a listener given none shows it: read once, as
 * it starts.
 */
async function declaredSchema(pool: Pool): Promise<Schema> {
  try {
    const { rows } = await pool.query("SELECT collection_key, table_name, columns_def, parent_collection, parent_fk, temporal FROM _delta_collections");
    return {
      tables: Object.fromEntries(rows.map((r: any) => [r.collection_key, {
        name: r.table_name, docKey: r.collection_key, columns: r.columns_def ?? {}, temporal: !!r.temporal, children: [], referencedBy: [],
        ...(r.parent_fk ? { parent: { collection: r.parent_collection, fkColumn: r.parent_fk } } : {}),
      }])),
    };
  } catch {
    return { tables: {} };   // no framework yet: nothing declared, nothing left out
  }
}

function errMsg(err: unknown, doc?: { name: string; owns?: string }): string {
  // a unique constraint the schema says (delta's idx_<table>_unique_<columns>): in delta's words, as SQLite says it
  const e = err as { code?: unknown; constraint?: string; table?: string; detail?: string; message?: string } | null;
  const key = e?.code === "23505" && e.constraint?.includes("_unique_") ? /^Key \((.+?)\)=/.exec(e.detail ?? "")?.[1] : undefined;
  if (key) return `Already there: another row has the same ${key.split(", ").map((c) => `${e!.table}.${c}`).join(", ")} (a unique constraint)`;
  // a row the policies (derived from the paths) refuse as written, through a document whose owns is a path:
  // the backstop met it before delta_apply's own check could, and it is the same refusal, in delta's words
  if (e?.code === "42501" && doc?.owns !== undefined && /^new row violates row-level security policy/.test(e.message ?? "")) {
    return `${doc.name}: that would take it out of your reach (its owns: ${doc.owns})`;
  }
  return err instanceof Error ? err.message : String(err);
}

/**
 * The wire code for an error the database raised -- the same table as the
 * other backends. The framework raises SQLSTATE 22023 for a malformed path or
 * op, 22P02 for a row id it could not mint, 22007 and 22008 for a time it
 * cannot read, and 23502 for an add that leaves out a required field (a
 * client's mistake, 400); P0002 for a row that is not
 * there (404); 23505 for an add of a row that is, and 40001 for an undo of an
 * entry that is not the cursor's next (409). And 40P01, a write that met another
 * at once and gave way to it (two adds of temporal ids in opposite orders wait
 * on each other's row locks): nothing was written, and the same write
 * sent again goes through, or meets the rows the other made (409). A document
 * type that refuses with a wire code of its own (a number, 400 to 499: a
 * read-only document's 403) is answered with it. Anything else is the
 * server's (500).
 */
const CODE_OF_SQLSTATE: Record<string, number> = { "22023": 400, "22P02": 400, "22007": 400, "22008": 400, "23502": 400, "25006": 403, "42501": 403, P0002: 404, "23505": 409, "40001": 409, "40P01": 409 };
function wireCode(err: unknown): number {
  const state = (err as { code?: unknown } | null)?.code;
  if (typeof state === "number" && state >= 400 && state < 500) return state;
  return (typeof state === "string" && CODE_OF_SQLSTATE[state]) || 500;
}

// ---------------------------------------------------------------------------
// State — per-doc subscriber tracking
// ---------------------------------------------------------------------------

interface DocState {
  version: number;
  /**
   * The last version a notification has announced (or an open read): a drain
   * reads no further. A later entry is heard when its own
   * notification comes, so each notification maps to entries not yet heard,
   * and a document let go of and tracked again by a late notification does not
   * read an entry twice. A resync after a reconnect, which missed notifications,
   * reads to the end.
   */
  until: number;
  subscribers: Set<any>;
  notifying: boolean;
  /** A notification arrived while a fetch was in flight — re-drain when it ends. */
  pending: boolean;
}

/** _delta_fetch_log (delta_fetch_ops' rows) caps each call at this many; a full page means there may be more. */
const FETCH_PAGE = 1000;

/**
 * What a custom document hears of a log entry: each write once, as it was applied. The writer's
 * entry carries it (`applied`) where the writer was told otherwise, and null where it was told the
 * write as applied; each other told document's entry of the write carries none ([]). Told, a row
 * that left a document is a remove, which is not a delete, and a row told to two documents would be
 * heard twice. An entry logged some other way carries null too: heard as told.
 */
const appliedOf = (row: any): DeltaOp[] => (row.applied ?? row.ops) as DeltaOp[];

/** How the listener reads a document's log: `_delta_fetch_log` (001e), each entry with the write as applied, for custom documents. */
const FETCH_LOG = "SELECT version, ops, applied FROM _delta_fetch_log($1, $2)";

/**
 * The channel the listener hears its app's changes on, asked of the pool (`_delta_channel`, 001c:
 * `delta_changes` in `public`, `delta:<schema>` in a schema of an app's own), so it is the one the
 * writes made through the pool are told on. Given a `namespace`, the pool must run in it (its search
 * path's first schema), or the listener would read one app and hear another.
 */
async function channelOf(pool: Pool, namespace: string | undefined): Promise<string> {
  if (namespace !== undefined) {
    const ns = namespaceOf(namespace);
    const here: string | null = (await pool.query("SELECT current_schema() AS ns")).rows[0]?.ns ?? null;
    if (here !== ns) throw new Error(`createDocListener: the pool runs in schema ${here ?? "(none there)"}, not ${ns} -- open it there: openDatabase(url, { namespace: "${ns}" })`);
  }
  return (await pool.query("SELECT _delta_channel() AS channel")).rows[0].channel;
}

export async function createDocListener<I = unknown>(
  ws: WsServer,
  pool: Pool,
  opts?: {
    /** The documents this listener answers for: `docTypeFromDef(def, pool)`, or a `DocType` written by hand. */
    types?: DocType<any, I>[];
    auth?: DeltaAuth<I>;
    custom?: CustomDocDef<any>[];
    /**
     * Keep the ledger (001g): every write with its inverse, who made it and the cursor undo walks; and
     * `undo`, `redo`, `history`. `{ except: [prefix...] }` keeps it for every document but those: a
     * session that is no one's history (where a person is) stays off it, as a SQLite registration
     * without `ledger: true` does.
     */
    ledger?: boolean | { except: string[] };
    /** How an identity is written in the ledger. Default: a string or number as it is, anything else as JSON. */
    who?: (identity: I) => string;
    /**
     * This process's schema: the schema is the contract (reference/migrations.md). It writes
     * by the columns it declares, and sends only those -- two versions on one database each
     * see and write their own. Without it, the columns the database declares as the
     * listener starts (`_delta_collections`, the last `generateSql` applied).
     */
    schema?: Schema;
    /**
     * The Postgres schema the app is in (todo #29), when it is not `public`: the pool must run in it
     * (`openDatabase(url, { namespace })`), and the listener hears that schema's changes alone.
     * Without it, those of the schema the pool runs in, as always.
     */
    namespace?: string;
  },
) {
  const auth = opts?.auth;
  // Default-deny, as docTypeFromDef is: with auth, every document -- a custom
  // one, a registered type -- says who owns it, or that it is shared. Asked
  // before the pool is touched, so a refusal leaves nothing to clean up.
  assertOwned(opts?.custom ?? [], auth);
  const registry = docTypes((opts?.types ?? []) as DocType[], (opts?.custom ?? []).map((d) => d.prefix), !!auth);
  // what this process declares: it writes by it (`declared`, set for each write's transaction) and sends only it (`shown`)
  const declared = opts?.schema ? JSON.stringify(Object.fromEntries(Object.entries(opts.schema.tables).map(([key, t]) => [key, t.columns]))) : undefined;
  const shownBy: Schema = opts?.schema ?? (await declaredSchema(pool));
  /** A document as this process shows it: each row its declared columns (`showDoc`). */
  const shownDoc = (type: DocType<any, I>, docName: string, doc: any) =>
    type.def && doc ? showDoc(type.def, shownBy, doc, resolveScope(type.def, docName.slice(type.def.prefix.length)).mode === "single") : doc;
  /** Ops, and an answer's ops and inverse, as this process shows them (`showOps`). */
  const shownOps = (def: DocDef | undefined, ops: any) => (def && Array.isArray(ops) ? showOps(def, shownBy, ops) : ops);
  const shownAnswer = <R extends { ops?: unknown; inverse?: unknown } | null>(def: DocDef | undefined, r: R): R =>
    r && def ? { ...r, ...(r.ops ? { ops: shownOps(def, r.ops) } : {}), ...(r.inverse ? { inverse: shownOps(def, r.inverse) } : {}) } : r;
  const resolveDoc = registry.resolve;
  const ledger = !!opts?.ledger;
  const offLedger = new Set(typeof opts?.ledger === "object" ? opts.ledger.except : []);
  /** Is a write to this document's type on the ledger? */
  const onLedger = (prefix: string): boolean => ledger && !offLedger.has(prefix);
  const whoOf = (identity: I | undefined): string | null => ledgerWho(identity, opts?.who);
  // The cursor undo walks: named by a caller in this process, and over the
  // socket the connection itself -- signed in, the person and the connection
  // together, so another person holding the same connection id (a client may
  // choose it, to keep its cursor across a reconnect) cannot walk it.
  const cursorOf = (msg: any, client: any, identity: I | undefined): string | null =>
    client?.data?.local ? (typeof msg.cursor === "string" ? msg.cursor : null) : socketCursor(whoOf(identity), client);
  // Who is writing, for the ledger: the identity the gate gives when there is
  // an auth module; without one, the identity the client carries
  // (`createLocal().as(identity)`, or one set at upgrade) -- as the SQLite backend reads it.
  const writerOf = (identity: I | undefined, client: any): I | undefined =>
    auth ? identity : (client?.data?.identity as I | undefined);
  /** The gate's identity (undefined without auth), or the 401 for a socket without one. */
  const gate = (client: any): { identity: I | undefined } | { error: Refusal } => {
    if (!auth) return { identity: undefined };
    const gated = auth.gate(client);
    return isAuthError(gated) ? { error: { code: 401, message: gated.error } } : { identity: gated };
  };
  const tracked = new Map<string, DocState>();
  /**
   * The names this listener holds open in the database (`_delta_held`, todo
   * #73), each its hold's query: a write's fan-out asks only the names held
   * somewhere. A name is held from before its first open here reads it, until
   * nobody here has it open or is opening it (`opening`). Its holds and lets
   * go run on the pool in the order asked, one name's beside another's: a hold
   * that waits for a write holds up no other name. The listener's connection
   * keeps the lock that says this holder is alive.
   */
  const holds = new Map<string, Promise<unknown>>();
  const opening = new Map<string, number>();
  const queued = new Map<string, Promise<unknown>>();
  /**
   * Each socket's opens not yet answered, by name: messages from one socket run
   * side by side, so a write sent right behind its open waits for that open
   * (`openedBy`) before it is asked whether the socket has the document open.
   */
  const asked = new WeakMap<object, Map<string, Promise<unknown>>>();
  const askedOpen = (handler: (msg: any, client: any, respond: (r: any) => void) => Promise<void>) =>
    (msg: any, client: any, respond: (r: any) => void): Promise<void> => {
      const done = handler(msg, client, respond);
      const name = msg?.doc;
      if (client && typeof client === "object" && typeof name === "string") {
        const mine = asked.get(client) ?? new Map<string, Promise<unknown>>();
        asked.set(client, mine);
        mine.set(name, done);
        const settled = () => { if (mine.get(name) === done) mine.delete(name); };
        done.then(settled, settled);
      }
      return done;
    };
  /** Has this socket `docName` open here: opened (once an open it sent before has been answered), not closed or let go since. */
  async function openedBy(client: any, docName: string): Promise<boolean> {
    await asked.get(client)?.get(docName)?.catch(() => {});
    return tracked.get(docName)?.subscribers.has(client) ?? false;
  }
  let holder: number | null = null;
  /** `sql` for `docName`, after what was asked for it before. */
  function inOrder(docName: string, sql: string): Promise<unknown> {
    const run = (queued.get(docName) ?? Promise.resolve()).then(() => pool.query(sql, [holder, docName]));
    const done = run.catch(() => {});
    queued.set(docName, done);
    void done.then(() => { if (queued.get(docName) === done) queued.delete(docName); });
    return run;
  }

  // The custom documents (../custom): who holds each, who may hear it, what a
  // write tells it -- and who may still hear any document: a change
  // told asks the gate and `owns` again of each socket it is told to (`owns`
  // once per identity per change), so what a change costs is the identities a
  // document has open, not its sockets. Without auth nothing is asked. The
  // longest prefix answers a name: a type's longer than a custom doc's wins.
  const custom = createCustomDocs<I, Pool>({
    defs: opts?.custom ?? [], handle: pool, auth, publish: (channel, data) => ws.publish(channel, data), log,
    answers: (docName, length) => (resolveDoc(docName)?.type.prefix.length ?? 0) <= length,
  });
  const ownsOf = (docName: string): Owns<I> | undefined => {
    const type = resolveDoc(docName)?.type;
    return type?.owns ? (identity, name) => type.owns!(identity, name) : undefined;
  };

  // Single LISTEN connection with auto-reconnect, on the app's own channel
  const channel = await channelOf(pool, opts?.namespace);
  let listener: PoolClient = await pool.connect();
  let destroyed = false;
  let reconnecting = false;

  let errorHandler: ((err: Error) => void) | null = null;

  // Detach our handlers before releasing a connection — released connections
  // are recycled by the pool, and a stale listener would fire against this
  // closure's state (and spuriously trigger reconnect) on a future checkout.
  function detachListener(client: any) {
    try { client.removeListener?.("notification", heard); } catch {}
    if (errorHandler) {
      try { client.removeListener?.("error", errorHandler); } catch {}
    }
  }

  /** LISTEN on `client`, and keep this holder's lock on it. */
  async function setupListener(client: any): Promise<void> {
    await client.query(`LISTEN "${channel.replace(/"/g, '""')}"`);
    client.on("notification", heard);
    errorHandler = (err: Error) => {
      log.error(`listener error: ${err.message}`);
      if (!destroyed) reconnect();
    };
    client.on("error", errorHandler);
    holder = (await client.query("SELECT _delta_holder_start($1) AS holder", [holder])).rows[0].holder;
  }

  async function reconnect() {
    if (reconnecting || destroyed) return; // a single error event runs the loop
    reconnecting = true;
    // `reconnecting` stays true for the WHOLE operation, including the resync,
    // so an error fired by the freshly-connected listener during resync can't
    // spawn a second concurrent reconnect that releases the connection resync
    // is using. The finally guarantees the flag is always cleared.
    try {
      log.info("listener reconnecting...");
      detachListener(listener);
      try { listener.release(); } catch {}
      const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
      for (let attempt = 1; !destroyed; attempt++) {
        try {
          await delay(Math.min(attempt * 1000, 10000));
          listener = await pool.connect();
          await setupListener(listener);
          log.info("listener reconnected");
          await keepHolds();
          // Catch up: ops committed while we were disconnected were NOTIFY'd to
          // nobody, so re-drain every tracked doc from its last seen version.
          await resyncTracked();
          return;
        } catch (err) {
          log.error(`reconnect attempt ${attempt} failed: ${errMsg(err)}`);
        }
      }
    } finally {
      reconnecting = false;
    }
  }

  // Re-drain all tracked docs (used after a reconnect to recover missed ops).
  async function resyncTracked() {
    for (const [docName, state] of tracked) {
      state.until = Number.MAX_SAFE_INTEGER;   // the notifications while away are gone: read to the end
      if (state.notifying) { state.pending = true; continue; }
      state.notifying = true;
      try { await drainDoc(docName, state, true); }
      catch (err) { log.error(`resync ${docName}: ${errMsg(err)}`); }
      finally { state.notifying = false; }
    }
  }

  try {
    await setupListener(listener);
  } catch (err) {
    detachListener(listener);
    listener.release();
    throw err;
  }

  // A document's own subscribers need only its own order, so each document drains on its own
  // (onNotification), and none waits on another's. A custom document hears writes made through
  // every document, so it is told them one after another, as Postgres delivers the notifications
  // (in commit order): told from each document's drain, a slow read of one told it a later write,
  // made through another, first.
  let inCommitOrder: Promise<void> = Promise.resolve();
  function heard(msg: any) {
    void onNotification(msg);
    if (custom.size > 0) inCommitOrder = inCommitOrder.then(() => hearCustom(msg));
  }

  /** The custom documents told the one write a notification announces: its document's entry at that version. */
  async function hearCustom(msg: any) {
    if (destroyed || msg.channel !== channel || !msg.payload) return;
    try {
      const { doc: docName, v } = JSON.parse(msg.payload);
      const rows = (await pool.query(FETCH_LOG, [docName, v - 1])).rows.filter((row: any) => Number(row.version) === v);
      if (auth && rows.length > 0) await custom.letGoWatching(rows.flatMap(appliedOf));
      for (const row of rows) custom.tell(appliedOf(row));
    } catch (err) {
      log.error(`notify error (custom): ${errMsg(err)}`);
    }
  }

  // Notification handler — fans out LISTEN/NOTIFY to the document's WS subscribers.
  async function onNotification(msg: any) {
    if (destroyed) return;
    if (msg.channel !== channel || !msg.payload) return;
    try {
      const { doc: docName, v } = JSON.parse(msg.payload);
      const state = tracked.get(docName);
      if (!state || v <= state.version) return;
      state.until = Math.max(state.until, v);
      if (state.notifying) {
        // A fetch is already running for this doc. Coalesce instead of dropping:
        // dropping here lost ops when a concurrent write's NOTIFY landed mid-fetch.
        state.pending = true;
        return;
      }

      state.notifying = true;
      try {
        await drainDoc(docName, state);
      } finally {
        state.notifying = false;
      }
    } catch (err) {
      log.error(`notify error: ${errMsg(err)}`);
    }
  }

  // Drain a doc's ops to its subscribers. Loops while a full page comes back
  // (a backlog larger than the fetch's LIMIT) and re-runs if another
  // notification arrived mid-drain (the coalesced `pending` flag). Caller owns
  // the `notifying` guard. After a reconnect (`resync`) the custom documents
  // are told what it reads too: the notifications while away are gone.
  async function drainDoc(docName: string, state: DocState, resync = false) {
    do {
      state.pending = false;
      let more = true;
      while (more && state.version < state.until) {
        const page = (await pool.query(FETCH_LOG, [docName, state.version])).rows;
        // only what a notification has announced (`until`): the rest is heard with its own
        const rows = page.filter((row: any) => Number(row.version) <= state.until);
        more = page.length >= FETCH_PAGE && rows.length === page.length;
        // Told to those who may still hear it: the document's own subscribers
        if (auth && rows.length > 0) {
          await custom.letGo(docName, state.subscribers, ownsOf(docName));
          if (resync) await custom.letGoWatching(rows.flatMap(appliedOf));
        }
        for (const row of rows) {
          if (state.subscribers.size > 0) {
            // `v` lets the client validate the per-doc sequence and re-open on
            // a gap. delta_fetch_ops rows are contiguous and ascending per doc.
            // Number(): pg returns a top-level BIGINT column as a string, but
            // the open snapshot's `_v` (from JSONB) is a number — the client
            // compares them strictly, so both must be numbers.
            ws.publish(docName, { doc: docName, ops: shownOps(resolveDoc(docName)?.type.def, row.ops), v: Number(row.version) });
          }
          state.version = Number(row.version);
          if (resync) custom.tell(appliedOf(row));
        }
      }
    } while (state.pending);
    if (state.until > state.version) state.until = state.version;   // after a resync: from here, as announced

    pruneDoc(docName);
    log.debug(`notify ${docName} v${state.version}`);
  }

  function pruneDoc(docName: string) {
    const state = tracked.get(docName);
    if (!state) return;
    for (const sub of state.subscribers) {
      if (sub.readyState !== undefined && sub.readyState !== 1) {
        state.subscribers.delete(sub);
      }
    }
    if (state.subscribers.size === 0) { tracked.delete(docName); release(docName); }
  }

  function hold(docName: string): Promise<unknown> {
    let held = holds.get(docName);
    if (!held) {
      held = inOrder(docName, "SELECT _delta_hold($1, $2)");
      held.catch(() => { if (holds.get(docName) === held) holds.delete(docName); });
      holds.set(docName, held);
    }
    return held;
  }

  /** Let go of a name nobody here has open or is opening. */
  function release(docName: string): void {
    if (tracked.get(docName)?.subscribers.size || opening.has(docName) || !holds.delete(docName)) return;
    inOrder(docName, "SELECT _delta_let_go($1, $2)")
      .catch((err) => log.error(`let go of ${docName}: ${errMsg(err)}`));
  }

  /**
   * Back from a lost connection: a name cleared while the listener was away
   * (another took it for gone) may have missed a write. Each socket is let go
   * of such a document, and opens it again; an open reading it reads again.
   */
  async function keepHolds(): Promise<void> {
    await Promise.allSettled(holds.values());
    const { rows } = await pool.query("SELECT doc_name FROM _delta_held WHERE holder = $1", [holder]);
    const still = new Set(rows.map((r: any) => r.doc_name as string));
    for (const docName of [...holds.keys()]) {
      if (still.has(docName)) continue;
      holds.delete(docName);
      for (const client of tracked.get(docName)?.subscribers ?? []) {
        try { trackUnsubscribe(client, docName); } catch { /* the socket may be closing */ }
        sendTo(client, { doc: docName, error: { code: 500, message: "the server lost the database for a while: open it again" } });
      }
      tracked.delete(docName);
    }
  }

  // Transport-level teardown (socket drop / logout via dropClientSubscriptions):
  // pruneDoc only runs when a doc drains, so a doc whose subscribers all
  // vanished without further writes stayed tracked, and custom-doc caches
  // (which pruneDoc never touches) lived until an explicit `close` action
  // that a dropped socket never sends. Mirrors the sqlite backend's hook.
  function releaseClient(client: any): void {
    for (const [docName, state] of tracked) {
      if (!state.subscribers.delete(client)) continue;
      if (state.subscribers.size === 0) { tracked.delete(docName); release(docName); }
    }
    custom.leave(client);
  }

  // ---------------------------------------------------------------------------
  // withDoc — authenticate (if configured), validate doc name, resolve handler,
  // wrap errors. Each WS branch supplies only its own body.
  // ---------------------------------------------------------------------------

  type DocCtx = {
    docName: string;
    type: DocType<any, I>;
    ctx: any;
    msg: any;
    client: any;
    respond: (r: any) => void;
    identity: I | undefined;
  };

  // `owned: false` for close alone: letting go of a document never needs the owner's say.
  function withDoc(label: string, fn: (dc: DocCtx) => Promise<void> | void, { owned = true } = {}) {
    return async (msg: any, client: any, respond: (r: any) => void) => {
      if (destroyed) return; // a listener ended answers nothing: its socket may have the next one's
      const g = gate(client);
      if ("error" in g) return respond(g);
      const { identity } = g;
      const docName = msg.doc as string;
      if (!docName) {
        return respond({ error: { code: 400, message: "doc is required" } });
      }
      const found = resolveDoc(docName);
      // not one of this listener's: left to the socket's other handlers (a memory document beside
      // it, as SQLite's registrations leave one), and 404 from the socket when none answers
      if (!found) return;
      try {
        // The document's name is its channel: one this identity does not own is
        // not there for it (404, as a missing one), so it never subscribes.
        if (owned && auth && found.type.owns && !(await found.type.owns(identity as I, docName))) {
          return respond({ error: NOT_FOUND });
        }
        await fn({ docName, type: found.type, ctx: found.ctx, msg, client, respond, identity });
      } catch (err) {
        const m = errMsg(err, { name: docName, owns: found.type.def?.owns });
        log.error(`${label} failed: ${m}`);
        respond({ error: { code: wireCode(err), message: m } });
      }
    };
  }

  // ---------------------------------------------------------------------------
  // WS branches — custom docs first (short-circuit before standard withDoc)
  // ---------------------------------------------------------------------------

  if (custom.size > 0) {
    ws.on("open", async (msg: any, client: any, respond: (r: any) => void) => {
      const docName = msg.doc as string;
      if (!docName || destroyed) return;
      const match = custom.find(docName);
      if (!match) return;                                     // fall through to standard

      // Gate custom docs exactly like standard docs (withDoc). Without this the
      // custom open handler — which registers before and short-circuits the
      // standard gated handler — let an unauthenticated client read scoped data.
      const g = gate(client);
      if ("error" in g) return respond(g);
      const { identity } = g;

      try {
        // As withDoc asks a type's owns: a name this identity does not own is not there for it.
        if (auth && match.def.owns && !(await match.def.owns(identity as I, docName))) return respond({ error: NOT_FOUND });
        const doc = await custom.open(client, docName, match, identity);
        if (doc == null) return respond({ error: NOT_FOUND });
        trackSubscribe(client, docName);
        onClientDrop(client, releaseClient);
        respond({ result: doc });
        log.info(`opened ${docName} (custom${match.def.recompute ? ", recompute" : ""})`);
      } catch (err) {
        log.error(`open custom ${docName} failed: ${errMsg(err)}`);
        respond({ error: { code: 500, message: errMsg(err) } });
      }
    });

    ws.on("delta", (msg: any, _client: any, respond: (r: any) => void) => {
      const docName = msg.doc as string;
      if (!docName || destroyed) return;
      if (!custom.find(docName)) return;                       // fall through to standard
      respond({ error: { code: 403, message: "Custom docs are read-only; write through the source doc." } });
    });

    ws.on("close", (msg: any, client: any, respond: (r: any) => void) => {
      const docName = msg.doc as string;
      if (!docName || destroyed) return;
      if (!custom.find(docName)) return;                       // fall through to standard
      trackUnsubscribe(client, docName);
      custom.leave(client, docName);
      respond({ result: { ack: true } });
      log.debug(`closed ${docName} (custom)`);
    });
  }

  ws.on("open", askedOpen(withDoc("open", async ({ docName, type, ctx, msg, client, respond, identity }) => {
    opening.set(docName, (opening.get(docName) ?? 0) + 1);
    try {
      // held before the read: a write from now is told to this name; one lost
      // while it read (keepHolds) is held and read again
      let result;
      for (let held = hold(docName); ; held = hold(docName)) {
        await held;
        result = await type.open(ctx, docName, msg, identity);
        if (holds.get(docName) === held) break;
      }
      // a document whose root row is not there, in delta's words (a name the identity does not own was refused above, as not there)
      if (!result) return respond({ error: type.def ? { code: 404, message: `Not found: no ${type.def.root} row ${docName.slice(type.prefix.length)}. Make the row first, or declare the document implied: true` } : NOT_FOUND });

      pruneDoc(docName);
      let state = tracked.get(docName);
      if (!state) {
        state = { version: Number(result.version), until: Number(result.version), subscribers: new Set(), notifying: false, pending: false };
        tracked.set(docName, state);
      } else {
        state.version = Math.max(state.version, Number(result.version));
        state.until = Math.max(state.until, state.version);
      }

      state.subscribers.add(client);
      trackSubscribe(client, docName);
      onClientDrop(client, releaseClient);
      respond({ result: shownDoc(type, docName, result.result) });
      log.info(`opened ${docName} v${state.version}`);
    } finally {
      const left = opening.get(docName)! - 1;
      if (left > 0) opening.set(docName, left); else opening.delete(docName);
      release(docName);
    }
  })));

  ws.on("delta", withDoc("delta", async ({ docName, type, ctx, msg, client, respond, identity }) => {
    // every op an object, asked of the whole write before anything else (400), in delta's words, as SQLite asks it
    if (!Array.isArray(msg.ops)) return respond({ error: { code: 400, message: "ops must be an array" } });
    if (msg.ops.some((op: unknown) => op === null || typeof op !== "object")) return respond({ error: { code: 400, message: "An op is an object: { op, path, value }" } });
    // A connection writes only what it has opened: the wire's rule, as delta's SQLite holds it.
    // An in-process caller (createLocal(), `client.data.local`) is not held to it, there as here:
    // it is the server itself, not a page -- it hears every channel and names its own cursor --
    // and a server that draws pages (dzql/rendering) writes for a person through it, having asked
    // its own wire the same rule.
    if (!client?.data?.local && !(await openedBy(client, docName))) {
      // what SQLite asks before it: each op's path a pointer (400), then the name one its root's
      // columns can take (400) and a single document's root there (404, as a write through it says)
      for (const op of msg.ops as DeltaOp[]) splitPath(op.path);
      if (!(await type.open(ctx, docName, msg, identity)) && type.def) await type.apply(ctx, docName, [], identity, undefined, declared);
      return respond({ error: { code: 404, message: `Doc not loaded: open ${docName} before writing to it` } });
    }
    // the document's own rule (accept), asked of each op before any is applied, as SQLite asks it
    const refused = type.def ? refusedBy(type.def, docName, msg.ops as DeltaOp[], identity) : undefined;
    if (refused !== undefined) return respond({ error: { code: 400, message: refused } });
    // ... then what the server makes of it (shape), validated by delta_apply as any write is
    let ops = msg.ops as DeltaOp[];
    if (type.def?.shape) {
      try { ops = shapedBy(type.def, docName, ops, identity); }
      catch (err) { log.error(`shape ${docName} failed: ${errMsg(err)}`); return respond({ error: { code: wireCode(err), message: errMsg(err) } }); }
    }
    const writer = writerOf(identity, client);
    const kept = onLedger(type.prefix);
    const by = kept ? { who: whoOf(writer), cursor: cursorOf(msg, client, writer), undoable: msg.undoable !== false } : undefined;
    const result = shownAnswer(type.def, await type.apply(ctx, docName, ops, identity, by, declared));
    respond({ result: kept ? { ack: true, version: Number(result.version), ops: result.ops, inverse: result.inverse, entry: result.entry == null ? undefined : Number(result.entry) } : { ack: true, version: Number(result.version), ...(msg.inverse ? { ops: result.ops } : {}) } });
    log.info(`delta ${docName} v${result.version}`);
  }));

  if (ledger) {
    /**
     * Undo or redo: the cursor's next entry, walked in the database (001g
     * `delta_walk`) by its guarded plan and recorded as walking it; a conflict
     * changes nothing, answers `conflict`, and moves the cursor on. `dry: true`
     * answers the plan; `entry: id` walks only that entry. `change: id` walks
     * one change of the cursor's instead (`_delta_change_tip`), and a conflict
     * then records nothing.
     */
    const walk = (way: "undo" | "redo") => async (msg: any, client: any, respond: (r: any) => void) => {
      if (destroyed) return;
      const change = msg.change ?? null;
      if (change !== null && !isEntryId(change)) return respond({ error: { code: 400, message: "change must be an entry's id: a whole number from 1" } });
      const g = gate(client);
      if ("error" in g) return respond(g);
      const { identity } = g;
      const db = await pool.connect();
      try {
        const writer = writerOf(identity, client);
        const cursor = cursorOf(msg, client, writer);
        await db.query("BEGIN");
        // A walk writes to its entry's document, so it asks owns as delta does:
        // under the cursor's lock (delta_walk takes it again), so the entry
        // asked about is the one walked.
        if (auth && cursor !== null) {
          await db.query("SELECT pg_advisory_xact_lock(hashtext('delta-cursor:' || $1::text))", [cursor]);
          const tip = (change === null
            ? await db.query("SELECT doc_name FROM _delta_ledger_tip($1, $2)", [cursor, way === "undo"])
            : await db.query("SELECT doc_name FROM _delta_change_tip($1, $2, $3)", [cursor, change, way === "undo"])).rows[0]?.doc_name;
          const found = tip ? resolveDoc(tip) : null;
          if (found?.type.owns && !(await found.type.owns(identity as I, tip, db))) {
            await db.query("ROLLBACK");
            return respond({ error: NOT_FOUND });
          }
        }
        const args = [cursor, whoOf(writer), way === "undo", msg.dry === true, msg.entry ?? null, change];
        const walked = (await callAs(db, "delta_walk", args, auth, identity, declared)) ?? null;
        const def = walked?.doc ? resolveDoc(walked.doc)?.type.def : undefined;
        const result = walked?.doc ? shownAnswer(def, await showAnswer(db, walked.doc, walked, def)) : walked;   // as its document shows them
        await db.query("COMMIT");
        respond({ result: result && { ...result, ...(result.version != null ? { version: Number(result.version) } : {}), entry: result.entry == null ? undefined : Number(result.entry) } });
      } catch (err) {
        try { await db.query("ROLLBACK"); } catch { /* the connection may be gone */ }
        log.error(`${way} failed: ${errMsg(err)}`);
        respond({ error: { code: wireCode(err), message: errMsg(err) } });
      } finally {
        db.release();
      }
    };
    ws.on("undo", walk("undo"));
    ws.on("redo", walk("redo"));
    // A document's recent history, to whoever may open it: each entry says `mine`, never who wrote it.
    ws.on("history", withDoc("history", async ({ docName, type, ctx, msg, client, respond, identity }) => {
      if (!(await type.open(ctx, docName, msg, identity))) return respond({ error: NOT_FOUND });
      const { rows } = await pool.query("SELECT delta_history($1, $2, $3) AS entries", [docName, cursorOf(msg, client, writerOf(identity, client)), msg.limit ?? 50]);
      respond({ result: await Promise.all((rows[0]?.entries ?? []).map(async (e: any) => shownAnswer(type.def, await showAnswer(pool, docName, e, type.def)))) });
    }));
  }

  ws.on("open_at", withDoc("open_at", async ({ docName, type, ctx, msg, respond, identity }) => {
    const at = msg.at as string;
    if (!at) return respond({ error: { code: 400, message: "at is required" } });
    if (!type.openAt) {
      return respond({ error: { code: 400, message: `open_at not supported for ${docName}` } });
    }
    const doc = await type.openAt(ctx, docName, at, identity);
    if (!doc) return respond({ error: NOT_FOUND });
    respond({ result: shownDoc(type, docName, doc) });
    log.info(`open_at ${docName} @ ${at}`);
  }));

  ws.on("close", withDoc("close", ({ docName, client, respond }) => {
    trackUnsubscribe(client, docName);
    const state = tracked.get(docName);
    if (state) {
      state.subscribers.delete(client);
      if (state.subscribers.size === 0) { tracked.delete(docName); release(docName); }
    }
    respond({ result: { ack: true } });
    log.debug(`closed ${docName}`);
  }, { owned: false }));

  return {
    /** Answer for one more type; one of a prefix it answers for already is replaced (`bun --hot`). */
    register: registry.register as (type: DocType<any, I>) => void,
    async destroy() {
      destroyed = true;
      try {
        await listener.query("UNLISTEN *");
        await listener.query("SELECT _delta_holder_stop($1)", [holder]);
      } catch {}
      // Released connections are recycled by the pool; stale listeners would
      // fire against this closure's state on future pooled connections.
      detachListener(listener);
      try { listener.release(); } catch {}
    },
  };
}
