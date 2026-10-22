/**
 * dzql/pglite — Postgres in this process.
 *
 * The same stored functions, the same listener, the same documents as a
 * Postgres server, on PGlite (Postgres compiled to WASM): no database to run,
 * the data in a directory (or in memory). `openPglite()` answers the slice of
 * `pg`'s Pool delta uses, so everything in `dzql/postgres` runs on it
 * unchanged. An app opens it through `openStore` (in its data folder's `pg/`, or
 * `database`: a folder; else in memory); `openPglite("./data")` is the pool alone.
 *
 * Outgrow it and move to a server: `exportTables(pool, schema)` here,
 * `importTables(server, schema, rows)` there -- the ids and sequences carry.
 * One process owns the directory. Taken from epsilon's `pglite.ts`.
 *
 * Optional, like `pg`: `bun add @electric-sql/pglite` to use it.
 */
import { mkdirSync } from "node:fs";
import type { Pool, PoolConfig } from "pg";
import { createLogger } from "@blueshed/delta/logger";
import { namespaceOf } from "./sql";

const log = createLogger("[pool]");

/** The slice of PGlite this drives (structural: no hard import). */
interface PGliteish {
  query(text: string, params?: unknown[]): Promise<{ rows: any[] }>;
  exec(text: string): Promise<{ rows: any[] }[]>;
  transaction<T>(fn: (tx: { query(text: string, params?: unknown[]): Promise<{ rows: any[] }>; exec(text: string): Promise<{ rows: any[] }[]> }) => Promise<T>): Promise<T>;
  listen(channel: string, callback: (payload: string) => void): Promise<() => Promise<void>>;
  close(): Promise<void>;
}

type Runner = Pick<PGliteish, "query" | "exec">;
type Result = { rows: any[]; rowCount: number };

/** pg sends a JS object or array as JSON; PGlite binds by type, so give it the JSON text. */
const bind = (v: unknown): unknown => (v !== null && typeof v === "object" && !(v instanceof Date) ? JSON.stringify(v) : v);

/** One statement with parameters, or several without, as `pg`'s query takes them. */
async function run(on: Runner, text: string, params?: unknown[]): Promise<Result> {
  if (params?.length) {
    const { rows } = await on.query(text, params.map(bind));
    return { rows, rowCount: rows.length };
  }
  const results = await on.exec(text);
  const rows = results[results.length - 1]?.rows ?? [];
  return { rows, rowCount: rows.length };
}

const verb = (text: string) => text.trim().replace(/;$/, "").toUpperCase();

/**
 * Wrap a PGlite instance in the Pool delta uses. PGlite is one session: a
 * client's `BEGIN` opens a PGlite transaction and holds it until `COMMIT` or
 * `ROLLBACK`, and every other query waits for it (PGlite runs queries and
 * transactions under one lock), so nothing lands inside another's
 * transaction. `LISTEN` on a client is PGlite's `listen`, its payloads the
 * client's `notification` events.
 *
 * With a `namespace` (an app in a Postgres schema of its own, todo #29), every
 * query and transaction runs with that schema as its search path, set for its
 * own transaction: the one session is shared by every pool made on it, so two
 * apps on one PGlite each run in theirs.
 */
