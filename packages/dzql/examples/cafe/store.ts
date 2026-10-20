import { defineSchema, importTables, openStore } from "dzql/postgres";
import { guardWrites, rowsInPostgres } from "dzql/modelling/guards";
import { schema as modelSchema, tables } from "./model/types";
import { guards } from "./model/guards";

// The cafe's store: Postgres, its documents compiled from the model's definitions (dzql/postgres).
// On a Postgres server when DATABASE_URL says one; else PGlite, Postgres in this process, kept in
// PGLITE_DIR (in memory without one: the tests, the stories). What the model made (./model/, by
// `dzql model` from ./model.json) comes first, by its own migrations; then what the app keeps beside
// it -- who the staff are, and what a visit holds beyond the table a customer scanned (who signed
// in, the cookie's hash; where they are is each tab's own) -- made by the compiled SQL, which adds a missing table or
// column (dzql's `openStore`). Each resource registers its documents (`register`, in
// `resources/<name>/<name>-api.ts`); `open()` compiles them all and opens one listener over them,
// the cafe seeded and the model's guards in front.

export const schema = defineSchema({
  ...tables,
  visits: { ...tables.visits!, columns: { ...tables.visits!.columns, role: "text?", name: "text?", cookie: "text?" } },
  staff: { table: "cafe_staff", columns: { name: "text", role: "text" }, temporal: false },
});

export const { pool, delta, register, open: openDocuments, stories } = await openStore({ schema, migrations: { dir: `${import.meta.dir}/model/migrations`, app: "cafe-model", schema: modelSchema } });

/** The staff, as the cafe starts: each comes in by a link (../links.ts). */
export let staff: { id: number; name: string; role: string }[] = [];

/** Who a session is to the model's stories: the staff member's role, or a customer once they have scanned a table. */
export async function actorOf(sessionId: string): Promise<string | undefined> {
  const v = (await pool.query<{ role: string | null; table: string | null }>(`SELECT role, "table" FROM visits WHERE id = $1`, [sessionId])).rows[0];
  return v?.role ?? (v?.table ? "customer" : undefined);
}

/** Every resource's documents compiled and opened, the cafe seeded and the guards in front: once, after the resources have registered. */
export const open = () =>
  openDocuments(async () => {
    // the cafe as it starts: four free tables, three things on the menu, a manager and a cook
    if ((await pool.query(`SELECT 1 FROM "tables" LIMIT 1`)).rows.length === 0)
      await importTables(pool, schema, {
        tables: {
          tables: [1, 2, 3, 4].map((n) => ({ id: n, name: `Table ${n}`, seated: false })),
          items: [{ id: 1, name: "Soup", price: 5.5 }, { id: 2, name: "Toast", price: 3 }, { id: 3, name: "Coffee", price: 2.5 }],
          staff: [{ id: 1, name: "Mo", role: "manager" }, { id: 2, name: "Kit", role: "cook" }],
        },
      });
    staff = (await pool.query("SELECT id::int, name, role FROM cafe_staff ORDER BY id")).rows;
    // The model's guards stand in front of the store: a write no story says is refused there, in the
    // story's words. They are given the session (the app has no `who`), and look up who it is.
    guardWrites(delta.server, guards, { actorOf: (identity) => actorOf(String(identity)), rowOf: rowsInPostgres(pool, schema) });
  });
