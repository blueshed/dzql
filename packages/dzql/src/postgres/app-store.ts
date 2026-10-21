/**
 * An app's store on Postgres, the one way to start one. `openStore` says it -- the tables, the
 * migrations, where its documents are served -- and opens nothing: each resource registers its
 * documents on it as the app loads, and a server opens it as it starts and closes it as it stops
 * (`Example.store`: dzql's `appOf` does both), so a test runs servers one after another in one
 * process, and `bun --hot` closes the last store before the next opens it.
 *
 * `open({ dataDir })`: a server at DATABASE_URL, else PGlite in this process, kept in the app's data
 * folder, in its `pg/` (`DATA_PATH`, a Railway volume, else the app's `data/`: the server says
 * which), or in memory with none (`:memory:`, as the tests say: the stories, a test's server); or the
 * `database` it is given, whatever the folder. In `public`, or the
 * Postgres schema it is given (`namespace`), so several apps share one database, each with its own
 * tables, ledger and change channel. The migrations run first (each resource's history, in the
 * order given: a folder, when it is there, or a list); then the framework; then every registered
 * document is compiled from its definitions, and `prepare` runs (to seed) -- all of it in the
 * open's own turn, an advisory lock on the database, so two servers opening one new database at
 * once take turns and the second finds it done. Then one listener answers for the documents and
 * the custom documents beside them, each on the ledger unless it says not (a session is no one's
 * history): in this process (`delta`, as dzql's thin client reads them) and, given one, on the
 * socket too (`ws`, delta's `createWs`, as a page drawn in the browser reads them).
 *
 * `owner` is the server itself in this process: a command, a job, a route that writes for no one
 * signed in. It writes and reads through the documents, as a page does -- the write the
 * document's (`accept`), on the ledger (by no one, along the cursor it names) and told to everyone
 * holding the document, on the socket and in this process -- and with `auth` it passes no gate,
 * every document is its own, and it reads and writes as the tables' owner, past the paths' policies.
 * `close()` ends the listener, then the pool. Opened twice (two servers of one app at once), it is
 * closed by the second close. The store is also the app's stories' (`begin`, `end`, `last`,
 * `since`): each story runs on it and it is put back after each.
 *
 * An app with sign-in gives its `auth` (delta's `DeltaAuth`, as `registerDocs` takes it): every
 * action passes its gate, and every document says who has it, a path in its `defineDoc`, or `owns`
 * or `shared` as it is registered. What the server itself must read past the documents' paths (who
 * is signed in, the rows a custom document works out) it reads as the tables' owner,
 * `asOwner(store.pool, ...)`; never what is sent to someone as it is read.
 */
import { existsSync } from "node:fs";
import type { Pool } from "pg";
import { createLocal, type Caller } from "@blueshed/delta/local";
import { authless, ownerless, type DeltaAuth } from "@blueshed/delta/auth";
import { assertOwned, type DocDef, type Migration, type Schema } from "@blueshed/delta/backend";
import type { WsServer } from "@blueshed/delta/server";
import { applyFramework, applySql, ensureNamespace } from "./bootstrap";
import { generateSql } from "./codegen";
import { createDocListener, type CustomDocDef } from "./listener";
import { fromFolder, migrate } from "./migrate";
import { openDatabase } from "./pglite";
import { docTypeFromDef } from "./registry";
import { storyStore } from "./story-store";

/**
 * A history of migrations: a folder (`dir`, run when it is there; the model's `model/migrations`) or
 * a `list`. `app` names it in `delta_migrations`; `schema` is its tables, so the run knows a new
 * database from one before it, and fences only their ledger entries. `imported`: the rows come from
 * the store before, migrated there (`importTables` in `prepare`), so on a new database the changes
 * make the tables and no `up` runs (it was that store's SQL); once it is recorded, the next `up` runs.
 */
export type History = { app?: string; schema?: Schema; imported?: boolean } & ({ dir: string } | { list: Migration[] });

/** How a resource's documents are registered: on the ledger or not; with `auth`, who has one that says no path; its custom documents. */
export type Registration<I = unknown> = {
  /** On the ledger (undo, redo, history), unless it says not: a session is no one's history. */
  ledger?: boolean;
  /** With `auth`: every identity that passes the gate may have every document here that says no path. */
  shared?: boolean;
  /** With `auth`: who may have a document here that says no path. */
  owns?: (identity: I, docName: string) => boolean | Promise<boolean>;
  /** The resource's custom documents (`defineCustomDoc`), served beside its own: read-only, and with `auth` each says who has it. */
  custom?: CustomDocDef<any, I>[];
};

