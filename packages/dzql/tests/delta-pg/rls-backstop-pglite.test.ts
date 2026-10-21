/**
 * Row-level security as the backstop (todo #19): the compiled reads and writes run as the invoker,
 * and each table every document holding it says by a path has a policy generateSql derives from
 * those paths. So a compiler bug in a permission check -- simulated here by putting a wrong
 * function in the compiled one's place -- meets the policy, and a person still reads and writes
 * only a row some document they may have holds. Each bug is shown first as the superuser, whom
 * RLS never holds, where it leaks; then as a NOSUPERUSER NOBYPASSRLS role, where it does not.
 * In this process (PGlite), which holds such a role to the policies as a server does.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import type { Pool } from "pg";
import { PGlite } from "@electric-sql/pglite";
import { createLocal } from "@blueshed/delta/local";
import { setLogLevel } from "@blueshed/delta/logger";
import { defineDoc, defineSchema, q } from "@blueshed/delta/backend";
import { permissionAuth, permissionDocs, permissionSchema, permissionSeed, type Person } from "@blueshed/delta/testing";
import { applyFramework, applySql, createDocListener, docTypeFromDef, exportTables, generateSql, importTables, migrationStatus } from "../../src/postgres";
import { pglitePool } from "../../src/postgres/pglite";
import { openFunction } from "../../src/compile/opens";
import { inScopeFunction } from "../../src/compile/scope";
import { ownsFunction } from "../../src/compile/owns";
import { pgliteAs, quietOn } from "../helpers/pglite";

setLogLevel("silent");

const ann: Person = { id: 1, name: "Ann" };
const ben: Person = { id: 2, name: "Ben" };
const NOT_FOUND = { code: 404, message: "Not found" };
/** One's own posts, a list scoped by the author: beside delta's documents, each with its path. */
const postsBy = defineDoc("posts-by:", { root: "posts", include: [], scope: { author_id: ":id" }, owns: "@author_id" });
// delta's documents but board:, which is every post for anyone (owns: "ANYONE"): its policy would open
// every post to every role, and the backstop here is that a post is its author's
const docs = [...Object.values(permissionDocs).filter((d) => d !== permissionDocs.board), postsBy];
const tables = Object.values(permissionSchema.tables).map((t) => q(t.name));

let db: PGlite;
let admin: Pool;
let app: Pool;
const listeners: { destroy(): Promise<void> }[] = [];

beforeAll(async () => {
  db = await PGlite.create();
  admin = pglitePool(db);
  await applyFramework(admin);
  await admin.query("CREATE ROLE dzql_app NOSUPERUSER NOBYPASSRLS");
  app = pgliteAs(db, "dzql_app");
});
afterAll(async () => { for (const l of listeners) await l.destroy(); await db.close(); });

// each test its own SQL and rows: the compiled functions as generateSql writes them, then the bug
beforeEach(async () => {
  for (const l of listeners.splice(0)) await l.destroy();
  await applySql(admin, generateSql(permissionSchema, docs));
  await admin.query("GRANT USAGE ON SCHEMA public TO dzql_app; GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO dzql_app; GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO dzql_app");
  await admin.query(`TRUNCATE ${tables.join(", ")}, _delta_versions, _delta_ops_log, _delta_ledger RESTART IDENTITY`);
  await importTables(admin, permissionSchema, permissionSeed);
});

/** The documents served on `pool`, each person calling as themselves. */
async function serve(pool: Pool) {
  const local = createLocal();
  listeners.push(await createDocListener(local.server, pool, { types: docs.map((def) => docTypeFromDef<Person>(def, pool, { auth: permissionAuth })), auth: permissionAuth, ledger: true }));
  return (person: Person) => local.as(person);
}
const title = async (id: number) => (await admin.query("SELECT title FROM posts WHERE id = $1", [id])).rows[0]?.title;
/** The rows `pool` reads of posts, as the person `user` (none: unbound). */
const seen = async (pool: Pool, user = "") => {
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    await db.query("SELECT set_config('app.user_id', $1, true)", [user]);
    return (await db.query("SELECT id FROM posts ORDER BY id")).rows.map((r) => Number(r.id));
  } finally { await db.query("COMMIT"); db.release(); }
};

