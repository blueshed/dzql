/**
 * The server itself, `openStore`'s `owner`: a command, a job, a route that writes for no one
 * signed in, through the documents as a page writes -- the document's rule, the ledger and every
 * holder told -- never by `delta_apply` called by hand. With sign-in it passes no gate, every
 * document is its own, and it reads and writes as the tables' owner, past the policies the paths
 * make: shown on PGlite as a role that owns the tables and is held by them (NOSUPERUSER
 * NOBYPASSRLS), where a person is held and the server is not.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Pool } from "pg";
import { PGlite } from "@electric-sql/pglite";
import type { DeltaAuth } from "@blueshed/delta/auth";
import { createLocal } from "@blueshed/delta/local";
import { setLogLevel } from "@blueshed/delta/logger";
import { applyFramework, applySql, createDocListener, defineCustomDoc, defineDoc, defineSchema, docTypeFromDef, generateSql, importTables, openStore } from "../../src/postgres";
import { pglitePool } from "../../src/postgres/pglite";
import { pgliteAs, quietOn } from "../helpers/pglite";

setLogLevel("silent");

type Person = { id: number; name: string };
const auth: DeltaAuth<Person> = {
  gate: (c: any) => (c.data?.identity as Person | undefined) ?? { error: "Authentication required" },
  asSqlArg: (p) => p.id,
};
const ann: Person = { id: 1, name: "Ann" };
const ben: Person = { id: 2, name: "Ben" };

const schema = defineSchema({
  people: { columns: { name: "text" }, temporal: false },
  notes: { parent: "people", columns: { text: "text" }, temporal: false },
});
/** One's own notes, for them alone; a note says something. */
const mine = defineDoc("mine:", { root: "people", include: ["notes"], owns: "@id", accept: (op) => op.op !== "add" || !op.path.startsWith("/notes") || !!(op.value as any)?.text?.trim() || "A note says something" });
/** Everyone, by name: a list nobody may have but the server, here (no path admits a person to it). */
const everyone = defineDoc("everyone:", { root: "people", include: [], owns: "people[id=0].id" });
/** How many notes there are, for each person signed in. */
const counted = defineCustomDoc<string, Person>("count:", {
  watch: ["notes"],
  parse: (id) => id,
  recompute: async (pool) => ({ notes: Number((await pool.query("SELECT count(*) AS n FROM notes")).rows[0].n) }),
  owns: (p) => p.id === 1,
});
const seed = { tables: { people: [{ id: 1, name: "Ann" }, { id: 2, name: "Ben" }], notes: [{ id: 1, people_id: 1, text: "Ann's" }] } };

/** Every change told, on the channel it was told on. */
const hear = (local: ReturnType<typeof createLocal>) => {
  const heard: { doc: string; ops: any[] }[] = [];
  local.onPublish((doc, change) => change?.ops && heard.push({ doc, ops: change.ops }));
  return heard;
};

