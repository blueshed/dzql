import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { createTables, migrate, migrationStatus, type Migration, type Schema } from "@blueshed/delta/sqlite";
// one after another: each delta.ts migrates the one database as it loads, and imported side by side their top-level awaits would meet in one transaction
type Migrating = { app: string; schema: Schema };
const all: Migrating[] = [];
for (const name of ["chat", "leave", "modeling", "ticker", "wedding"]) all.push((await import(`../../examples/${name}/delta`)).migrating);
const [chat, leave] = all as [Migrating, Migrating];

// The examples may share a database (DB_PATH is one file whichever runs), so each delta.ts says
// whose its migrations are, and its schema: each runs only its own, and one new to the database
// runs none, though another's tables are there.

// each changes a table named for its id: one run where it should not, fails
const list = (...ids: string[]): Migration<Database>[] => ids.map((id) => ({ id, up: (db) => void db.run(`ALTER TABLE ${id.replace(/\W/g, "_")} ADD COLUMN x TEXT`) }));

describe("two examples share a database, and each runs only its own migrations", () => {
  test("each example names its own app, with its schema", () => {
    expect(all.map((m) => m.app)).toEqual(["chat", "leave", "modeling", "ticker", "wedding"]);
    for (const m of all) expect(Object.keys(m.schema.tables).length).toBeGreaterThan(0);
  });

  test("chat lives in the database; leave, new to it, runs none of its own; a later one of each runs alone", async () => {
    const db = new Database(":memory:");
    expect(await migrate(db, list("001-x"), chat)).toEqual({ ran: [], fresh: true, unknown: [] });
    createTables(db, chat.schema);
    db.run("INSERT INTO chat_messages (id, room, name, text, sent_at) VALUES (1, 'general', 'Ada', 'hello', 0)");

    // asked of the whole database, leave would not be new, and its 001-x would run on tables it never had
    expect((await migrationStatus(db, list("001-x"), { app: "leave" })).fresh).toBe(false);
    expect(await migrate(db, list("001-x"), leave)).toEqual({ ran: [], fresh: true, unknown: [] });
    createTables(db, leave.schema);

    db.run("CREATE TABLE chat_002 (id TEXT)");
    db.run("CREATE TABLE leave_002 (id TEXT)");
    expect(await migrate(db, list("001-x", "chat-002"), chat)).toEqual({ ran: ["chat-002"], fresh: false, unknown: [] });
    expect(await migrate(db, list("001-x", "leave-002"), leave)).toEqual({ ran: ["leave-002"], fresh: false, unknown: [] });
    expect(db.query<{ app: string; id: string }, []>("SELECT app, id FROM delta_migrations ORDER BY app, id").all()).toEqual([
      { app: "chat", id: "001-x" }, { app: "chat", id: "chat-002" },
      { app: "leave", id: "001-x" }, { app: "leave", id: "leave-002" },
    ]);
    db.close();
  });
});
