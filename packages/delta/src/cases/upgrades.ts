/**
 * An app upgraded on a database that holds data, as every backend answers it: SQLite's in delta,
 * Postgres's in dzql. Two families over one adapter (`UpgradeBackend`, a `MigrationBackend` with an
 * app served over it):
 *
 * - `schemaContractCases`: the schema is the contract. delta sees only what the schema declares:
 *   reads, writes, inverses and undo use the declared columns (and the id, the parent key, a
 *   temporal row's validity). A database may hold more -- a migration ahead of this version --
 *   never less: at start-up `migrate`, then what the schema declares is made. So an upgrade can
 *   expand and contract with two versions of the app on one database.
 * - `upgradeCases`: migrations, the changes a schema cannot say, run once each, in order, at
 *   start-up, before the schema adds what it declares; and undo never walks back across them.
 *
 *   upgradeCases("sqlite", backend);
 *   schemaContractCases("sqlite", backend);
 */
import { describe, expect, test } from "bun:test";
import { defineDoc, defineSchema, type DocDef, type Schema } from "../schema";
import { fromFolder, type MigrateOptions, type MigrateResult, type Migration, type MigrationStatus } from "../server/migrate";
import type { Local } from "../server/local";
import type { MigrationBackend } from "./migrations";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** A backend as the upgrade cases ask it: a database each `open`, the migrations run on it, and an app served over it. */
export interface UpgradeBackend<H> extends MigrationBackend<H> {
  status(h: H, list: Migration[], options?: MigrateOptions): Promise<MigrationStatus>;
  /** An app of `schema` on `h`, serving `docs` with the ledger, in process. */
  serve(h: H, schema: Schema, docs: DocDef[]): Promise<Local>;
  /** Another app beside it, its own tables made and served with the ledger (SQLite: the same file; Postgres: a database of its own). */
  beside(h: H, schema: Schema, docs: DocDef[]): Promise<Local>;
  /** The table's columns as `name:type`, the type in lower case, sorted. */
  columnTypes(h: H, table: string): Promise<string[]>;
  /** The views on the database, by name. */
  views(h: H): Promise<string[]>;
  /** What a migration's `up` changes a table with, on the transaction it is given. */
  tools: {
    renameColumn(tx: unknown, table: string, from: string, to: string): void | Promise<void>;
    dropColumn(tx: unknown, table: string, column: string): void | Promise<void>;
    renameTable(tx: unknown, from: string, to: string): void | Promise<void>;
  };
}

const SLOW = 30_000;

/** A version's start-up: its migrations, then what its schema declares. */
async function start<H>(b: UpgradeBackend<H>, h: H, schema: Schema, list: Migration[], docs = [team]): Promise<MigrateResult> {
  const result = await b.migrate(h, list);
  await b.makeTables(h, schema, docs);
  return result;
}

const team = defineDoc("team:", { root: "teams", include: ["people"], implied: true });
const teams = { columns: {}, temporal: false } as const;

/** The team's people as an app opens them, without ids, in the order `by` gives. */
const people = async (local: Local, by: (row: any) => string | number = (r) => r.id) =>
  Object.values((await local.call("open", { doc: "team:1" })).result.people as Record<string, any>)
    .toSorted((a, b) => { const [x, y] = [by(a), by(b)]; return x < y ? -1 : x > y ? 1 : 0; })
    .map(({ id: _id, teams_id: _t, ...row }) => row);

/** A write through the team, answered. */
const write = async (local: Local, cursor: string, ops: any[]) => {
  const answer = await local.call("delta", { doc: "team:1", ops, cursor });
  expect(answer.error).toBeUndefined();
  return answer.result;
};

// ---------------------------------------------------------------------------
// The schema is the contract
// ---------------------------------------------------------------------------

// the app, version by version: v2 adds an email beside the phone, v3 has only the email
const v1 = defineSchema({ teams, people: { parent: "teams", columns: { name: "text", phone: "text?" } } });
const v2 = defineSchema({ teams, people: { parent: "teams", columns: { name: "text", phone: "text?", email: { type: "text", default: "" } } } });
const v3 = defineSchema({ teams, people: { parent: "teams", columns: { name: "text", email: { type: "text", default: "" } } } });

