/**
 * The migration fence (todo #98): a migration makes the app's ledger entries before it not
 * undoable. They are fenced ahead of the migration's own transaction, a batch at a time, and the
 * fence remembers how far it has gone (`_delta_fences`), so the transaction that alters the tables
 * reads only the entries written since, and the next migration only those after. On PGlite, through
 * openStore; the fence's wait for writes in flight, and a migration's lock_timeout, on a Postgres
 * server in postgres-open-skew.test.ts.
 */
import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { setLogLevel } from "@blueshed/delta/logger";
import { createTable } from "@blueshed/delta/migrations";
import { defineDoc, defineSchema, openStore } from "../../src/postgres";

setLogLevel("silent");

const schema = defineSchema({ notes: { columns: { text: "text" }, temporal: false } });
const notes = defineDoc("notes:", { root: "notes", include: [] });
const first = { id: "001-notes", changes: [createTable("notes", { columns: { text: { type: "text" } }, temporal: false })] };

const folder = mkdtempSync(`${tmpdir()}/fence-`);
afterAll(() => rmSync(folder, { recursive: true, force: true }));

test("the entries before a migration are fenced ahead of its transaction, and the next fence reads on from where it stopped", async () => {
  /** What each migration's `up` saw of the ledger, inside its own transaction: the entries still undoable. */
  const seen: number[] = [];
  const looks = (id: string) => ({ id, up: async (tx: any) => void seen.push(Number((await tx.query("SELECT count(*) FILTER (WHERE undoable) AS n FROM _delta_ledger")).rows[0].n)) });
  const store = (list: unknown[]) => {
    const s = openStore({ schema, database: folder, migrations: { list: list as any, app: "notes", schema } });
    s.register([notes]);
    return s;
  };
  const write = async (s: ReturnType<typeof store>, text: string) =>
    expect((await s.owner.call("delta", { doc: "notes:", cursor: "ada", ops: [{ op: "add", path: "/notes/-", value: { text } }] })).error).toBeUndefined();
  const through = async (s: ReturnType<typeof store>) => (await s.pool.query("SELECT through::int AS n FROM _delta_fences WHERE app = 'notes'")).rows[0]?.n;

  const v1 = store([first]);
  await v1.open();
  for (const text of ["one", "two", "three"]) await write(v1, text);
  await v1.close();

  const v2 = store([first, looks("002-look")]);
  await v2.open();
  expect(seen).toEqual([0]); // fenced before the migration's transaction began
  expect(await through(v2)).toBe(3);
  expect((await v2.owner.call("undo", { cursor: "ada" })).result).toBeNull(); // the fence: nothing to walk
  for (const text of ["four", "five"]) await write(v2, text);
  await v2.close();

  const v3 = store([first, looks("002-look"), looks("003-look")]);
  await v3.open();
  expect(seen).toEqual([0, 0]);
  expect(await through(v3)).toBe(5);
  expect((await v3.pool.query("SELECT count(*)::int AS n FROM _delta_ledger WHERE undoable")).rows[0].n).toBe(0);
  await write(v3, "six"); // after the migration: undoable
  expect((await v3.owner.call("undo", { cursor: "ada" })).result).toMatchObject({ doc: "notes:" });
  await v3.close();
}, 120_000);
