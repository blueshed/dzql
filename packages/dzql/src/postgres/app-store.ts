/**
 * An app's store on Postgres, the one way to start one: a server at DATABASE_URL, else PGlite in this
 * process, kept in PGLITE_DIR (in memory without one: the tests and the stories), or the `database`
 * it is given; in `public`, or the Postgres schema it is given (`namespace`), so several apps share
 * one database, each with its own tables, ledger and change channel. The migrations run first (a folder, when it is there, or a list); then the framework;
 * then, at `open()`, every document the app's resources registered is compiled from its definitions
 * and one listener answers for them all, each on the ledger unless it says not (a session is no
 * one's history): in this process (`delta`, as dzql's thin client reads them), or on the socket it
 * is given (`ws`, delta's `createWs`, as a page drawn in the browser reads them). `stories` is the
 * app's `Example.store`, so its stories run on this store and are put back after each; `close()`
 * ends the listener, then the pool.
 */
import { existsSync } from "node:fs";
import type { Pool } from "pg";
import { createLocal } from "@blueshed/delta/local";
import type { DocDef, Migration, Schema } from "@blueshed/delta/backend";
import type { WsServer } from "@blueshed/delta/server";
import { applyFramework, applySql, ensureNamespace } from "./bootstrap";
import { generateSql } from "./codegen";
import { createDocListener } from "./listener";
import { docTypeFromDef } from "./registry";
import { fromFolder, migrate } from "./migrate";
import { openDatabase } from "./pglite";
import { storyStore } from "./story-store";

export type StoreOptions = {
  /** The app's tables: the model's (`model/types.ts`'s `tables`), and its own beside them. */
  schema: Schema;
  /** Where it is kept: a Postgres URL, or a PGlite folder. Without it, DATABASE_URL, else PGLITE_DIR, else in memory. */
  database?: string;
  /** The migrations, run first: a folder (`dir`, run when it is there; the model's `model/migrations`) or a `list`. `app` names them in `delta_migrations`; `schema` is theirs (the model's), so the run knows a new database from one before them, and fences only their ledger entries. */
  migrations?: { app?: string; schema?: Schema } & ({ dir: string } | { list: Migration[] });
  /** The socket the documents are served on (`createWs()`); without one, they are served in this process (`delta`). */
  ws?: WsServer;
  /** The Postgres schema the app is kept in, made when it is not there: `public` without one, as a database has it. */
  namespace?: string;
};

export async function openStore({ schema, database, migrations, ws, namespace }: StoreOptions) {
  const pool: Pool = await openDatabase(database ?? (process.env.DATABASE_URL || process.env.PGLITE_DIR || undefined), { namespace });
  if (namespace !== undefined) await ensureNamespace(pool, namespace);   // the migrations run in it
  const history = !migrations ? undefined : "list" in migrations ? migrations.list : existsSync(migrations.dir) ? await fromFolder(migrations.dir) : undefined;
  if (history) await migrate(pool, history, { app: migrations!.app ?? "model", ...(migrations!.schema && { schema: migrations!.schema }) });
  await applyFramework(pool, { namespace });

  /** The documents, in delta, in this process. */
  const delta = createLocal();
  const registered: DocDef[] = [];
  const offLedger: string[] = [];
  let listener: Awaited<ReturnType<typeof createDocListener>> | undefined;

  return {
    pool,
    delta,
    /** A resource's documents, opened with the rest by `open()`; on the ledger (undo, history) unless it says not. */
    register(docs: DocDef[], { ledger = true } = {}): void {
      registered.push(...docs);
      if (!ledger) offLedger.push(...docs.map((d) => d.prefix));
    },
    /**
     * Every registered document compiled and opened: once, after the resources have registered. What
     * `prepare` does runs between: the tables are there (to seed them), and the listener is not yet
     * (so a guard put on `delta` stands in front of it).
     */
    async open(prepare?: () => void | Promise<void>): Promise<void> {
      await applySql(pool, generateSql(schema, registered), { namespace });
      await prepare?.();
      listener = await createDocListener(ws ?? delta.server, pool, { types: registered.map((def) => docTypeFromDef(def, pool)), ledger: { except: offLedger }, schema, namespace });
    },
    /** The listener ended (it holds a client for LISTEN), then the pool: a PGlite folder is left as it was, for the next start. */
    async close(): Promise<void> {
      await listener?.destroy();
      await pool.end();
    },
    /** The stories begin and end each story on this store (`Example.store`). */
    stories: storyStore(pool, schema),
  };
}