export function schemaContractCases<H>(name: string, b: UpgradeBackend<H>): void {
  /** The expand: email, a NOT NULL column with a default, copied from the phone; the contract: the phone dropped. */
  const expand: Migration = { id: "001-email", up: async (tx) => { await b.run(tx, "ALTER TABLE people ADD COLUMN email TEXT NOT NULL DEFAULT ''"); await b.run(tx, "UPDATE people SET email = phone || '@sms' WHERE phone IS NOT NULL"); } };
  const contract: Migration = { id: "002-no-phone", up: (tx) => b.tools.dropColumn(tx, "people", "phone") };
  const serve = (h: H, schema: Schema) => b.serve(h, schema, [team]);
  const newest = async (local: Local) => {
    const { result } = await local.call("open", { doc: "team:1" });
    return `/people/${Math.max(...Object.values(result.people as Record<string, any>).map((r) => r.id))}`;
  };

  describe(`${name}: the schema is the contract`, () => {
    test("a column the schema does not declare is not seen: not read, not written, and a row removed and undone comes back", async () => {
      const h = await b.open();
      await start(b, h, v1, []);
      await b.query(h, "ALTER TABLE people ADD COLUMN reason TEXT NOT NULL DEFAULT 'later'");   // a later version's, ahead of this one
      const app = await serve(h, v1);
      await app.call("open", { doc: "team:1" });
      const made = await write(app, "ada", [{ op: "add", path: "/people/-", value: { name: "Ada" } }]);
      expect(made.ops[0].value).not.toHaveProperty("reason");
      const path = made.ops[0].path;
      await write(app, "ada", [{ op: "replace", path: `${path}/name`, value: "Ada L" }]);
      const removed = await write(app, "ada", [{ op: "remove", path }]);
      expect(removed.inverse[0].value).not.toHaveProperty("reason");

      const undone = await app.call("undo", { cursor: "ada" });
      expect(undone.error).toBeUndefined();
      expect(await people(app)).toEqual([{ name: "Ada L", phone: null }]);
      // never read, never written: the column took its own default, row and version alike
      expect((await b.query(h, "SELECT reason FROM people")).map((r) => r.reason)).toEqual(["later", "later", "later"]);
    }, SLOW);

    test("a column the schema declares that the database does not have is added at start-up", async () => {
      const h = await b.open();
      await start(b, h, v1, []);
      const app = await serve(h, v1);
      await app.call("open", { doc: "team:1" });
      await write(app, "ada", [{ op: "add", path: "/people/-", value: { name: "Ada", phone: "555" } }]);

      await start(b, h, v2, []);   // v2 declares the email; no migration says so
      expect(await b.columns(h, "people")).toContain("email");
      const next = await serve(h, v2);
      expect(await people(next)).toEqual([{ name: "Ada", phone: "555", email: "" }]);
      await next.call("open", { doc: "team:1" });
      await write(next, "ada", [{ op: "add", path: "/people/-", value: { name: "Bob", email: "bob@x" } }]);
      expect((await people(next))[1]).toEqual({ name: "Bob", phone: null, email: "bob@x" });
    }, SLOW);

    test("expand, then contract: two versions on one database, every step keeps the data and each version's writes and undo work", async () => {
      const h = await b.open();
      await start(b, h, v1, []);
      const old = await serve(h, v1);
      await old.call("open", { doc: "team:1" });
      const ada = (await write(old, "ada", [{ op: "add", path: "/people/-", value: { name: "Ada", phone: "555" } }])).ops[0].path;

      // 1. expand: a migration adds the email while v1 runs, blind to it
      await b.migrate(h, [expand]);
      const bob = (await write(old, "bob", [{ op: "add", path: "/people/-", value: { name: "Bob" } }])).ops[0].path;   // NOT NULL: its default
      await write(old, "ada", [{ op: "replace", path: `${ada}/name`, value: "Ada L" }]);
      expect(await people(old)).toEqual([{ name: "Ada L", phone: "555" }, { name: "Bob", phone: null }]);
      expect((await b.query(h, "SELECT email FROM people WHERE valid_to IS NULL ORDER BY id")).map((r) => r.email)).toEqual(["555@sms", ""]);

      // 2. v2 starts beside v1 and uses the email; v1 writes on, and keeps what v2 wrote
      await start(b, h, v2, [expand]);
      const next = await serve(h, v2);
      await next.call("open", { doc: "team:1" });
      await write(next, "bob", [{ op: "replace", path: `${bob}/email`, value: "bob@x" }]);
      await write(old, "bob", [{ op: "replace", path: `${bob}/name`, value: "Robert" }]);
      expect(await people(next)).toEqual([{ name: "Ada L", phone: "555", email: "555@sms" }, { name: "Robert", phone: null, email: "bob@x" }]);
      expect((await old.call("undo", { cursor: "bob" })).error).toBeUndefined();   // v1 undoes its own write; v2's email stays
      expect((await people(next))[1]).toEqual({ name: "Bob", phone: null, email: "bob@x" });
      // v1 removes Bob and undoes it: the row comes back as it was stored, v2's email and all
      await write(old, "bob", [{ op: "remove", path: bob }]);
      const back = await old.call("undo", { cursor: "bob" });
      expect(back.error).toBeUndefined();
      expect(back.result.ops[0].value).not.toHaveProperty("email");   // what v1 is told is what v1 declares
      expect((await people(next))[1]).toEqual({ name: "Bob", phone: null, email: "bob@x" });
      // v1 replaces Ada whole: the row is what v1 declares, and v2's email is not v1's to blank
      await write(old, "ada", [{ op: "replace", path: ada, value: { name: "Ada L", phone: "556" } }]);
      expect((await people(next))[0]).toEqual({ name: "Ada L", phone: "556", email: "555@sms" });
      expect(await people(old)).toEqual([{ name: "Ada L", phone: "556" }, { name: "Bob", phone: null }]);   // v1 never sees the email
      // v1 starts again beside v2 (a rollback begun): it makes what it declares, and v2 writes on, email and all
      await start(b, h, v1, [expand]);
      await write(next, "ada", [{ op: "replace", path: `${ada}/email`, value: "ada@x" }]);
      await write(next, "ada", [{ op: "add", path: "/people/-", value: { name: "Cy", email: "cy@x" } }]);
      expect((await people(next)).slice(-1)).toEqual([{ name: "Cy", phone: null, email: "cy@x" }]);
      expect((await people(old)).slice(-1)).toEqual([{ name: "Cy", phone: null }]);
      await write(next, "ada", [{ op: "remove", path: await newest(next) }]);

      // 3. contract: v1 is stopped, and with no running version declaring the phone, a migration drops it; v3 starts
      await start(b, h, v3, [expand, contract]);
      expect(await b.columns(h, "people")).not.toContain("phone");
      const last = await serve(h, v3);
      expect(await people(last)).toEqual([{ name: "Ada L", email: "ada@x" }, { name: "Bob", email: "bob@x" }]);
      await last.call("open", { doc: "team:1" });
      expect((await last.call("undo", { cursor: "bob" })).result).toBeNull();   // nothing walks back across the contract
      await write(last, "ada", [{ op: "replace", path: `${ada}/email`, value: "ada@lovelace" }]);
      expect((await last.call("undo", { cursor: "ada" })).error).toBeUndefined();
      expect((await people(last))[0]).toEqual({ name: "Ada L", email: "ada@x" });
    }, SLOW);
  });
}

