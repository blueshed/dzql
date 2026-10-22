// The dzql-app skill's migrations page, its Postgres history run as written: each file the page
// shows (`// model/migrations/<name>.ts`) written to a folder, the first opened on a new database
// (PGlite, in a folder), a request written, then the second over it, as the next version opens.
import { afterAll, expect, test } from "bun:test";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setLogLevel } from "@blueshed/delta/logger";
import { defineDoc, defineSchema, openStore } from "dzql/postgres";

setLogLevel("silent");

const page = readFileSync(join(import.meta.dir, "../../.claude/skills/dzql-app/reference/migrations.md"), "utf8");
const files = [...page.matchAll(/```ts\n\/\/ model\/migrations\/(\d{3}-[a-z-]+\.ts)[^\n]*\n([\s\S]*?)```/g)].map(([, name, body]) => ({ name: name!, body: body! }));
// beside the tests, so the files find dzql's node_modules; a dot folder, so no other test reads it
const scratch = join(import.meta.dir, `.migrations-${process.pid}`);
const dir = join(scratch, "migrations");
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const requests = defineDoc("requests:", { root: "requests", include: [] });
const storeOf = (schema: ReturnType<typeof defineSchema>) => {
  const store = openStore({ schema, database: join(scratch, "pg"), migrations: { dir, app: "leave", schema } });
  store.register([requests]);
  return store;
};

test("the page's Postgres history: the first makes the table, the second adds a column and fills it", async () => {
  expect(files.map((f) => f.name)).toEqual(["001-requests.ts", "002-reason.ts"]);
  mkdirSync(dir, { recursive: true });

  writeFileSync(join(dir, files[0]!.name), files[0]!.body);
  const before = storeOf(defineSchema({ requests: { columns: { title: "text" } } }));
  await before.open();
  expect((await before.owner.call("delta", { doc: "requests:", ops: [{ op: "add", path: "/requests/-", value: { title: "A week in October" } }] })).error).toBeUndefined();
  await before.close();

  writeFileSync(join(dir, files[1]!.name), files[1]!.body);
  const after = storeOf(defineSchema({ requests: { columns: { title: "text", reason: "text?" } } }));
  await after.open();
  try {
    const { result } = await after.owner.call("open", { doc: "requests:" });
    expect(Object.values(result.requests)).toEqual([expect.objectContaining({ title: "A week in October", reason: "holiday" })]);
    expect((await after.pool.query("SELECT id FROM delta_migrations WHERE app = 'leave' ORDER BY id")).rows).toEqual([{ id: "001-requests" }, { id: "002-reason" }]);
  } finally {
    await after.close();
  }
}, 60_000);
