/**
 * openStore's pool on a Postgres server: opened with the app's `PoolConfig`, or the app's own
 * `Pool`, used as it is and never ended (todo #99); an idle connection the server ends is logged,
 * not thrown (todo #99); one server prunes the ops log at a time (todo #95); and with `auth`, a
 * pool whose role passes row-level security (a superuser, or BYPASSRLS) is warned of as it opens
 * (todo #102), one that is neither is not (`wsb_app`, made here and dropped after). Each in a
 * schema of its own.
 */
import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { Pool } from "pg";
import { setLogLevel } from "@blueshed/delta/logger";
import { defineDoc, defineSchema, openStore } from "../../src/postgres";
import { pruneInTurn } from "../../src/postgres/app-store";
import { PG_URL } from "./setup";

setLogLevel("silent");

const schemas = ["pool_config", "pool_own", "pool_rls_super", "pool_rls_app"];
const role = "wsb_app";
const appUrl = (() => { const u = new URL(PG_URL); u.username = role; u.password = role; return u.toString(); })();
let admin: Pool;
beforeAll(async () => {
  admin = new Pool({ connectionString: PG_URL, max: 4 });
  for (const ns of schemas) await admin.query(`DROP SCHEMA IF EXISTS ${ns} CASCADE`);
  await admin.query(`DROP ROLE IF EXISTS ${role}`);
  await admin.query(`CREATE ROLE ${role} LOGIN PASSWORD '${role}' NOSUPERUSER NOBYPASSRLS`);
  await admin.query(`CREATE SCHEMA pool_rls_app AUTHORIZATION ${role}`);
});
afterAll(async () => {
  for (const ns of schemas) await admin.query(`DROP SCHEMA IF EXISTS ${ns} CASCADE`);
  await admin.query(`DROP ROLE IF EXISTS ${role}`);
  await admin.end();
});

const schema = defineSchema({ pool_notes: { columns: { text: "text" }, temporal: false } });
const notes = defineDoc("notes:", { root: "pool_notes", include: [] });

/** What the logger said at `level` while `fn` ran (given what it has said so far). */
async function said(level: "warn" | "error", fn: (sofar: () => string) => Promise<void>): Promise<string> {
  setLogLevel(level);
  const spy = spyOn(console, level).mockImplementation(() => {});
  const sofar = () => spy.mock.calls.map((c) => String(c[0])).join("\n");
  try {
    await fn(sofar);
    return sofar();
  } finally {
    spy.mockRestore();
    setLogLevel("silent");
  }
}

describe("the pool", () => {
  test("opened with the app's PoolConfig beside the URL; an idle connection the server ends is logged, and the store goes on", async () => {
    const store = openStore({ schema, database: PG_URL, namespace: schemas[0], pool: { max: 3, application_name: "dzql_pool_config" } });
    store.register([notes]);
    await store.open();
    try {
      expect((store.pool as any).options.max).toBe(3);
      await Promise.all([1, 2, 3].map(() => store.pool.query("SELECT pg_sleep(0.05)"))); // idle connections, kept
      const log = await said("error", async (sofar) => {
        await admin.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE application_name = 'dzql_pool_config' AND state = 'idle'");
        // until each idle connection ended has failed, and the pool has let it go
        const gone = () => sofar().includes("an idle connection failed") && (store.pool as any).idleCount === 0;
        for (const end = Date.now() + 5000; Date.now() < end && !gone();) await new Promise((r) => setImmediate(r));
      });
      expect(log).toContain("an idle connection failed");
      expect((await store.pool.query("SELECT 1 AS one")).rows).toEqual([{ one: 1 }]); // a new one, made
    } finally {
      await store.close();
    }
  }, 60_000);

  test("an app's own Pool is used as it is, its errors logged unless it listens itself, and never ended by the store", async () => {
    await admin.query(`CREATE SCHEMA ${schemas[1]}`);
    const mine = new Pool({ connectionString: PG_URL, max: 4, options: `-c search_path=${schemas[1]}` });
    try {
      const store = openStore({ schema, namespace: schemas[1], pool: mine });
      store.register([notes]);
      expect(mine.listenerCount("error")).toBe(1);
      await store.open();
      expect((await store.owner.call("delta", { doc: "notes:", ops: [{ op: "add", path: "/pool_notes/-", value: { text: "mine" } }] })).error).toBeUndefined();
      await store.close();
      expect((await mine.query("SELECT text FROM pool_notes")).rows).toEqual([{ text: "mine" }]); // still open
      await store.open(); // and opened again on it
      await store.close();
    } finally {
      await mine.end();
    }
  }, 60_000);

  test("of the servers sharing a database, one prunes the ops log at a time: the rest pass", async () => {
    const store = openStore({ schema, database: PG_URL, namespace: schemas[1], prune: false });
    store.register([notes]);
    await store.open();
    const other = await admin.connect();
    try {
      await other.query("SELECT pg_advisory_lock(hashtext('dzql_prune:' || $1))", [schemas[1]]);
      expect(await pruneInTurn(store.pool)).toBeNull();
      await other.query("SELECT pg_advisory_unlock(hashtext('dzql_prune:' || $1))", [schemas[1]]);
      expect(await pruneInTurn(store.pool)).toBe(0);
    } finally {
      other.release();
      await store.close();
    }
  }, 60_000);
});

describe("row-level security, with sign-in", () => {
  const auth = { gate: (c: any) => c.data?.identity ?? { error: "Authentication required" }, asSqlArg: (i: any) => i } as any;
  const owned = defineDoc("notes:", { root: "pool_notes", include: [], owns: "@id" });

  test("a pool whose role is a superuser (or BYPASSRLS) is warned of as it opens: the policies hold nothing for it", async () => {
    const store = openStore({ schema, database: PG_URL, namespace: schemas[2], auth });
    store.register([owned]);
    const log = await said("warn", () => store.open());
    await store.close();
    expect(log).toContain("superuser or has BYPASSRLS");
  }, 60_000);

  test("a pool whose role is neither is not", async () => {
    const store = openStore({ schema, database: appUrl, namespace: schemas[3], auth });
    store.register([owned]);
    const log = await said("warn", () => store.open());
    await store.close();
    expect(log).not.toContain("BYPASSRLS");
  }, 60_000);
});
