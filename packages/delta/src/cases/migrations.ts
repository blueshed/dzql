/**
 * What every backend's `migrate` answers alike, for a history from empty (`../server/changes.ts`, the
 * Django way): SQLite's in delta, Postgres's in dzql. A new database is made by running every
 * migration from the first, and nothing runs twice; one made the older way (the schema's tables at
 * start-up, rows in them) adopts the history; a migration's changes and its data run in one
 * transaction, and fail together; renames keep values and rows, drops take them; a unique constraint
 * is made and dropped; an `up` takes the next id from the collection's serial; and the definitions
 * saying more than the history is reported; and a new database whose rows come imported, migrated
 * already, is made by the changes alone, its `up`s recorded and not run.
 *
 *   migrationCases("sqlite", { open, migrate, columns, query, makeTables });
 */
import { describe, expect, test } from "bun:test";
import { addColumn, addUnique, createTable, dropColumn, dropTable, dropUnique, renameColumn, renameTable } from "../server/changes";
import type { MigrateOptions, MigrateResult, Migration } from "../server/migrate";
import { defineSchema, type DocDef, type Schema } from "../schema";

/** A backend, as the cases ask it: a fresh database each `open`. */
export interface MigrationBackend<H> {
  open(): Promise<H>;
  migrate(h: H, list: Migration[], options?: MigrateOptions): Promise<MigrateResult>;
  /** The table's columns, in order. */
  columns(h: H, table: string): Promise<string[]>;
  /** Runs SQL both backends speak alike; its rows. */
  query(h: H, sql: string): Promise<Record<string, unknown>[]>;
  /** The schema's tables made the older way (createTables / generateSql at start-up); `docs`, the documents served over them, for a backend whose tables follow from those too. */
  makeTables(h: H, schema: Schema, docs?: DocDef[]): Promise<void>;
  /** In a migration's `up`: SQL on the transaction it is given. */
  run(tx: unknown, sql: string): Promise<void>;
}

const history: Migration[] = [
  { id: "001-people", changes: [createTable("people", { columns: { name: "text" }, temporal: false })] },
  { id: "002-posts", changes: [createTable("posts", { parent: "people", columns: { title: "text", body: "text?" }, temporal: false })] },
];
const schema = defineSchema({
  people: { columns: { name: "text" }, temporal: false },
  posts: { parent: "people", columns: { title: "text", body: "text?" }, temporal: false },
});

