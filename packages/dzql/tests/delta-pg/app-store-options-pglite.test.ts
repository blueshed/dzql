/**
 * openStore's options for running it, on PGlite: under NODE_ENV=production it refuses to start
 * PGlite unless told it may (todo #92), and while open it prunes the ops log on an interval,
 * stopping as it closes (todo #95). One server pruning at a time, the pool's options, an app's own
 * pool and the RLS warning are a Postgres server's: postgres-pool.test.ts.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { setLogLevel } from "@blueshed/delta/logger";
import { defineDoc, defineSchema, openStore } from "../../src/postgres";

setLogLevel("silent");

const schema = defineSchema({ notes: { columns: { text: "text" }, temporal: false } });
const notes = defineDoc("notes:", { root: "notes", include: [] });
const folders: string[] = [];
const folder = () => { const f = mkdtempSync(`${tmpdir()}/options-`); folders.push(f); return f; };
afterAll(() => { for (const f of folders) rmSync(f, { recursive: true, force: true }); });

/** `fn` with the environment as given (undefined: unset), put back after. */
async function withEnv(env: Record<string, string | undefined>, fn: () => Promise<void>): Promise<void> {
  const was = Object.fromEntries(Object.keys(env).map((k) => [k, process.env[k]]));
  const set = (vars: Record<string, string | undefined>) => { for (const [k, v] of Object.entries(vars)) if (v === undefined) delete process.env[k]; else process.env[k] = v; };
  set(env);
  try { await fn(); } finally { set(was); }
}

describe("PGlite in production", () => {
  test("under NODE_ENV=production with no database named, it refuses to start PGlite, naming DATABASE_URL", async () => {
    await withEnv({ NODE_ENV: "production", DATABASE_URL: undefined, DZQL_PGLITE_IN_PRODUCTION: undefined }, async () => {
      const store = openStore({ schema });
      store.register([notes]);
      await expect(store.open({ dataDir: folder() })).rejects.toThrow("Set DATABASE_URL to the Postgres server's URL");
      await expect(store.open()).rejects.toThrow("pgliteInProduction: true"); // in memory too
      await expect(store.pool.query("SELECT 1")).rejects.toThrow("The store is not open");
    });
  }, 60_000);

  test("told it may (pgliteInProduction, or DZQL_PGLITE_IN_PRODUCTION=1), it starts PGlite in production all the same", async () => {
    await withEnv({ NODE_ENV: "production", DATABASE_URL: undefined, DZQL_PGLITE_IN_PRODUCTION: undefined }, async () => {
      const store = openStore({ schema, database: folder(), pgliteInProduction: true });
      store.register([notes]);
      await store.open();
      expect((await store.delta.call("open", { doc: "notes:" })).result).toMatchObject({ notes: {} });
      await store.close();
    });
    await withEnv({ NODE_ENV: "production", DATABASE_URL: undefined, DZQL_PGLITE_IN_PRODUCTION: "1" }, async () => {
      const store = openStore({ schema, database: folder() });
      store.register([notes]);
      await store.open();
      await store.close();
    });
  }, 60_000);
});

describe("the ops log pruned while it is open", () => {
  const aged = async (store: ReturnType<typeof openStore>) => {
    expect((await store.owner.call("delta", { doc: "notes:", ops: [{ op: "add", path: "/notes/-", value: { text: "old" } }] })).error).toBeUndefined();
    await store.pool.query("UPDATE _delta_ops_log SET created_at = NOW() - INTERVAL '2 hours'");
    return async () => Number((await store.pool.query("SELECT count(*) AS n FROM _delta_ops_log")).rows[0].n);
  };

  test("every so often, what is older than it keeps goes; closed, it stops", async () => {
    const store = openStore({ schema, database: folder(), prune: { every: 50, keep: "1 hour" } });
    store.register([notes]);
    await store.open();
    const count = await aged(store);
    for (let i = 0; i < 100 && (await count()) > 0; i++) await Bun.sleep(20);
    expect(await count()).toBe(0);
    await store.close(); // the timer cleared, and a prune under way awaited, before the pool ends
    await Bun.sleep(120); // a timer left running would prune on an ended pool, and fail loudly
  }, 60_000);

  test("prune: false leaves it to the app", async () => {
    const store = openStore({ schema, database: folder(), prune: false });
    store.register([notes]);
    await store.open();
    const count = await aged(store);
    await Bun.sleep(150);
    expect(await count()).toBe(1);
    await store.close();
  }, 60_000);
});