export type StoreOptions<I = unknown> = {
  /** The app's tables: the model's (`model/types.ts`'s `tables`), and its own beside them; or several schemas, each a resource's, kept as one. */
  schema: Schema | Schema[];
  /** Where it is kept, whatever folder it is opened on: a Postgres URL, or a PGlite folder. Without it, DATABASE_URL, else the data folder's `pg/`, else in memory. */
  database?: string;
  /** The migrations, run first: one history (recorded as app "model" unless it names one), or several, each a resource's, each naming its `app`, run in the order given. */
  migrations?: History | History[];
  /** Sign-in: delta's `DeltaAuth`, wired on the socket (`wireAuth`, or `linkAuth`'s routes). Every action passes its gate, and every document says who has it. */
  auth?: DeltaAuth<I>;
  /** How an identity is written in the ledger. Default: a string or number as it is, anything else as JSON. */
  who?: (identity: I) => string;
  /** The socket the documents are served on too (`createWs()`), as a page drawn in the browser reads them; with or without one, they are served in this process (`delta`, `owner`). */
  ws?: WsServer;
  /** The Postgres schema the app is kept in, made when it is not there: `public` without one, as a database has it. */
  namespace?: string;
  /** Run at each open, once the documents are compiled and before the listener serves them: the tables are there (to seed them), and a guard put on `delta` before now stands in front of the listener. It is given the data folder the store is opened on, where a new database finds the rows the app kept before it. */
  prepare?: (pool: Pool, where: { dataDir?: string }) => void | Promise<void>;
};

/** Several schemas as one: each table once, so two resources never both declare one. */
function oneSchema(schemas: Schema | Schema[]): Schema {
  if (!Array.isArray(schemas)) return schemas;
  const tables: Schema["tables"] = {};
  for (const { tables: each } of schemas) {
    for (const [key, table] of Object.entries(each)) {
      if (key in tables) throw new Error(`Two schemas both declare the table ${key}: a table is one resource's, and another's document reads it`);
      tables[key] = table;
    }
  }
  return { tables };
}

/** The histories, each with its app: one alone may leave it to "model"; of several, each names its own, once. */
function historiesOf(migrations: History | History[] | undefined): (History & { app: string })[] {
  if (!migrations) return [];
  if (!Array.isArray(migrations)) return [{ ...migrations, app: migrations.app ?? "model" }];
  const apps = migrations.map((h) => h.app);
  const unnamed = apps.findIndex((app) => !app);
  if (unnamed >= 0) throw new Error(`openStore: history ${unnamed + 1} of ${apps.length} names no app: each resource's history is recorded under its own ({ app, list } or { app, dir })`);
  const twice = apps.find((app, i) => apps.indexOf(app) < i);
  if (twice) throw new Error(`openStore: two histories are app "${twice}": each resource's history is recorded under its own`);
  return migrations as (History & { app: string })[];
}

/**
 * `step` in the open's own turn: an advisory lock on the database (one per Postgres schema the app
 * is kept in), held on a connection of its own until `step` is done, so a second server opening it
 * at once waits, then finds the tables, the functions and the rows made. PGlite is one process's,
 * one session: its turn is taken and let go all the same.
 */
async function inItsTurn(db: Pool, namespace: string | undefined, step: () => Promise<void>): Promise<void> {
  const key = "hashtext('dzql_open:' || COALESCE($1::text, current_schema()::text, ''))";
  const turn = await db.connect();
  let lost: Error | undefined;
  try {
    await turn.query(`SELECT pg_advisory_lock(${key})`, [namespace ?? null]);
    try {
      await step();
    } finally {
      try { await turn.query(`SELECT pg_advisory_unlock(${key})`, [namespace ?? null]); } catch (err) { lost = err as Error; }
    }
  } finally {
    turn.release(lost); // a connection that could not let go is ended, and its lock with it
  }
}

/** Why the store cannot be used: it is not open. */
const notOpen = () => new Error("The store is not open: a server opens it as it starts (appOf), and closes it as it stops");

