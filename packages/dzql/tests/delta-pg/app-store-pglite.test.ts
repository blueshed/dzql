/**
 * `openStore`, the one way an app starts its store on Postgres: its migrations (a folder or a
 * list), the framework, then at `open()` its documents compiled and served -- in this process, or on
 * the socket it is given -- and `close()` the listener, then the pool.
 */
import { describe, expect, test } from "bun:test";
import { createLocal } from "@blueshed/delta/local";
import { setLogLevel } from "@blueshed/delta/logger";
import { createTable } from "@blueshed/delta/migrations";
import { defineDoc, defineSchema, importTables, openStore } from "../../src/postgres";

setLogLevel("silent");

const schema = defineSchema({ notes: { columns: { text: "text" } } });
const notes = defineDoc("notes:", { root: "notes", include: [] });
const history = [{ id: "001-notes", changes: [createTable("notes", { columns: { text: { type: "text", nullable: false } }, temporal: true })] }];

describe("openStore", () => {
  test("its migrations a list; its documents served on the socket it is given; seeded between; closed", async () => {
    const socket = createLocal(); // a WsServer, as createWs() is, with a caller to ask it
    const store = await openStore({ schema, database: undefined, migrations: { list: history, app: "notes", schema }, ws: socket.server });
    store.register([notes]);
    await store.open(async () => void (await importTables(store.pool, schema, { tables: { notes: [{ id: 1, text: "first" }] } })));
    expect((await socket.call("open", { doc: "notes:" })).result.notes).toMatchObject({ "1": { text: "first" } });
    expect((await store.delta.call("open", { doc: "notes:" })).result).toBeUndefined(); // served on the socket, not in this process
    expect((await store.pool.query("SELECT id FROM delta_migrations WHERE app = 'notes'")).rows).toEqual([{ id: "001-notes" }]);
    await store.close();
    await expect(store.pool.query("SELECT 1")).rejects.toThrow();
  });

  test("without a socket, served in this process; a folder of migrations not there runs none", async () => {
    const store = await openStore({ schema, migrations: { dir: `${import.meta.dir}/no-such-folder` } });
    store.register([notes]);
    await store.open();
    expect((await store.delta.call("open", { doc: "notes:" })).result.notes).toEqual({});
    expect((await store.pool.query("SELECT 1 FROM pg_tables WHERE tablename = 'delta_migrations'")).rowCount).toBe(0);
    await store.close();
  });
});