export function migrationCases<H>(name: string, b: MigrationBackend<H>) {
  describe(`${name}: migrate, a history from empty`, () => {
    test("a new database is made by every migration from the first; then nothing runs again", async () => {
      const h = await b.open();
      expect(await b.migrate(h, history, { schema })).toEqual({ ran: ["001-people", "002-posts"], fresh: false, unknown: [], drift: [] });
      expect(await b.columns(h, "posts")).toEqual(["id", "people_id", "title", "body"]);
      expect(await b.migrate(h, history, { schema })).toEqual({ ran: [], fresh: false, unknown: [], drift: [] });
    });

    test("a database made the older way, rows in it, adopts the history: each recorded as run, none run", async () => {
      const h = await b.open();
      await b.makeTables(h, schema);
      await b.query(h, "INSERT INTO people (id, name) VALUES (1, 'Ann')");
      expect(await b.migrate(h, history, { schema })).toEqual({ ran: [], fresh: true, unknown: [], drift: [] });
      expect(await b.query(h, "SELECT name FROM people")).toEqual([{ name: "Ann" }]);
    });

    test("a migration's changes and its data run together, and fail together", async () => {
      const h = await b.open();
      await b.migrate(h, history);
      await b.query(h, "INSERT INTO people (id, name) VALUES (1, 'Ann')");
      const filled: Migration[] = [...history, { id: "003-short", changes: [addColumn("people", "short", "text?")], up: (tx) => b.run(tx, "UPDATE people SET short = name") }];
      expect((await b.migrate(h, filled)).ran).toEqual(["003-short"]);
      expect(await b.query(h, "SELECT short FROM people")).toEqual([{ short: "Ann" }]);
      const broken: Migration[] = [...filled, { id: "004-broken", changes: [addColumn("people", "nick", "text?")], up: () => { throw new Error("no"); } }];
      await expect(b.migrate(h, broken)).rejects.toThrow("004-broken failed, and was rolled back: no");
      expect(await b.columns(h, "people")).not.toContain("nick");
    });

    test("a column renamed keeps its values, a table renamed its rows; a column and a table dropped are gone", async () => {
      const h = await b.open();
      await b.migrate(h, history);
      await b.query(h, "INSERT INTO people (id, name) VALUES (1, 'Ann')");
      await b.query(h, "INSERT INTO posts (id, people_id, title) VALUES (1, 1, 'Hi')");
      const moved: Migration[] = [...history,
        { id: "003-rename", changes: [renameColumn("people", "name", "full_name"), renameTable("posts", "notes")] },
        { id: "004-drop", changes: [dropColumn("notes", "body"), createTable("tags", { columns: { label: "text" }, temporal: false }), dropTable("tags")] },
      ];
      expect((await b.migrate(h, moved)).ran).toEqual(["003-rename", "004-drop"]);
      expect(await b.query(h, "SELECT full_name FROM people")).toEqual([{ full_name: "Ann" }]);
      expect(await b.query(h, "SELECT title FROM notes")).toEqual([{ title: "Hi" }]);
      expect(await b.columns(h, "notes")).toEqual(["id", "people_id", "title"]);
    });

    test("a temporal table made from empty keeps versions: its validity columns", async () => {
      const h = await b.open();
      await b.migrate(h, [{ id: "001-notes", changes: [createTable("notes", { columns: { text: "text" } })] }]);
      expect(await b.columns(h, "notes")).toEqual(["id", "text", "valid_from", "valid_to"]);
    });

    test("a unique constraint made refuses a row sharing its values among those it holds; dropped, it refuses none", async () => {
      const h = await b.open();
      const loans: Migration[] = [
        { id: "001-loans", changes: [createTable("loans", { columns: { tool: "integer", returned: "text?" }, temporal: false })] },
        { id: "002-one-open", changes: [addUnique("loans", "tool", { whereNull: ["returned"] })] },
      ];
      await b.migrate(h, loans);
      await b.query(h, "INSERT INTO loans (id, tool, returned) VALUES (1, 7, 'yesterday')");
      await b.query(h, "INSERT INTO loans (id, tool) VALUES (2, 7)");
      await expect(b.query(h, "INSERT INTO loans (id, tool) VALUES (3, 7)")).rejects.toThrow();
      await b.migrate(h, [...loans, { id: "003-any", changes: [dropUnique("loans", "tool")] }]);
      await b.query(h, "INSERT INTO loans (id, tool) VALUES (3, 7)");
      expect(await b.query(h, "SELECT id FROM loans WHERE returned IS NULL ORDER BY id")).toEqual([{ id: 2 }, { id: 3 }]);
    });

    test("an up's nextId takes the collection's next serial, past any id it holds", async () => {
      const h = await b.open();
      await b.migrate(h, history);
      await b.query(h, "INSERT INTO people (id, name) VALUES (4, 'Ann')");
      const given: number[] = [];
      await b.migrate(h, [...history, { id: "003-two-more", up: async (tx, { nextId }) => {
        for (const name of ["Bob", "Cy"]) {
          const id = await nextId("people");
          given.push(id);
          await b.run(tx, `INSERT INTO people (id, name) VALUES (${id}, '${name}')`);
        }
      } }]);
      expect(given).toEqual([5, 6]);
      expect(await b.query(h, "SELECT id, name FROM people ORDER BY id")).toEqual([{ id: 4, name: "Ann" }, { id: 5, name: "Bob" }, { id: 6, name: "Cy" }]);
    });

    test("a new database whose rows come imported (`imported`) is made by the changes alone: each up recorded, none run; then the next up runs", async () => {
      const h = await b.open();
      const moved: Migration[] = [...history, { id: "003-short", changes: [addColumn("people", "short", "text?")], up: () => { throw new Error("the other backend's SQL"); } }];
      expect(await b.migrate(h, moved, { imported: true })).toEqual({ ran: ["001-people", "002-posts", "003-short"], fresh: false, unknown: [] });
      expect(await b.columns(h, "people")).toEqual(["id", "name", "short"]);
      await b.query(h, "INSERT INTO people (id, name) VALUES (1, 'Ann')"); // the rows, imported
      const next: Migration[] = [...moved, { id: "004-nick", changes: [addColumn("people", "nick", "text?")], up: (tx) => b.run(tx, "UPDATE people SET nick = name") }];
      expect((await b.migrate(h, next, { imported: true })).ran).toEqual(["004-nick"]);
      expect(await b.query(h, "SELECT nick FROM people")).toEqual([{ nick: "Ann" }]);
    });

    test("the definitions saying more than the history is reported, as the next migration's changes", async () => {
      const h = await b.open();
      const more = defineSchema({ people: { columns: { name: "text", email: "text?" }, temporal: false }, posts: { parent: "people", columns: { title: "text", body: "text?" }, temporal: false } });
      expect((await b.migrate(h, history, { schema: more })).drift).toEqual(["addColumn people.email"]);
    });
  });
}
