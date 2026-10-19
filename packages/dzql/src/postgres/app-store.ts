/**
 * An app's store on Postgres, for dzql's thin client: a server at DATABASE_URL, else PGlite in this
 * process, kept in PGLITE_DIR (in memory without one: the tests and the stories). The model's
 * migrations run first, when it has made them; then the framework; then, at `open()`, every document
 * the app's resources registered is compiled from its definitions and one listener answers for them
 * all, each on the ledger unless it says not (a session is no one's history). `stories` is the
 * app's `Example.store`, so its stories run on this store and are put back after each.
 */
import { existsSync } from "node:fs";
import type { Pool } from "pg";
import { createLocal } from "@blueshed/delta/local";
import type { DocDef, Schema } from "@blueshed/delta/backend";
import { applyFramework, applySql } from "./bootstrap";
import { generateSql } from "./codegen";
import { createDocListener } from "./listener";
import { docTypeFromDef } from "./registry";
import { fromFolder, migrate } from "./migrate";
import { openPglite } from "./pglite";
import { storyStore } from "./story-store";

export type StoreOptions = {
  /** The app's tables: the model's (`model/types.ts`'s `tables`), and its own beside them. */
  schema: Schema;
  /** The model's migrations (`model/migrations`), run first when the folder is there; `app` names them in `delta_migrations`, `schema` is the model's. */
  migrations?: { dir: string; app?: string; schema?: Schema };
};

export async function openStore({ schema, migrations }: StoreOptions) {
  const pool: Pool = process.env.DATABASE_URL ? new (await import("pg")).Pool({ connectionString: process.env.DATABASE_URL }) : await openPglite(process.env.PGLITE_DIR || undefined);
  if (migrations && existsSync(migrations.dir)) await migrate(pool, await fromFolder(migrations.dir), { app: migrations.app ?? "model", ...(migrations.schema && { schema: migrations.schema }) });
  await applyFramework(pool);

  /** The documents, in delta, in this process. */
  const delta = createLocal();
  const registered: DocDef[] = [];
  const offLedger: string[] = [];

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
      await applySql(pool, generateSql(schema, registered));
      await prepare?.();
      await createDocListener(delta.server, pool, { types: registered.map((def) => docTypeFromDef(def, pool)), ledger: { except: offLedger }, schema });
    },
    /** The stories begin and end each story on this store (`Example.store`). */
    stories: storyStore(pool, schema),
  };
}