// ---------------------------------------------------------------------------
// Migrations, on a database an app has lived in
// ---------------------------------------------------------------------------

const before = defineSchema({
  teams,
  people: { parent: "teams", columns: { name: "text", phone: "text?", fax: "text?" } },   // temporal, by default
});
const after = defineSchema({
  teams,
  people: { parent: "teams", columns: { full_name: "text", phone: "text?", email: "text?" } },
});

export function upgradeCases<H>(name: string, b: UpgradeBackend<H>): void {
  /** The story's migrations, each saying it ran into `ran`. */
  const story = (ran: string[]): Migration[] => [
    { id: "001-name-is-full-name", up: async (tx) => { ran.push("001"); await b.tools.renameColumn(tx, "people", "name", "full_name"); } },
    { id: "002-fax-into-phone", up: async (tx) => { ran.push("002"); await b.run(tx, "UPDATE people SET phone = fax WHERE phone IS NULL"); } },
    { id: "003-no-fax", up: async (tx) => { ran.push("003"); await b.tools.dropColumn(tx, "people", "fax"); } },
  ];
  /** A migration that fails part way, after a change. */
  const failing = (): Migration => ({ id: "004-breaks", up: async (tx) => { await b.run(tx, "UPDATE people SET phone = 'lost'"); await b.run(tx, "SELECT * FROM no_such_table"); } });
  const byName = (r: any) => String(r.full_name ?? r.name);

  /** The app before: two people, written through the ledger, Ada's name changed after. */
  async function lived(h: H) {
    await start(b, h, before, []);
    const v1 = await b.serve(h, before, [team]);
    await v1.call("open", { doc: "team:1" });
    const ada = await v1.call("delta", { doc: "team:1", ops: [{ op: "add", path: "/people/-", value: { name: "Ada", fax: "123" } }], cursor: "ada" });
    await v1.call("delta", { doc: "team:1", ops: [{ op: "add", path: "/people/-", value: { name: "Bob", phone: "555", fax: "999" } }], cursor: "bob" });
    await v1.call("delta", { doc: "team:1", ops: [{ op: "replace", path: `${ada.result.ops[0].path}/name`, value: "Ada L" }], cursor: "ada" });
    return { adaPath: ada.result.ops[0].path as string };
  }

  describe(`${name}: an upgrade on a database that holds data`, () => {
    test("an app's data survives an upgrade that adds a field, renames one, drops one and moves data from one to another; it runs once, in order, and a second start does nothing", async () => {
      const h = await b.open();
      await lived(h);
      const ran: string[] = [];
      const list = story(ran);
      expect((await b.status(h, list)).pending).toEqual(["001-name-is-full-name", "002-fax-into-phone", "003-no-fax"]);

      expect(await start(b, h, after, list)).toEqual({ ran: ["001-name-is-full-name", "002-fax-into-phone", "003-no-fax"], fresh: false, unknown: [] });
      expect(ran).toEqual(["001", "002", "003"]);
      expect(await people(await b.serve(h, after, [team]), byName)).toEqual([
        { full_name: "Ada L", phone: "123", email: null },
        { full_name: "Bob", phone: "555", email: null },
      ]);
      // every version of a row was carried, not only the live one
      expect((await b.query(h, "SELECT full_name FROM people ORDER BY valid_from")).map((r) => r.full_name)).toEqual(["Ada", "Bob", "Ada L"]);

      expect(await start(b, h, after, list)).toEqual({ ran: [], fresh: false, unknown: [] });
      expect(ran).toEqual(["001", "002", "003"]);
      const status = await b.status(h, list);
      expect(status.ran.map((r) => r.id)).toEqual(["001-name-is-full-name", "002-fax-into-phone", "003-no-fax"]);
      expect(status.pending).toEqual([]);
    }, SLOW);

    test("a fresh database and an upgraded one end with the same tables and columns: a new one records every migration and runs none", async () => {
      const upgraded = await b.open();
      await lived(upgraded);
      await start(b, upgraded, after, story([]));

      const fresh = await b.open();
      const ran: string[] = [];
      expect((await b.status(fresh, story(ran))).fresh).toBe(true);
      expect(await start(b, fresh, after, story(ran))).toEqual({ ran: [], fresh: true, unknown: [] });
      expect(ran).toEqual([]);
      expect((await b.status(fresh, story(ran))).pending).toEqual([]);

      for (const table of ["teams", "people"]) expect(await b.columnTypes(fresh, table)).toEqual(await b.columnTypes(upgraded, table));
      expect(await b.columnTypes(fresh, "people")).toContain("full_name:text");
      expect(await b.views(fresh)).toEqual(await b.views(upgraded));
    }, SLOW);

    test("a migration that fails is rolled back, stops the start and is named; the ones before it stay, and the next start goes on from it", async () => {
      const h = await b.open();
      await lived(h);
      const list = [...story([]), failing()];
      await expect(start(b, h, after, list)).rejects.toThrow(/migration 004-breaks failed, and was rolled back/);
      expect((await b.status(h, list)).pending).toEqual(["004-breaks"]);
      expect((await b.query(h, "SELECT phone FROM people WHERE valid_to IS NULL ORDER BY id")).map((r) => r.phone)).toEqual(["123", "555"]);
      expect(await start(b, h, after, story([]))).toEqual({ ran: [], fresh: false, unknown: [] });
    }, SLOW);

    test("an id recorded that the list no longer has is a warning, not an error", async () => {
      const h = await b.open();
      await lived(h);
      await start(b, h, after, story([]));
      expect(await start(b, h, after, story([]).slice(1))).toEqual({ ran: [], fresh: false, unknown: ["001-name-is-full-name"] });
      expect((await b.status(h, story([]).slice(1))).unknown).toEqual(["001-name-is-full-name"]);
    }, SLOW);

    test("undo never walks back across an upgrade: what was written before it answers nothing to undo, history still shows it, and a write after it undoes", async () => {
      const h = await b.open();
      const { adaPath } = await lived(h);
      await start(b, h, after, story([]));
      const v2 = await b.serve(h, after, [team]);
      await v2.call("open", { doc: "team:1" });

      const undo = await v2.call("undo", { cursor: "ada" });
      expect(undo.error).toBeUndefined();
      expect(undo.result).toBeNull();
      expect((await v2.call("redo", { cursor: "ada" })).result).toBeNull();
      const history = (await v2.call("history", { doc: "team:1" })).result;
      expect(history.length).toBe(3);
      expect(history.every((e: any) => e.undoable === false)).toBe(true);

      await v2.call("delta", { doc: "team:1", ops: [{ op: "replace", path: `${adaPath}/full_name`, value: "Ada Lovelace" }], cursor: "ada" });
      expect((await v2.call("undo", { cursor: "ada" })).error).toBeUndefined();
      expect((await people(v2, byName))[0]).toMatchObject({ full_name: "Ada L" });
      expect((await v2.call("undo", { cursor: "ada" })).result).toBeNull();   // the fence
    }, SLOW);

    test("a table renamed keeps its rows, its history, its current view and its serial", async () => {
      const h = await b.open();
      await lived(h);
      const renamed = defineSchema({
        teams,
        members: { parent: "teams", columns: { name: "text", phone: "text?", fax: "text?" } },
      });
      const members = defineDoc("team:", { root: "teams", include: ["members"], implied: true });
      await start(b, h, renamed, [{ id: "001-people-are-members", up: (tx) => b.tools.renameTable(tx, "people", "members") }], [members]);
      expect((await b.query(h, "SELECT name FROM current_members ORDER BY id")).map((r) => r.name)).toEqual(["Ada L", "Bob"]);
      expect((await b.query(h, "SELECT count(*) AS n FROM members")).map((r) => Number(r.n))).toEqual([3]);
      expect(await b.views(h)).toEqual(["current_members"]);
      // the next row follows on from the last, not from one
      const local = await b.serve(h, renamed, [members]);
      await local.call("open", { doc: "team:1" });
      const added = await local.call("delta", { doc: "team:1", ops: [{ op: "add", path: "/members/-", value: { name: "Cy" } }] });
      expect(added.result.ack).toBe(true);
      expect((await b.query(h, "SELECT name FROM current_members WHERE id = 3")).map((r) => r.name)).toEqual(["Cy"]);
    }, SLOW);

    test("two apps share a database: each has its own list, an id is one app's, and an app new to it runs none of its own", async () => {
      const h = await b.open();
      const chat = defineSchema({ rooms: { table: "chat_rooms", columns: { title: "text" }, temporal: false } });
      const leave = defineSchema({ requests: { table: "leave_requests", columns: { days: "integer" }, temporal: false } });
      await b.query(h, "CREATE TABLE chat_rooms (id INT PRIMARY KEY, name TEXT)");
      const ran: string[] = [];
      const step = (app: string, id: string, sql: string): Migration => ({
        id,
        up: async (tx) => { ran.push(`${app} ${id}`); await b.run(tx, sql); },
      });
      const chats = [step("chat", "001-x", "ALTER TABLE chat_rooms RENAME COLUMN name TO title")];
      const leaves = [step("leave", "001-x", "ALTER TABLE leave_requests RENAME COLUMN length TO days")];

      expect(await b.migrate(h, chats, { app: "chat", schema: chat })).toEqual({ ran: ["001-x"], fresh: false, unknown: [] });
      // leave is new here, though chat's tables are not: by its own schema, none of its tables are here
      expect((await b.status(h, leaves, { app: "leave" })).fresh).toBe(false);   // asked of the whole database, it would run, and fail
      expect(await b.migrate(h, leaves, { app: "leave", schema: leave })).toEqual({ ran: [], fresh: true, unknown: [] });
      expect(ran).toEqual(["chat 001-x"]);
      await b.query(h, "CREATE TABLE leave_requests (id INT PRIMARY KEY, days INT)");

      // later, each app's next migration runs once, and neither app's list is the other's
      const more = [...leaves, step("leave", "002-y", "ALTER TABLE leave_requests ADD COLUMN reason TEXT")];
      expect(await b.migrate(h, more, { app: "leave", schema: leave })).toEqual({ ran: ["002-y"], fresh: false, unknown: [] });
      expect(await b.migrate(h, chats, { app: "chat", schema: chat })).toEqual({ ran: [], fresh: false, unknown: [] });
      expect((await b.status(h, more, { app: "leave", schema: leave })).ran.map((r) => r.id)).toEqual(["001-x", "002-y"]);
      expect((await b.status(h, chats, { app: "chat", schema: chat })).ran.map((r) => r.id)).toEqual(["001-x"]);
      expect((await b.status(h, [], { app: "nobody" })).ran).toEqual([]);
      expect(ran).toEqual(["chat 001-x", "leave 002-y"]);
    }, SLOW);

    test("tables made from the schema before the first start (init_db at first boot) are new: every migration recorded, none run; with rows, or another shape, they are lived in", async () => {
      const ran: string[] = [];
      const fresh = await b.open();
      await b.makeTables(fresh, after, [team]);
      expect((await b.status(fresh, story(ran), { app: "team", schema: after })).fresh).toBe(true);
      expect(await b.migrate(fresh, story(ran), { app: "team", schema: after })).toEqual({ ran: [], fresh: true, unknown: [] });
      expect(ran).toEqual([]);

      // a row in them is data to keep: not new, so the list runs (and here, against tables already at its end, fails)
      const seeded = await b.open();
      await b.makeTables(seeded, after, [team]);
      await b.query(seeded, "INSERT INTO teams (id) VALUES (1)");
      expect((await b.status(seeded, story([]), { app: "team", schema: after })).fresh).toBe(false);
      await expect(b.migrate(seeded, story([]), { app: "team", schema: after })).rejects.toThrow(/001-name-is-full-name failed/);

      // an earlier version's tables, empty, are another shape: not new, and the list brings them to this one
      const older = await b.open();
      await start(b, older, before, []);
      await b.query(older, "DELETE FROM delta_migrations");
      expect(await b.migrate(older, story(ran), { app: "team", schema: after })).toEqual({ ran: ["001-name-is-full-name", "002-fax-into-phone", "003-no-fax"], fresh: false, unknown: [] });
    }, SLOW);

    test("the fence is the migrating app's: another app beside it undoes on across it", async () => {
      const h = await b.open();
      await lived(h);   // the team app, on the ledger
      const notes = defineSchema({ notes: { table: "other_notes", columns: { text: "text" }, temporal: false } });
      const other = await b.beside(h, notes, [defineDoc("notes:", { root: "notes", include: [] })]);
      await other.call("open", { doc: "notes:" });
      expect((await other.call("delta", { doc: "notes:", ops: [{ op: "add", path: "/notes/-", value: { text: "kept" } }], cursor: "cy" })).error).toBeUndefined();

      await b.migrate(h, story([]), { app: "team", schema: after });
      await b.makeTables(h, after, [team]);
      const v2 = await b.serve(h, after, [team]);
      await v2.call("open", { doc: "team:1" });
      expect((await v2.call("undo", { cursor: "ada" })).result).toBeNull();   // the team's own: fenced
      const undone = await other.call("undo", { cursor: "cy" });             // the other app's: not
      expect(undone.error).toBeUndefined();
      expect(undone.result.ops).toEqual([{ op: "remove", path: "/notes/1" }]);
    }, SLOW);

    test("migrations from a folder: each file's up, named by the file, in the files' order", async () => {
      const dir = mkdtempSync(join(tmpdir(), "delta-upgrade-"));
      try {
        writeFileSync(join(dir, "002-second.ts"), `export const up = (tx) => { globalThis.__order.push("002"); };\n`);
        writeFileSync(join(dir, "001-first.ts"), `export async function up(tx) { globalThis.__order.push("001"); }\n`);
        writeFileSync(join(dir, "README.md"), "not a migration\n");
        const list = await fromFolder(dir);
        expect(list.map((m) => m.id)).toEqual(["001-first", "002-second"]);
        (globalThis as any).__order = [];
        const h = await b.open();
        await lived(h);
        await start(b, h, before, list);
        expect((globalThis as any).__order).toEqual(["001", "002"]);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }, SLOW);
  });
}