describe("openStore's owner, an app with sign-in", () => {
  const socket = createLocal(); // the pages' socket, as createWs() is
  const store = openStore<Person>({ schema, auth, who: (p) => String(p.id), ws: socket.server, prepare: (pool) => importTables(pool, schema, seed) });
  store.register([mine, everyone], { custom: [counted] });
  beforeAll(() => store.open());
  afterAll(() => store.close());

  test("it opens what no person may, past the gate and every owns; a caller with no one signed in is still refused", async () => {
    expect(Object.values((await store.owner.call("open", { doc: "everyone:" })).result.people).map((p: any) => p.name)).toEqual(["Ann", "Ben"]);
    expect((await store.owner.call("open", { doc: "mine:2" })).result.people).toMatchObject({ id: 2, name: "Ben" });
    expect((await store.owner.call("open", { doc: "count:all" })).result).toEqual({ notes: 1 });
    expect((await store.delta.call("open", { doc: "everyone:" })).error).toEqual({ code: 401, message: "Authentication required" });
    expect((await store.delta.as(ann).call("open", { doc: "everyone:" })).error).toEqual({ code: 404, message: "Not found" });
    expect((await socket.call("open", { doc: "mine:1" })).error).toEqual({ code: 401, message: "Authentication required" });
  });

  test("its write is the document's: its rule asked, on the ledger by no one along the cursor it names, and told to everyone holding it, on the socket and in this process", async () => {
    const onSocket = hear(socket);
    const here = hear(store.delta);
    expect((await socket.as(ann).call("open", { doc: "mine:1" })).error).toBeUndefined();
    expect((await store.owner.call("delta", { doc: "mine:1", ops: [{ op: "add", path: "/notes/-", value: { people_id: 1, text: " " } }] })).error).toEqual({ code: 400, message: "A note says something" });
    const written = await store.owner.call("delta", { doc: "mine:1", cursor: "link", ops: [{ op: "add", path: "/notes/-", value: { people_id: 1, text: "from the server" } }] });
    expect(written.error).toBeUndefined();
    await quietOn(store.pool, onSocket);
    expect(onSocket.filter((c) => c.doc === "mine:1").map((c) => c.ops[0].value.text)).toEqual(["from the server"]);
    expect(here.some((c) => c.doc === "mine:1")).toBe(true);
    expect((await store.pool.query("SELECT who, cursor FROM _delta_ledger ORDER BY id DESC LIMIT 1")).rows).toEqual([{ who: null, cursor: "link" }]);
    // and taken back along it, as any caller's undo
    expect((await store.owner.call("undo", { cursor: "link" })).error).toBeUndefined();
    expect(Object.values((await store.owner.call("open", { doc: "mine:1" })).result.notes).map((n: any) => n.text)).toEqual(["Ann's"]);
    await socket.as(ann).call("close", { doc: "mine:1" });
  });
});

describe("openStore's owner, an app with no sign-in", () => {
  test("it is a caller in this process, on the ledger by no one", async () => {
    const plain = defineSchema({ people: { columns: { name: "text" }, temporal: false } });
    const store = openStore({ schema: plain });
    store.register([defineDoc("people:", { root: "people", include: [] })]);
    await store.open();
    try {
      expect((await store.owner.call("delta", { doc: "people:", cursor: "seed", ops: [{ op: "add", path: "/people/-", value: { name: "Ann" } }] })).error).toBeUndefined();
      expect((await store.pool.query("SELECT who, cursor FROM _delta_ledger")).rows).toEqual([{ who: null, cursor: "seed" }]);
    } finally {
      await store.close();
    }
  });
});

describe("the owner past the paths' policies: a role that owns the tables and is held by them", () => {
  let db: PGlite;
  let listener: { destroy(): Promise<void> };
  const local = createLocal();
  const owner = local.as("the server");
  delete owner.client.data.identity;

  beforeAll(async () => {
    db = await PGlite.create();
    const admin = pglitePool(db);
    await admin.query("CREATE ROLE dzql_owner NOSUPERUSER NOBYPASSRLS; GRANT CREATE, USAGE ON SCHEMA public TO dzql_owner");
    const app: Pool = pgliteAs(db, "dzql_owner"); // applies the SQL, so owns the tables, and serves them
    await applyFramework(app);
    await applySql(app, generateSql(schema, [mine, everyone]));
    await importTables(app, schema, seed);
    listener = await createDocListener<Person>(local.server, app, { types: [mine, everyone].map((def) => docTypeFromDef<Person>(def, app, { auth })), auth, ledger: true, owner: owner.client });
  }, 30_000);
  afterAll(async () => { await listener.destroy(); await db.close(); });

  test("a person reads and writes only what a path gives them; the server reads every row and writes a person's row no path of theirs would take", async () => {
    expect((await local.as(ann).call("open", { doc: "mine:1" })).result.people).toMatchObject({ id: 1 });
    expect((await local.as(ann).call("open", { doc: "mine:2" })).error).toEqual({ code: 404, message: "Not found" });
    expect(Object.keys((await owner.call("open", { doc: "everyone:" })).result.people)).toEqual(["1", "2"]);
    // the policies hold the role itself while dzql.definer is down: what the server reads, it reads past them
    expect((await pgliteAs(db, "dzql_owner").query("SELECT count(*)::int AS n FROM people")).rows[0].n).toBe(0);
    expect((await owner.call("delta", { doc: "mine:2", cursor: "c", ops: [{ op: "add", path: "/notes/-", value: { people_id: 2, text: "for Ben" } }] })).error).toBeUndefined();
    expect(Object.values((await local.as(ben).call("open", { doc: "mine:2" })).result.notes).map((n: any) => n.text)).toEqual(["for Ben"]);
  });
});