export function pglitePool(db: PGliteish, opts: { namespace?: string } = {}): Pool {
  const namespace = opts.namespace === undefined ? undefined : namespaceOf(opts.namespace);
  /** The search path a transaction of this pool runs with: its namespace, when it has one. */
  const inPath = async (on: Runner) => { if (namespace) await on.query("SELECT set_config('search_path', $1, true)", [namespace]); };
  /** A query outside a transaction: as it is, or in a transaction of its own on the namespace's path. */
  const runAlone = (text: string, params?: unknown[]): Promise<Result> =>
    namespace ? db.transaction(async (t) => { await inPath(t); return run(t, text, params); }) : run(db, text, params);

  function connect() {
    const handlers = new Set<(msg: { channel: string; payload: string }) => void>();
    const unlisten: (() => Promise<void>)[] = [];
    // The open transaction, if any: its queries, and how to end it.
    let tx: { on: Runner; end: (commit: boolean) => void; done: Promise<unknown> } | null = null;

    const client = {
      async query(text: string, params?: unknown[]): Promise<Result> {
        const v = verb(text);
        if (v === "BEGIN") {
          if (tx) throw new Error("a transaction is already open on this client");
          let opened!: (on: Runner) => void;
          const ready = new Promise<Runner>((r) => (opened = r));
          let end!: (commit: boolean) => void;
          const ended = new Promise<boolean>((r) => (end = r));
          const done = db.transaction(async (t) => {
            opened(t);
            if (!(await ended)) throw new Rollback();
          }).catch((err) => { if (!(err instanceof Rollback)) throw err; });
          tx = { on: await ready, end, done };
          await inPath(tx.on);
          return { rows: [], rowCount: 0 };
        }
        if (v === "COMMIT" || v === "ROLLBACK") {
          const open = tx;
          tx = null;
          if (!open) return { rows: [], rowCount: 0 };
          open.end(v === "COMMIT");
          await open.done;
          return { rows: [], rowCount: 0 };
        }
        const listen = /^LISTEN\s+("[^"]+"|[\w.]+)$/.exec(v);
        if (listen) {
          // as written: a quoted name (`"delta:app"`, a schema's channel) is given to PGlite quoted
          const name = text.trim().replace(/;$/, "").split(/\s+/)[1]!;
          const channel = name.replace(/"/g, "");
          unlisten.push(await db.listen(name, (payload) => { for (const h of handlers) h({ channel, payload }); }));
          return { rows: [], rowCount: 0 };
        }
        if (v.startsWith("UNLISTEN")) {
          for (const off of unlisten.splice(0)) await off();
          return { rows: [], rowCount: 0 };
        }
        return tx ? run(tx.on, text, params) : runAlone(text, params);
      },
      on(event: string, handler: (msg: any) => void) {
        if (event === "notification") handlers.add(handler);
        return client;
      },
      removeListener(event: string, handler: (msg: any) => void) {
        if (event === "notification") handlers.delete(handler);
        return client;
      },
      release() {
        // A client let go inside a transaction rolls it back, as pg's would be reset.
        if (tx) { tx.end(false); tx = null; }
      },
    };
    return client;
  }

  const pool = {
    query: runAlone,
    connect: async () => connect(),
    end: () => db.close(),
    on: () => pool,
  };
  return pool as unknown as Pool;
}

class Rollback extends Error {}

/**
 * Open (or create) an in-process Postgres: in `dir`, or in memory when none (or `:memory:`)
 * is given, as the Pool delta's Postgres backend takes; in `namespace`, a
 * Postgres schema, when it is given (`pglitePool`).
 */
export async function openPglite(dir?: string, opts: { namespace?: string } = {}): Promise<Pool> {
  if (dir === ":memory:") dir = undefined;
  let PGlite: any;
  try {
    ({ PGlite } = await import("@electric-sql/pglite"));
  } catch {
    throw new Error("[dzql/pglite] @electric-sql/pglite is not installed -- bun add @electric-sql/pglite");
  }
  // pgcrypto, which dzql/auth-jwt hashes passwords with: PGlite has an extension only when it is
  // given one at start (loaded when a database creates it)
  const { pgcrypto } = await import("@electric-sql/pglite/contrib/pgcrypto");
  // its folder made, parents and all, as a new app's `data/pg` needs (PGlite makes only the last)
  if (dir) mkdirSync(dir, { recursive: true });
  const db: PGliteish = await PGlite.create(dir, { extensions: { pgcrypto } });
  return pglitePool(db, opts);
}

/** Is `target` a Postgres server's URL (else a PGlite folder, or none: in memory)? */
export const isServerUrl = (target: string | undefined): target is string => !!target && /^postgres(ql)?:\/\//.test(target);

/**
 * An idle client's error logged, never thrown: a pool with no `error` listener crashes the
 * process when the server ends a connection it is not using (a restart, a failover,
 * `pg_terminate_backend`), and the pool makes a new one at the next query. A pool with a
 * listener of its own (an app's) is left to it.
 */
export function logPoolErrors(pool: Pool): Pool {
  if (typeof (pool as any).listenerCount !== "function" || (pool as any).listenerCount("error") === 0) {
    pool.on("error", (err: Error) => log.error(`an idle connection failed (the pool opens another): ${err.message}`));
  }
  return pool;
}

/**
 * A Postgres to talk to, said one way everywhere (`dzql migrate`, `dzql link`, `openStore`): a server
 * at a `postgres://` URL, else PGlite in a folder, else PGlite in memory. With a `namespace`, every
 * query runs in that Postgres schema (its search path): a server's connections are opened so. A
 * server's pool is opened with `pool` (pg's `PoolConfig`: `max`, `ssl`, `statement_timeout`...)
 * beside its URL, and an idle connection's error is logged (`logPoolErrors`).
 */
export async function openDatabase(target?: string, opts: { namespace?: string; pool?: PoolConfig } = {}): Promise<Pool> {
  if (isServerUrl(target)) {
    const namespace = opts.namespace === undefined ? undefined : namespaceOf(opts.namespace);
    const options = [opts.pool?.options, namespace && `-c search_path=${namespace}`].filter(Boolean).join(" ");
    return logPoolErrors(new (await import("pg")).Pool({ ...opts.pool, connectionString: target, ...(options && { options }) }));
  }
  return openPglite(target, opts);
}
