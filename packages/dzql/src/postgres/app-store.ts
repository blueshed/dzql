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
 * tables, ledger and change channel. The migrations run first (a folder, when it is there, or a
 * list); then the framework; then every registered document is compiled from its definitions,
 * `prepare` runs (to seed), and one listener answers for them all, each on the ledger unless it
 * says not (a session is no one's history): in this process (`delta`, as dzql's thin client reads
 * them), or on the socket it is given (`ws`, delta's `createWs`, as a page drawn in the browser
 * reads them). `close()` ends the listener, then the pool. Opened twice (two servers of one app at
 * once), it is closed by the second close. The store is also the app's stories' (`begin`, `end`,
 * `last`, `since`): each story runs on it and it is put back after each.
 */
import { existsSync } from "node:fs";
import type { Pool } from "pg";
import { createLocal } from "@blueshed/delta/local";
import type { DocDef, Migration, Schema } from "@blueshed/delta/backend";
import type { WsServer } from "@blueshed/delta/server";
import { applyFramework, applySql, ensureNamespace } from "./bootstrap";
import { generateSql } from "./codegen";
import { serveDocs } from "./register";
import { fromFolder, migrate } from "./migrate";
import { openDatabase } from "./pglite";
import { storyStore } from "./story-store";

export type StoreOptions = {
  /** The app's tables: the model's (`model/types.ts`'s `tables`), and its own beside them. */
  schema: Schema;
  /** Where it is kept, whatever folder it is opened on: a Postgres URL, or a PGlite folder. Without it, DATABASE_URL, else the data folder's `pg/`, else in memory. */
  database?: string;
  /** The migrations, run first: a folder (`dir`, run when it is there; the model's `model/migrations`) or a `list`. `app` names them in `delta_migrations`; `schema` is theirs (the model's), so the run knows a new database from one before them, and fences only their ledger entries. */
  migrations?: { app?: string; schema?: Schema } & ({ dir: string } | { list: Migration[] });
  /** The socket the documents are served on (`createWs()`); without one, they are served in this process (`delta`). */
  ws?: WsServer;
  /** The Postgres schema the app is kept in, made when it is not there: `public` without one, as a database has it. */
  namespace?: string;
  /** Run at each open, once the documents are compiled and before the listener serves them: the tables are there (to seed them), and a guard put on `delta` before now stands in front of the listener. It is given the data folder the store is opened on, where a new database finds the rows the app kept before it. */
  prepare?: (pool: Pool, where: { dataDir?: string }) => void | Promise<void>;
};

/** Why the store cannot be used: it is not open. */
const notOpen = () => new Error("The store is not open: a server opens it as it starts (appOf), and closes it as it stops");

export function openStore({ schema, database, migrations, ws, namespace, prepare }: StoreOptions) {
  /** The documents, in delta, in this process: one for the store's life, each open's listener on it. */
  const delta = createLocal();
  const registered: DocDef[] = [];
  const offLedger: string[] = [];
  /** What this open holds: its pool, its listener and its stories' store. */
  let open: { pool: Pool; listener: Awaited<ReturnType<typeof serveDocs>>; stories: ReturnType<typeof storyStore> } | undefined;
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
    /** A resource's documents, opened with the rest by `open()`; on the ledger (undo, history) unless it says not. */
    register(docs: DocDef[], { ledger = true } = {}): void {
      registered.push(...docs);
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
            if (namespace !== undefined) await ensureNamespace(db, namespace); // the migrations run in it
            const history = !migrations ? undefined : "list" in migrations ? migrations.list : existsSync(migrations.dir) ? await fromFolder(migrations.dir) : undefined;
            if (history) await migrate(db, history, { app: migrations!.app ?? "model", ...(migrations!.schema && { schema: migrations!.schema }) });
            await applyFramework(db, { namespace });
            await applySql(db, generateSql(schema, registered), { namespace });
            open = { pool: db, listener: undefined!, stories: storyStore(db, schema) };
            await prepare?.(pool, { dataDir });
            open.listener = await serveDocs(ws ?? delta.server, db, schema, registered, [], { ledger: { except: offLedger }, namespace });
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