describe("row-level security beneath the compiled functions", () => {
  test("the policies are the documents' paths: the role reads a post as its author, nothing unbound; the superuser reads all", async () => {
    expect(await seen(app, "1")).toEqual([1]);
    expect(await seen(app, "2")).toEqual([2]);
    expect(await seen(app)).toEqual([]);
    expect(await seen(admin)).toEqual([1, 2]);
    const { rows } = await admin.query("SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname IN ('posts', 'venues', 'people') ORDER BY relname");
    // posts, venues and people every document holding them says by a path (people: mine: and team:); a table with no path is the policies test's
    expect(rows).toEqual([
      { relname: "people", relrowsecurity: true, relforcerowsecurity: true },
      { relname: "posts", relrowsecurity: true, relforcerowsecurity: true },
      { relname: "venues", relrowsecurity: true, relforcerowsecurity: true },
    ]);
  });

  test("dzql.definer, which lets the owner's definer functions past, gains another role nothing", async () => {
    const db = await app.connect();
    try {
      await db.query("BEGIN");
      await db.query("SELECT set_config('dzql.definer', 'on', true)");
      expect((await db.query("SELECT id FROM posts")).rows).toEqual([]);
    } finally { await db.query("COMMIT"); db.release(); }
  });

  test("an ownership check that says yes to everyone: Ann opens and writes Ben's post as the superuser; as the role she reads nothing of it, and her write changes nothing", async () => {
    await admin.query(`CREATE OR REPLACE FUNCTION ${ownsFunction("post:")}(p_name TEXT, p_person BIGINT) RETURNS BOOLEAN LANGUAGE sql AS 'SELECT TRUE'`);
    const write = { doc: "post:2", ops: [{ op: "replace", path: "/posts/title", value: "Ann was here" }] };

    const leaky = await serve(admin);
    expect((await leaky(ann).call("open", { doc: "post:2" })).result.posts.title).toBe("Ben's");
    expect((await leaky(ann).call("delta", write)).error).toBeUndefined();
    expect(await title(2)).toBe("Ann was here");
    await admin.query("UPDATE posts SET title = 'Ben''s' WHERE id = 2");

    const held = await serve(app);
    // the row is not there for her: not found, as a document whose root is not there (in delta's words)
    expect((await held(ann).call("open", { doc: "post:2" })).error).toEqual({ code: 404, message: "Not found: no posts row 2. Make the row first, or declare the document implied: true" });
    expect((await held(ann).call("delta", write)).error?.code).toBe(404);
    expect(await title(2)).toBe("Ben's");
    expect((await held(ben).call("open", { doc: "post:2" })).result.posts.title).toBe("Ben's");   // and still is for him
  });

  test("a write's scope that takes any row: Ann writes Ben's post through her own list as the superuser; as the role it is refused, and nothing changes", async () => {
    await admin.query(`CREATE OR REPLACE FUNCTION ${inScopeFunction("posts-by:")}(p_name TEXT, p_coll TEXT, p_id BIGINT) RETURNS BOOLEAN LANGUAGE sql AS 'SELECT TRUE'`);
    const write = { doc: "posts-by:1", ops: [{ op: "replace", path: "/posts/2/title", value: "Ann was here" }] };

    const leaky = await serve(admin);
    expect((await leaky(ann).call("delta", write)).error).toBeUndefined();
    expect(await title(2)).toBe("Ann was here");
    await admin.query("UPDATE posts SET title = 'Ben''s' WHERE id = 2");

    const held = await serve(app);
    expect((await held(ann).call("delta", write)).error?.code).toBe(404);
    expect(await title(2)).toBe("Ben's");
    // her own, through it, as before
    expect((await held(ann).call("delta", { doc: "posts-by:1", ops: [{ op: "replace", path: "/posts/1/title", value: "mine" }] })).error).toBeUndefined();
    expect(await title(1)).toBe("mine");
  });

  test("an open that forgets its scope: Ann reads every post through her own list as the superuser; as the role, hers alone", async () => {
    await admin.query(`CREATE OR REPLACE FUNCTION ${openFunction("posts-by:")}(p_name TEXT) RETURNS JSONB LANGUAGE sql AS $$
      SELECT jsonb_build_object('posts', COALESCE(jsonb_object_agg(t.id, to_jsonb(t)), '{}'::jsonb), '_version', 0) FROM posts t $$`);
    const leaky = await serve(admin);
    expect(Object.keys((await leaky(ann).call("open", { doc: "posts-by:1" })).result.posts)).toEqual(["1", "2"]);
    const held = await serve(app);
    expect(Object.keys((await held(ann).call("open", { doc: "posts-by:1" })).result.posts)).toEqual(["1"]);
  });
});

