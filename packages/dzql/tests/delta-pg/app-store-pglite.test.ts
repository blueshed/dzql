/**
 * `openStore`, the one way an app starts its store on Postgres: said as the app loads, opened by a
 * server as it starts -- its migrations (a folder or a list), the framework, its documents compiled
 * and served, in this process and on the socket it is given -- and closed as the server stops, the
 * listener, then the pool; opened again after, as the next server (or `bun --hot`) opens it.
 */
import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { createLocal } from "@blueshed/delta/local";
import { setLogLevel } from "@blueshed/delta/logger";
import { createTable } from "@blueshed/delta/migrations";
import { defineDoc, defineSchema, importTables, openStore } from "../../src/postgres";

setLogLevel("silent");

const schema = defineSchema({ notes: { columns: { text: "text" } } });
const notes = defineDoc("notes:", { root: "notes", include: [] });
const history = [{ id: "001-notes", changes: [createTable("notes", { columns: { text: { type: "text", nullable: false } }, temporal: true })] }];

describe("openStore", () => {
  test("its migrations a list; its documents served on the socket it is given, and in this process; seeded between; closed", async () => {
    const socket = createLocal(); // a WsServer, as createWs() is, with a caller to ask it
    const store = openStore({ schema, database: ":memory:", migrations: { list: history, app: "notes", schema }, ws: socket.server, prepare: async (pool) => void (await importTables(pool, schema, { tables: { notes: [{ id: 1, text: "first" }] } })) });
    store.register([notes]);
    await expect(store.pool.query("SELECT 1")).rejects.toThrow("The store is not open"); // said, not opened
    await store.open();
    expect((await socket.call("open", { doc: "notes:" })).result.notes).toMatchObject({ "1": { text: "first" } });
    // the server's own write, in this process, is told on the socket as a page's is
    const told: unknown[] = [];
    socket.onPublish((doc, change) => told.push([doc, change.ops]));
    expect((await store.owner.call("delta", { doc: "notes:", ops: [{ op: "add", path: "/notes/-", value: { text: "second" } }] })).error).toBeUndefined();
    for (let i = 0; i < 20 && !told.length; i++) await store.pool.query("SELECT 1");
    expect(told).toEqual([["notes:", [{ op: "add", path: "/notes/2", value: expect.objectContaining({ id: 2, text: "second" }) }]]]);
    expect(Object.keys((await store.delta.call("open", { doc: "notes:" })).result.notes)).toEqual(["1", "2"]); // in this process too
    expect((await store.pool.query("SELECT id FROM delta_migrations WHERE app = 'notes'")).rows).toEqual([{ id: "001-notes" }]);
    await store.close();
    await expect(store.pool.query("SELECT 1")).rejects.toThrow("The store is not open");
    expect(() => store.last()).toThrow("The store is not open");
  });

  test("several schemas, each a resource's, are one store's tables; a table two of them declare is refused as the store is said", async () => {
    const said = defineSchema({ messages: { columns: { text: { type: "text", default: "Hello" } }, temporal: false } });
    const store = openStore({ database: ":memory:", schema: [schema, said] });
    store.register([notes, defineDoc("message:", { root: "messages", include: [], implied: true })]);
    await store.open();
    expect((await store.delta.call("open", { doc: "message:1" })).result.messages).toMatchObject({ text: "Hello" });
    expect((await store.delta.call("open", { doc: "notes:" })).result.notes).toEqual({});
    await store.close();
    expect(() => openStore({ schema: [schema, defineSchema({ notes: { columns: {} } })] })).toThrow("Two schemas both declare the table notes");
  });

  test("without a socket, served in this process; a folder of migrations not there runs none", async () => {
    const store = openStore({ database: ":memory:", schema, migrations: { dir: `${import.meta.dir}/no-such-folder` } });
    store.register([notes]);
    await store.open();
    expect((await store.delta.call("open", { doc: "notes:" })).result.notes).toEqual({});
    expect((await store.pool.query("SELECT 1 FROM pg_tables WHERE tablename = 'delta_migrations'")).rowCount).toBe(0);
    await store.close();
  });

  test("closed, and opened again on its folder, its documents are served once more, by the new listener alone, and its ids carry on", async () => {
    const folder = mkdtempSync(`${tmpdir()}/app-store-`);
    try {
      const store = openStore({ schema, database: folder, migrations: { list: history, app: "notes", schema } });
      store.register([notes]);
      const ids: number[] = [];
      for (const text of ["first", "second"]) {
        await store.open();
        const { result } = await store.delta.call("delta", { doc: "notes:", ops: [{ op: "add", path: "/notes/-", value: { text } }], inverse: true });
        ids.push(Number(result.ops[0].value.id));
        await store.close(); // the listener ended answers nothing now: the next open's alone answers
      }
      expect(ids).toEqual([1, 2]); // closed cleanly, so no ids set aside are skipped
    } finally {
      rmSync(folder, { recursive: true, force: true });
    }
  });

  test("opened by two servers at once, it is closed by the second close; a close with none open does nothing", async () => {
    const store = openStore({ database: ":memory:", schema });
    store.register([notes]);
    await Promise.all([store.open(), store.open()]);
    await store.close();
    expect((await store.pool.query("SELECT 1 AS one")).rows).toEqual([{ one: 1 }]); // the other server holds it still
    await store.close();
    await expect(store.pool.query("SELECT 1")).rejects.toThrow("The store is not open");
    await store.close();
  });

  test("a write that is no list of ops, or holds one that is no op, is refused as delta's SQLite refuses it: 400, in its words", async () => {
    const store = openStore({ database: ":memory:", schema });
    store.register([notes]);
    await store.open();
    expect((await store.delta.call("delta", { doc: "notes:", ops: "not ops" })).error).toEqual({ code: 400, message: "ops must be an array" });
    expect((await store.delta.call("delta", { doc: "notes:", ops: [null] })).error).toEqual({ code: 400, message: "An op is an object: { op, path, value }" });
    await store.close();
  });

  test("everything it does to the database as it opens is in its own turn, an advisory lock, let go once it is open", async () => {
    // the lock as pg_locks lists it: a key's high half in classid, its low half in objid
    const held = (pool: { query: (sql: string) => Promise<{ rows: any[] }> }) => pool.query(`SELECT EXISTS (SELECT 1 FROM pg_locks WHERE locktype = 'advisory' AND granted AND objsubid = 1
      AND ((classid::bigint << 32) | objid::bigint) = hashtext('dzql_open:' || current_schema())::bigint) AS held`).then((r) => r.rows[0].held);
    let during: boolean | undefined;
    const store = openStore({ database: ":memory:", schema, prepare: async (pool) => void (during = await held(pool)) });
    store.register([notes]);
    await store.open();
    try {
      expect(during).toBe(true); // the seed in the turn, so a second server's finds the first's rows
      expect(await held(store.pool)).toBe(false);
    } finally {
      await store.close();
    }
  });

  test("an open that fails leaves it closed, and the next open tries again", async () => {
    let failing = true;
    const store = openStore({ database: ":memory:", schema, prepare: () => { if (failing) throw new Error("the seed failed"); } });
    store.register([notes]);
    await expect(store.open()).rejects.toThrow("the seed failed");
    await expect(store.pool.query("SELECT 1")).rejects.toThrow("The store is not open");
    failing = false;
    await store.open();
    expect((await store.delta.call("open", { doc: "notes:" })).result.notes).toEqual({});
    await store.close();
  });
});
