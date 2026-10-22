/**
 * `openStore` for an app with sign-in (root #140): its `auth`, a custom document beside its own, and
 * a history per resource, each its own app, through `openStore` alone, on PGlite. Who is signed in,
 * and what the custom document works out, are read as the tables' owner (`asOwner`), past the
 * policies the documents' paths make: dzql's public way, never `dzql.definer` raised by hand.
 */
import { describe, expect, test } from "bun:test";
import type { DeltaAuth } from "@blueshed/delta/auth";
import { setLogLevel } from "@blueshed/delta/logger";
import { createTable } from "@blueshed/delta/migrations";
import { asOwner, defineCustomDoc, defineDoc, defineSchema, importTables, openStore } from "../../src/postgres";

setLogLevel("silent");

type Person = { id: number; name: string };

const people = defineSchema({ people: { columns: { name: "text" }, temporal: false } });
const notes = defineSchema({ notes: { parent: "people", columns: { text: "text" }, temporal: false } });
/** Both resources' tables, as the rows are imported. */
const both = defineSchema({ people: { columns: { name: "text" }, temporal: false }, notes: { parent: "people", columns: { text: "text" }, temporal: false } });
const peopleHistory = [{ id: "001-people", changes: [createTable("people", { columns: { name: { type: "text" } }, temporal: false })] }];
const notesHistory = [
  { id: "001-notes", changes: [createTable("notes", { columns: { text: { type: "text" } }, parent: { collection: "people", fk: "people_id" }, temporal: false })] },
  // the store before's SQL: the rows come imported, migrated there, so it never runs here
  { id: "002-tidy", up: () => { throw new Error("another backend's SQL"); } },
];

/** Who is signed in is what the caller carries (`delta.as(person)`), as a socket's sign-in leaves it. */
const auth: DeltaAuth<Person> = {
  gate: (c: any) => (c.data?.identity as Person | undefined) ?? { error: "Authentication required" },
  asSqlArg: (p) => p.id,
};

const everyone = [defineDoc("people:", { root: "people", include: [] })]; // a name each, for everyone signed in
const own = [defineDoc("mine:", { root: "people", include: ["notes"], owns: "@id" })]; // their notes, for them alone
/** How many notes there are, worked out on every write to them, read as the tables' owner: nobody's notes, only the count. */
const counted = defineCustomDoc<string, Person>("count:", {
  watch: ["notes"],
  parse: (id) => id,
  recompute: (pool) => asOwner(pool, async (db) => {
    const { rows } = await db.query("SELECT count(*)::int AS notes, current_setting('dzql.definer', true) AS past FROM notes");
    return { notes: rows[0].notes, past: rows[0].past === "on" };
  }),
  shared: true,
});

function store() {
  const s = openStore<Person>({
    schema: [people, notes],
    migrations: [
      { app: "people", list: peopleHistory, schema: people },
      { app: "notes", list: notesHistory, schema: notes, imported: true },
    ],
    auth,
    who: (p) => String(p.id),
    prepare: async (pool) => {
      if (!(await pool.query("SELECT 1 FROM people")).rowCount)
        await importTables(pool, both, { tables: { people: [{ id: 1, name: "Ann" }, { id: 2, name: "Ben" }], notes: [{ id: 1, people_id: 1, text: "Ann's" }] } });
    },
  });
  s.register(everyone, { shared: true });
  s.register(own, { custom: [counted] });
  return s;
}

describe("openStore, an app with sign-in", () => {
  test("its histories, each its own app; who is signed in read as the owner; each document as its owner says; the custom one beside them", async () => {
    const s = store();
    await s.open();
    try {
      expect((await s.pool.query("SELECT app, id FROM delta_migrations ORDER BY app, id")).rows).toEqual([
        { app: "notes", id: "001-notes" }, { app: "notes", id: "002-tidy" }, { app: "people", id: "001-people" },
      ]);
      // as a link sign-in's personOf reads who someone is
      const whoIs = (id: number) => asOwner(s.pool, async (db) => (await db.query("SELECT id::int, name FROM people WHERE id = $1", [id])).rows[0] as Person);
      const ann = s.delta.as(await whoIs(1));
      const ben = s.delta.as(await whoIs(2));

      expect((await s.delta.call("open", { doc: "people:" })).error).toEqual({ code: 401, message: "Authentication required" });
      expect(Object.values((await ben.call("open", { doc: "people:" })).result.people).map((p: any) => p.name)).toEqual(["Ann", "Ben"]);
      expect(Object.values((await ann.call("open", { doc: "mine:1" })).result.notes).map((n: any) => n.text)).toEqual(["Ann's"]);
      expect((await ben.call("open", { doc: "mine:1" })).error).toEqual({ code: 404, message: "Not found" });
      expect((await ben.call("open", { doc: "count:all" })).result).toEqual({ notes: 1, past: true });

      expect((await ann.call("delta", { doc: "mine:1", ops: [{ op: "add", path: "/notes/-", value: { people_id: 1, text: "again" } }] })).error).toBeUndefined();
      expect((await s.pool.query("SELECT who FROM _delta_ledger")).rows).toEqual([{ who: "1" }]);
      await ben.call("close", { doc: "count:all" });
      expect((await ben.call("open", { doc: "count:all" })).result).toEqual({ notes: 2, past: true });
    } finally {
      await s.close();
    }
  });

  test("with auth, a document that says no owner is refused as it is registered; without, owns or shared would guard nothing", () => {
    const signedIn = openStore<Person>({ schema: people, auth });
    expect(() => signedIn.register(everyone)).toThrow(/openStore's register\("people:"\)/);
    expect(() => signedIn.register([], { custom: [defineCustomDoc("count:", { watch: ["notes"], parse: (id) => id, recompute: async () => ({}) })] })).toThrow(/defineCustomDoc\("count:"\)/);
    const open = openStore({ database: ":memory:", schema: people });
    expect(() => open.register(own)).toThrow(/openStore's register\("mine:"\): owns and shared are asked only with an auth module/);
    expect(() => open.register(everyone, { shared: true })).toThrow(/owns and shared are asked only with an auth module/);
  });

  test("several histories each name their app, once", () => {
    expect(() => openStore({ schema: people, migrations: [{ app: "people", list: peopleHistory }, { list: notesHistory }] })).toThrow("history 2 of 2 names no app");
    expect(() => openStore({ schema: people, migrations: [{ app: "people", list: peopleHistory }, { app: "people", list: notesHistory }] })).toThrow('two histories are app "people"');
  });
});
