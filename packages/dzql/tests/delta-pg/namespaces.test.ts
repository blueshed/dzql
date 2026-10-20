/**
 * Several apps on one database, a Postgres schema each (todo #29): each app's tables, ledger and
 * compiled functions in its own schema, its changes told on its own channel (`delta:<schema>`;
 * `public` keeps `delta_changes`). Two apps with the same definitions -- one table name, one
 * document name -- each write, each undo, and each is told only its own. In this process (one
 * PGlite, a pool per schema on it), and on the suite's server through `openStore`, where each
 * listener's LISTEN is a connection of its own.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Pool } from "pg";
import { PGlite } from "@electric-sql/pglite";
import { createLocal } from "@blueshed/delta/local";
import { setLogLevel } from "@blueshed/delta/logger";
import {
  applyFramework, applySql, createDocListener, defineDoc, defineSchema, docTypeFromDef, generateSql, openStore,
} from "../../src/postgres";
import { pglitePool } from "../../src/postgres/pglite";
import { quietOn } from "../helpers/pglite";
import { PG_URL } from "./setup";

setLogLevel("silent");

// both apps are made from these: the same table, the same document name
const schema = defineSchema({ ns_items: { columns: { name: "text" }, temporal: false } });
const docs = [defineDoc("items:", { root: "ns_items", include: [] })];

type App = { local: ReturnType<typeof createLocal>; heard: { channel: string; data: any }[]; pool: Pool };
const listen = (app: App) => app.local.onPublish((channel, data) => app.heard.push({ channel, data }));
const add = (app: App, name: string) => app.local.call("delta", { doc: "items:", ops: [{ op: "add", path: "/ns_items/-", value: { name } }], cursor: "c1" });
/** What each told change added, by name. */
const names = (app: App) => app.heard.flatMap(({ data }) => data.ops.filter((op: any) => op.op === "add").map((op: any) => op.value.name));

/** Two apps writing and undoing, each told only its own; `quiet` waits until what was set going is heard. */
async function twoApps(a: App, b: App, quiet: () => Promise<void>) {
  expect((await a.local.call("open", { doc: "items:" })).result).toMatchObject({ ns_items: {} });
  expect((await b.local.call("open", { doc: "items:" })).result).toMatchObject({ ns_items: {} });

  expect((await add(a, "one of a's")).error).toBeUndefined();
  expect((await add(b, "one of b's")).error).toBeUndefined();
  expect((await add(a, "another of a's")).error).toBeUndefined();
  await quiet();
  expect(names(a)).toEqual(["one of a's", "another of a's"]);
  expect(a.heard.map((h) => h.channel)).toEqual(["items:", "items:"]);
  expect(names(b)).toEqual(["one of b's"]);

  // each undoes its own last write: a's undo is told to a alone, and b's to b
  expect((await a.local.call("undo", { cursor: "c1" })).error).toBeUndefined();
  expect((await b.local.call("undo", { cursor: "c1" })).error).toBeUndefined();
  await quiet();
  expect(a.heard).toHaveLength(3);
  expect(a.heard[2]!.data.ops).toEqual([{ op: "remove", path: "/ns_items/2" }]);
  expect(b.heard).toHaveLength(2);
  expect(b.heard[1]!.data.ops).toEqual([{ op: "remove", path: "/ns_items/1" }]);

  // the rows, the ledger and the log are each app's own, in its own schema
  const rows = async (app: App) => (await app.pool.query("SELECT name FROM ns_items ORDER BY id")).rows.map((r) => r.name);
  expect(await rows(a)).toEqual(["one of a's"]);
  expect(await rows(b)).toEqual([]);
  expect((await a.pool.query("SELECT count(*)::int AS n FROM _delta_ledger")).rows[0].n).toBe(3);   // two writes and an undo
  expect((await b.pool.query("SELECT count(*)::int AS n FROM _delta_ledger")).rows[0].n).toBe(2);
  expect((await a.local.call("open", { doc: "items:" })).result.ns_items).toEqual({ "1": { id: 1, name: "one of a's" } });
  expect((await b.local.call("open", { doc: "items:" })).result.ns_items).toEqual({});
  expect((await a.pool.query("SELECT _delta_channel() AS c, current_schema() AS s")).rows[0]).toEqual({ c: "delta:app_a", s: "app_a" });
}

