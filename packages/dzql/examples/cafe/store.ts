import { createTables, defineSchema, fromFolder, migrate, migrateSchema } from "@blueshed/delta/sqlite";
import { createLocal } from "@blueshed/delta/local";
import { db } from "dzql/rendering/db";
import { guardWrites, rowsIn } from "dzql/modelling/guards";
import { schema as modelSchema, tables } from "./model/types";
import { guards } from "./model/guards";

// The cafe's store: what the model made (./model/, by `dzql model` from ./model.json) and what the
// app keeps beside it. The model's tables come first, by the model's own migrations; then the app's
// own -- who the staff are, and what a visit holds beyond the table a customer scanned (who signed
// in, where they are, the cookie's hash) -- added by `createTables` and `migrateSchema`.

export const schema = defineSchema({
  ...tables,
  visits: { ...tables.visits!, columns: { ...tables.visits!.columns, role: "text?", name: "text?", page: "text?", cookie: "text?" } },
  staff: { table: "cafe_staff", columns: { name: "text", role: "text" }, temporal: false },
});

await migrate(db, await fromFolder(`${import.meta.dir}/model/migrations`), { app: "cafe-model", schema: modelSchema });
createTables(db, schema);
migrateSchema(db, schema);

// The cafe as it starts: four free tables, three things on the menu, a manager and a cook.
if (!db.query(`SELECT 1 FROM "tables"`).get()) {
  for (const n of [1, 2, 3, 4]) db.run(`INSERT INTO "tables" (id, name, seated) VALUES (?, ?, 0)`, [n, `Table ${n}`]);
  db.run("INSERT INTO items (id, name, price) VALUES (1, 'Soup', 5.5), (2, 'Toast', 3), (3, 'Coffee', 2.5)");
  db.run("INSERT INTO cafe_staff (id, name, role) VALUES (1, 'Mo', 'manager'), (2, 'Kit', 'cook')");
}

/** The documents, in delta, in this process: each resource registers its own on it (`resources/<name>/<name>-api.ts`). */
export const delta = createLocal();

/** Who a session is to the model's stories: the staff member's role, or a customer once they have scanned a table. */
const visitOf = db.query<{ role: string | null; table: string | null }, [string]>(`SELECT role, "table" FROM visits WHERE id = ?`);
export function actorOf(sessionId: string): string | undefined {
  const v = visitOf.get(sessionId);
  return v?.role ?? (v?.table ? "customer" : undefined);
}

// The model's guards stand in front of the store, before any document is registered: a write no
// story says is refused there, in the story's words. They are given the session (the app has no
// `who`), and look up who it is.
guardWrites(delta.server, guards, { actorOf: (identity) => actorOf(String(identity)), rowOf: rowsIn(db, schema) });

export { db };