describe("one role that owns the tables and does not bypass row-level security (FORCE)", () => {
  // Alice's board, its lists, the cards on them and the comments on a card; a card and a comment are their authors' too
  const boardSchema = defineSchema({
    boards: { columns: { owner_id: "integer" }, temporal: false },
    lists: { parent: "boards", columns: { name: "text" }, temporal: false },
    cards: { parent: "lists", columns: { author_id: "integer", text: "text" }, temporal: false },
    comments: { parent: "cards", columns: { author_id: "integer", text: "text" }, temporal: false },
  });
  const boardDocs = [
    defineDoc("board:", { root: "boards", include: ["lists", "cards", "comments"], owns: "@owner_id" }),
    defineDoc("cards-by:", { root: "cards", include: ["comments"], scope: { author_id: ":id" }, owns: "@author_id" }),
  ];
  let bdb: PGlite;
  let owner: Pool;

  beforeAll(async () => {
    bdb = await PGlite.create();
    const superuser = pglitePool(bdb);
    await superuser.query("CREATE ROLE dzql_owner NOSUPERUSER NOBYPASSRLS; GRANT CREATE, USAGE ON SCHEMA public TO dzql_owner");
    owner = pgliteAs(bdb, "dzql_owner");   // applies the SQL, owns the tables and the definer functions, and serves the documents
    await applyFramework(owner);
    await applySql(owner, generateSql(boardSchema, boardDocs));
    // Bob's card on Alice's list, seeded past RLS
    await importTables(superuser, boardSchema, { tables: { boards: [{ id: 1, owner_id: 1 }], lists: [{ id: 1, boards_id: 1, name: "todo" }], cards: [{ id: 1, lists_id: 1, author_id: 2, text: "Bob's" }], comments: [] } });
  });
  afterAll(async () => { await bdb.close(); });

  /** The rows of `table` the owner reads, as `user`, with nothing raised. */
  const count = async (table: string, user = "") => {
    const db = await owner.connect();
    try {
      await db.query("BEGIN");
      await db.query("SELECT set_config('app.user_id', $1, true)", [user]);
      return (await db.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n;
    } finally { await db.query("COMMIT"); db.release(); }
  };

  test("the owner's own queries meet the policies: unbound it reads nothing, as Bob not Alice's list", async () => {
    expect(await count("boards")).toBe(0);
    expect(await count("lists", "2")).toBe(0);
    expect(await count("lists", "1")).toBe(1);
    expect(await count("cards", "2")).toBe(1);   // his own card, on her list
  });

  test("its maintenance is the owner's: rows carried out and in whole, a history's count of them true", async () => {
    const out = await exportTables(owner, boardSchema);
    expect(Object.fromEntries(Object.entries(out.tables).map(([k, rows]) => [k, rows.length]))).toEqual({ boards: 1, lists: 1, cards: 1, comments: 0 });
    // a history asks whether the app's tables hold rows, to know a new database from one that lived before it
    expect((await migrationStatus(owner, [], { app: "board", schema: boardSchema })).fresh).toBe(false);
  });

  test("Bob's comment on his card on Alice's list is told to her board, though Bob reads nothing of her board or her list", async () => {
    const local = createLocal();
    const heard: { channel: string; data: any }[] = [];
    local.onPublish((channel, data) => heard.push({ channel, data }));
    listeners.push(await createDocListener(local.server, owner, { types: boardDocs.map((def) => docTypeFromDef<Person>(def, owner, { auth: permissionAuth })), auth: permissionAuth }));
    const alice = local.as(ann), bob = local.as(ben);
    expect((await alice.call("open", { doc: "board:1" })).result.cards).toMatchObject({ "1": { text: "Bob's" } });
    expect((await bob.call("open", { doc: "board:1" })).error).toEqual(NOT_FOUND);
    expect((await bob.call("delta", { doc: "cards-by:2", ops: [{ op: "add", path: "/comments/-", value: { cards_id: 1, author_id: 2, text: "on it" } }] })).error).toBeUndefined();
    await quietOn(owner, heard);
    // the chain from the comment climbs her list, which Bob cannot read: the fan-out reads past it, and answers only her board's name
    expect(heard.filter((h) => h.channel === "board:1").flatMap((h) => h.data.ops)).toEqual([
      { op: "add", path: "/comments/1", value: { id: 1, cards_id: 1, author_id: 2, text: "on it" } },
    ]);
    expect((await alice.call("open", { doc: "board:1" })).result.comments).toMatchObject({ "1": { text: "on it" } });
    expect(await count("lists", "2")).toBe(0);
  });
});