describe("PGlite: two apps in two schemas of one database", () => {
  let db: PGlite;
  const apps: App[] = [];
  const listeners: { destroy(): Promise<void> }[] = [];
  const publicHeard: string[] = [];

  beforeAll(async () => {
    db = await PGlite.create();
    for (const namespace of ["app_a", "app_b"]) {
      const pool = pglitePool(db, { namespace });
      await applyFramework(pool, { namespace });
      await applySql(pool, generateSql(schema, docs), { namespace });
      const app: App = { local: createLocal(), heard: [], pool };
      listen(app);
      listeners.push(await createDocListener(app.local.server, pool, { types: docs.map((def) => docTypeFromDef(def, pool)), ledger: true, namespace }));
      apps.push(app);
    }
    await db.listen("delta_changes", (payload) => publicHeard.push(payload));   // public's channel: nothing of theirs
  }, 30_000);
  afterAll(async () => { for (const l of listeners) await l.destroy(); await db.close(); });

  test("each writes and undoes, and is told only its own", async () => {
    await twoApps(apps[0]!, apps[1]!, async () => { await quietOn(apps[0]!.pool, apps[0]!.heard); await quietOn(apps[1]!.pool, apps[1]!.heard); });
    expect(publicHeard).toEqual([]);
    expect((await db.query("SELECT to_regclass('public.ns_items') AS t")).rows).toEqual([{ t: null }]);
  });

  test("a listener given a schema its pool does not run in is refused, naming both", async () => {
    const elsewhere = pglitePool(db);   // the session's own path: public
    await expect(createDocListener(createLocal().server, elsewhere, { namespace: "app_a" })).rejects.toThrow(/runs in schema public, not app_a/);
    expect(() => pglitePool(db, { namespace: "App A" })).toThrow(/not a schema dzql can keep an app in/);
  });
});

describe("a Postgres server: two apps in two schemas of one database, through openStore", () => {
  let admin: Pool;
  const stores: Awaited<ReturnType<typeof openStore>>[] = [];
  const publicHeard: string[] = [];
  let publicListener: import("pg").PoolClient;
  const drop = () => admin.query("DROP SCHEMA IF EXISTS app_a CASCADE; DROP SCHEMA IF EXISTS app_b CASCADE");

  beforeAll(async () => {
    admin = new Pool({ connectionString: PG_URL, max: 2 });
    await drop();
    publicListener = await admin.connect();
    await publicListener.query("LISTEN delta_changes");
    publicListener.on("notification", (msg) => publicHeard.push(msg.payload ?? ""));
    for (const namespace of ["app_a", "app_b"]) {
      const store = await openStore({ schema, database: PG_URL, namespace });
      store.register(docs);
      await store.open();
      stores.push(store);
    }
  }, 30_000);
  afterAll(async () => {
    for (const store of stores) await store.close();
    publicListener.release();
    await drop();
    await admin.end();
  });

  test("each writes and undoes, and is told only its own", async () => {
    const apps = stores.map((store) => { const app: App = { local: store.delta, heard: [], pool: store.pool }; listen(app); return app; });
    const settle = () => new Promise<void>((r) => setTimeout(r, 300));
    await twoApps(apps[0]!, apps[1]!, settle);
    expect(publicHeard).toEqual([]);
  });

  test("each listener is alive by a lock of its own schema's: one app's holder never keeps another's names held", async () => {
    // both are holder 1, each of its own schema's ids; the lock each holds is keyed by its schema
    const lock = async (pool: Pool) => (await pool.query(`SELECT _delta_held_lock() AS key, EXISTS (SELECT 1 FROM pg_locks WHERE locktype = 'advisory' AND granted
      AND objsubid = 2 AND objid = 1 AND classid = _delta_held_lock()::oid) AS held`)).rows[0];
    const [a, b] = [await lock(stores[0]!.pool), await lock(stores[1]!.pool)];
    expect(a.held && b.held).toBe(true);
    expect(new Set([a.key, b.key, (await admin.query("SELECT hashtext('_delta_held') AS key")).rows[0].key]).size).toBe(3);
  });
});