export function openStore<I = unknown>({ schema: schemas, database, migrations, auth, who, ws, namespace, prepare }: StoreOptions<I>) {
  const schema = oneSchema(schemas);
  const histories = historiesOf(migrations);
  /** The documents, in delta, in this process: one for the store's life, each open's listener on it. */
  const delta = createLocal();
  /**
   * The server itself, a caller of `delta` no socket can be: the listener knows it by its client.
   * Its client carries no identity, as the server's own write does everywhere in dzql (a guard on
   * `delta` lets it by).
   */
  const owner: Caller = delta.as("dzql: the server itself");
  delete owner.client.data.identity;
  /** Where the listener answers: in this process, and on the socket when there is one, each told every change. */
  const served: WsServer = ws
    ? {
        ...ws,
        on: (action, handler) => { ws.on(action, handler); delta.server.on(action, handler); },
        publish: (channel, data) => { ws.publish(channel, data); delta.server.publish(channel, data); },
      }
    : delta.server;
  /** Each registered document, with who has it when it says no path. */
  const registered: { def: DocDef; owns?: Registration<I>["owns"]; shared?: boolean }[] = [];
  const custom: CustomDocDef<any, I>[] = [];
  const offLedger: string[] = [];
  /** What this open holds: its pool, its listener and its stories' store. */
  let open: { pool: Pool; listener: Awaited<ReturnType<typeof createDocListener>>; stories: ReturnType<typeof storyStore> } | undefined;
  /** How many servers hold it open. */
  let holders = 0;
  /** Where the open store is kept: a URL, a folder, or none (in memory). */
  let opened: string | undefined;
  /** Opens and closes, one after another, so a close not yet done is done before the next open. */
  let turn: Promise<void> = Promise.resolve();
  const inTurn = (step: () => Promise<void>): Promise<void> => {
    const done = turn.then(step);
    turn = done.catch(() => {});
    return done;
  };

  /** The open store's pool, whichever open it is: what an app's own queries and its seed use. */
  const pool = new Proxy({} as Pool, {
    get(_, key) {
      if (!open) return () => Promise.reject(notOpen());
      const value = (open.pool as any)[key];
      return typeof value === "function" ? value.bind(open.pool) : value;
    },
  });
  /** The stories' store of this open: a new database is saved afresh as its stories begin. */
  const stories = () => {
    if (!open) throw notOpen();
    return open.stories;
  };

  return {
    pool,
    delta,
    /**
     * The server itself, in this process: `owner.call("delta", { doc, ops, cursor })`, and `open`,
     * `undo`, `history` as any caller. Through the documents, as a page writes: the document's rule,
     * the ledger (by no one), and every holder told. With `auth`: no gate, every document its own,
     * read and written as the tables' owner. For a command, a job, the first person in.
     */
    owner,
    /**
     * A resource's documents, opened with the rest by `open()`: on the ledger (undo, history) unless
     * it says not; with `auth`, each says who has it (a path, or `owns` or `shared` here); and its
     * custom documents beside them. One that says no owner is refused here, as the app loads.
     */
    register(docs: DocDef[], { ledger = true, shared, owns, custom: theirs = [] }: Registration<I> = {}): void {
      // as registerDocs refuses them: with auth, a document says who has it; without, none may
      if (auth) {
        const unsaid = docs.filter((d) => d.owns === undefined);
        if (unsaid.length && !owns && !shared) throw ownerless(unsaid.map((d) => d.prefix).join(", "), "openStore's register");
      } else if (owns || shared || docs.some((d) => d.owns !== undefined)) {
        throw authless(docs.map((d) => d.prefix).join(", "), "openStore's register");
      }
      assertOwned(theirs, auth);
      registered.push(...docs.map((def) => (def.owns === undefined ? { def, owns, shared } : { def })));
      custom.push(...theirs);
      if (!ledger) offLedger.push(...docs.map((d) => d.prefix));
    },
    /** The database opened, migrated and every registered document compiled and served: as a server starts, on its data folder (none, or `:memory:`: in memory). */
    open: ({ dataDir }: { dataDir?: string } = {}): Promise<void> =>
      inTurn(async () => {
        const where = database ?? (process.env.DATABASE_URL || (dataDir && dataDir !== ":memory:" ? `${dataDir}/pg` : undefined));
        // a second server of the app holds the same store: on the same database, or not at all
        if (holders > 0 && where !== opened) throw new Error(`The store is open on ${opened ?? "memory"}: a second server cannot open it on ${where ?? "memory"}`);
        if (holders++ > 0) return;
        opened = where;
        try {
          const db: Pool = await openDatabase(where, { namespace });
          try {
            // in its turn: two servers opening one new database at once would make its types and functions twice
            const opening: NonNullable<typeof open> = { pool: db, listener: undefined!, stories: storyStore(db, schema) };
            await inItsTurn(db, namespace, async () => {
              if (namespace !== undefined) await ensureNamespace(db, namespace); // the migrations run in it
              for (const h of histories) {
                const list = "list" in h ? h.list : existsSync(h.dir) ? await fromFolder(h.dir) : undefined;
                if (list) await migrate(db, list, { app: h.app, ...(h.schema && { schema: h.schema }), ...(h.imported && { imported: true }) });
              }
              await applyFramework(db, { namespace });
              await applySql(db, generateSql(schema, registered.map((r) => r.def)), { namespace });
              open = opening;
              await prepare?.(pool, { dataDir }); // a second server's finds the first's rows
            });
            const types = registered.map(({ def, owns, shared }) => docTypeFromDef<I>(def, db, { auth, owns, shared }));
            opening.listener = await createDocListener<I>(served, db, { types, custom, auth, who, ledger: { except: offLedger }, schema, namespace, owner: owner.client });
          } catch (err) {
            open = undefined;
            await db.end();
            throw err;
          }
        } catch (err) {
          holders--;
          throw err;
        }
      }),
    /** The listener ended (it holds a client for LISTEN), then the pool, once no server holds it open: a PGlite folder is left as it was, for the next open. */
    close: (): Promise<void> =>
      inTurn(async () => {
        if (holders === 0 || --holders > 0) return;
        const was = open!;
        open = undefined;
        await was.listener.destroy();
        await was.pool.end();
      }),
    /** The stories begin and end each story on this store, and read its ledger (`Example.store`). */
    begin: () => stories().begin(),
    end: () => stories().end(),
    last: () => stories().last(),
    since: (id: number) => stories().since(id),
  };
}

/** An app's store on Postgres, as `openStore` gives it. */
export type AppStore = ReturnType<typeof openStore>;
