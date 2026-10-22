/**
 * What `openStore` applies as it opens (todo #86, #87): the framework and the compiled documents
 * together, in one transaction, and only when they are not the database's already. A second open of
 * an unchanged app runs no DDL; a migration that ran, or the framework applied again by hand, has
 * the set applied again; and an older set (`applyCompiled`) never replaces a newer one unless it is
 * a rollback. On PGlite, one process's, a store's own set is always applied. On a Postgres server:
 * postgres-open-skew.test.ts (writes during a second open, a v1 restarting beside v2, the lock_timeout).
 */
import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { setLogLevel } from "@blueshed/delta/logger";
import { createTable } from "@blueshed/delta/migrations";
import { applyFramework, defineDoc, defineSchema, generateSql, openStore } from "../../src/postgres";
import { applyCompiled } from "../../src/postgres/bootstrap";
import { openPglite } from "../../src/postgres/pglite";

setLogLevel("silent");

const schema = defineSchema({ notes: { columns: { text: "text" }, temporal: false } });
const notes = defineDoc("notes:", { root: "notes", include: [] });
const history = [{ id: "001-notes", changes: [createTable("notes", { columns: { text: { type: "text" } }, temporal: false })] }];

/** The transaction that last made `delta_apply` (a CREATE OR REPLACE makes it again), and the sets the database has had. */
async function made(pool: { query: (sql: string) => Promise<{ rows: any[] }> }) {
  const fn = (await pool.query("SELECT xmin::text AS x FROM pg_proc WHERE proname = 'delta_apply' ORDER BY oid LIMIT 1")).rows[0]?.x;
  const sets = (await pool.query("SELECT generation::int AS generation, doc_types FROM _delta_compiled ORDER BY generation")).rows;
  return { fn, sets };
}

const folders: string[] = [];
const folder = () => { const f = mkdtempSync(`${tmpdir()}/compiled-`); folders.push(f); return f; };
afterAll(() => { for (const f of folders) rmSync(f, { recursive: true, force: true }); });

describe("openStore applies the framework and its documents once", () => {
  test("a second open of an unchanged app runs no DDL: the functions are the first open's, and the set is recorded once", async () => {
    const database = folder();
    const store = openStore({ schema, database, migrations: { list: history, app: "notes", schema } });
    store.register([notes]);
    await store.open();
    const first = await made(store.pool);
    expect(first.sets).toEqual([{ generation: 1, doc_types: ["notes:"] }]);
    await store.close();
    await store.open();
    expect(await made(store.pool)).toEqual(first);
    expect((await store.delta.call("open", { doc: "notes:" })).result).toMatchObject({ notes: {} });
    await store.close();
  }, 60_000);

  test("a migration that ran has the set applied again, though the definitions are the same", async () => {
    const database = folder();
    const store = (list: typeof history) => {
      const s = openStore({ schema, database, migrations: { list, app: "notes", schema } });
      s.register([notes]);
      return s;
    };
    const before = store(history);
    await before.open();
    const first = await made(before.pool);
    await before.close();
    // data only: the tables and definitions as they were
    const after = store([...history, { id: "002-a-row", up: async (tx: any) => void (await tx.query("INSERT INTO notes (id, text) VALUES (7, 'by hand')")) }] as typeof history);
    await after.open();
    const second = await made(after.pool);
    expect(second.fn).not.toEqual(first.fn);
    expect(second.sets).toEqual(first.sets); // the same set, applied again: no new generation
    await after.close();
  }, 60_000);

  test("the framework applied again by hand (its uncompiled forms) has the next open apply the set again", async () => {
    const database = folder();
    const store = openStore({ schema, database });
    store.register([notes]);
    await store.open();
    await applyFramework(store.pool); // as `dzql init --upgrade`'s files would: no document compiled now
    await expect(store.pool.query("SELECT delta_open('notes:')")).rejects.toThrow("no doc def");
    await store.close();
    await store.open();
    expect((await store.delta.call("open", { doc: "notes:" })).result).toMatchObject({ notes: {} });
    await store.close();
  }, 60_000);

  test("on PGlite, one process's, the store's own set is always applied: an app moved back a branch has its own documents", async () => {
    const database = folder();
    const boards = defineSchema({ ...schema.tables, boards: { columns: { title: "text" }, temporal: false } } as any);
    const wider = openStore({ schema: boards, database });
    wider.register([notes, defineDoc("boards:", { root: "boards", include: [] })]);
    await wider.open();
    await wider.close();
    const narrower = openStore({ schema, database });
    narrower.register([notes]);
    await narrower.open();
    expect((await made(narrower.pool)).sets.map((s: any) => s.doc_types)).toEqual([["notes:", "boards:"], ["notes:"]]);
    await narrower.close();
  }, 60_000);
});

describe("applyCompiled: an older set never replaces a newer one", () => {
  const v1 = { schema: defineSchema({ boards: { columns: { title: "text" }, temporal: false } }), docs: [defineDoc("boards:", { root: "boards", include: [] })] };
  const v2 = {
    schema: defineSchema({ boards: { columns: { title: "text" }, temporal: false }, cards: { columns: { text: "text" }, temporal: false } }),
    docs: [...v1.docs, defineDoc("cards:", { root: "cards", include: [] })],
  };
  const apply = (pool: any, v: typeof v1, opts: { rollback?: boolean } = {}) =>
    applyCompiled(pool, generateSql(v.schema, v.docs), { docTypes: v.docs.map((d) => d.prefix), ...opts });

  test("v1, then v2, then v1 again: v1 is not put back, and v2's documents still open; a rollback puts it back, as the newest", async () => {
    const pool = await openPglite();
    try {
      expect(await apply(pool, v1)).toMatchObject({ applied: true, set: { generation: 1, docTypes: ["boards:"] } });
      expect(await apply(pool, v2)).toMatchObject({ applied: true, set: { generation: 2, docTypes: ["boards:", "cards:"] } });
      expect(await apply(pool, v2)).toMatchObject({ applied: false, why: "current", set: { generation: 2 } });
      expect(await apply(pool, v1)).toMatchObject({ applied: false, why: "older", set: { generation: 1 }, newer: { generation: 2, docTypes: ["boards:", "cards:"] } });
      expect((await pool.query("SELECT delta_open('cards:') AS doc")).rows[0].doc).toMatchObject({ cards: {} });
      expect(await apply(pool, v1, { rollback: true })).toMatchObject({ applied: true, set: { generation: 3, docTypes: ["boards:"] } });
      await expect(pool.query("SELECT delta_open('cards:')")).rejects.toThrow("no doc def");
    } finally {
      await pool.end();
    }
  }, 60_000);
});
