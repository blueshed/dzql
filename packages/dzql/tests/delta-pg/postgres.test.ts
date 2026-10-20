/**
 * Integration tests for the Postgres backend.
 *
 * Requires a live Postgres on $DATABASE_URL (defaults to the compose
 * service on localhost:5433). Run with:
 *
 *   docker compose up -d --wait
 *   bun test tests/postgres.test.ts
 *   docker compose down -v
 */
import { describe, test, expect, beforeAll, beforeEach, afterAll } from "bun:test";
import { Pool } from "pg";
import {
  createDocListener,
  docTypeFromDef,
  defineDoc,
  defineSchema,
  generateSql,
  pruneOpsLog,
  type DocType,
} from "../../src/postgres";
import { createWs } from "@blueshed/delta/server";
import { setLogLevel } from "@blueshed/delta/logger";
import {
  newPool,
  applyFramework,
  applyItems,
  itemsTables,
  resetState,
} from "./setup";
import { waitFor, mockClient, sendAndAwait } from "@blueshed/delta/testing";

setLogLevel("silent");

let pool: Pool;

/**
 * What these tests open, defined as an app defines it and applied once: the items, a temporal
 * copy of them, and a catalog of products and their parts (and a temporal copy of the parts).
 */
const tables = {
  items_t: { columns: { name: "text", value: { type: "integer", default: 0 } }, temporal: true },
  products: { columns: { name: "text" }, temporal: false },
  parts: { parent: "products", columns: { label: "text" }, temporal: false },
  parts_t: { parent: "products", columns: { label: "text" }, temporal: true },
};
/** Each scope operator over the items, by the prefix its test opens. */
const scopes: Record<string, Record<string, string>> = {
  "s1:": { id: ":id" },
  "s2:": { name: "=:name" },
  "s3:": { value: ">=:start" },
  "s4:": { value: "<=:end" },
  "s5:": { name: "like:prefix" },
  "s6:": { id: ":id", name: "=:name" },
  "s7:": {},
  "s8:": {},
  "at-op:": { valid_from: "at:when" },
  "endto:": { id: ":id" },
};
const docs = [
  ...Object.entries(scopes).map(([prefix, scope]) => defineDoc(prefix, { root: "items", include: [], scope })),
  defineDoc("t:", { root: "items_t", include: [] }),
  defineDoc("catalog:", { root: "products", include: ["parts"] }),
  defineDoc("catalog-root:", { root: "products", include: [] }),
  defineDoc("catalog-t:", { root: "products", include: ["parts_t"] }),
];

beforeAll(async () => {
  pool = await newPool();
  await applyFramework(pool);
  await applyItems(pool, { tables, docs });
});

afterAll(async () => {
  await pool.end();
});

beforeEach(async () => {
  await resetState(pool);
});

/** The one document the listeners answer for. */
const items = () => docTypeFromDef(defineDoc("items:", { root: "items", include: [] }), pool);

// ---------------------------------------------------------------------------
// Smoke test — can we reach the database at all?
// ---------------------------------------------------------------------------

describe("postgres connectivity", () => {
  test("pool can query", async () => {
    const { rows } = await pool.query("SELECT 1 AS ok");
    expect(rows[0].ok).toBe(1);
  });

  test("framework tables exist", async () => {
    const { rows } = await pool.query(`
      SELECT COUNT(*)::int AS n
      FROM information_schema.tables
      WHERE table_name IN ('_delta_collections', '_delta_docs', '_delta_versions', '_delta_ops_log')
    `);
    expect(rows[0].n).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// docTypeFromDef — open, apply, openAt via the generic handler.
// ---------------------------------------------------------------------------

describe("docTypeFromDef", () => {
  test("open returns empty collection when no rows exist", async () => {
    const type = docTypeFromDef(defineDoc("items:", { root: "items", include: [] }), pool);
    const result = await type.open({}, "items:");
    expect(result).not.toBeNull();
    expect(result!.result).toHaveProperty("items");
    // delta_open returns collections keyed by id: { "1": {...}, "2": {...} }
    expect(typeof result!.result.items).toBe("object");
    expect(Object.keys(result!.result.items).length).toBe(0);
    expect(result!.version).toBe(0);
  });

  test("apply add → open returns the row", async () => {
    const type = docTypeFromDef(defineDoc("items:", { root: "items", include: [] }), pool);
    const applied = await type.apply({}, "items:", [
      { op: "add", path: "/items/-", value: { name: "alpha", value: 1 } },
    ]);
    expect(applied.version).toBeGreaterThan(0);

    const result = await type.open({}, "items:");
    const rows = Object.values(result!.result.items) as any[];
    expect(rows.length).toBe(1);
    expect(rows[0].name).toBe("alpha");
    expect(rows[0].value).toBe(1);
  });

  test("apply replace updates the row: a field, or the row whole (a replace of a row is the row: todo #3)", async () => {
    const type = docTypeFromDef(defineDoc("items:", { root: "items", include: [] }), pool);
    await type.apply({}, "items:", [
      { op: "add", path: "/items/-", value: { name: "a", value: 1 } },
    ]);
    const { rows } = await pool.query("SELECT id FROM items ORDER BY id DESC LIMIT 1");
    const id = rows[0].id;

    await type.apply({}, "items:", [
      { op: "replace", path: `/items/${id}/value`, value: 99 },
    ]);
    const updated = (await type.open({}, "items:"))!.result.items[String(id)] as any;
    expect([updated.name, updated.value]).toEqual(["a", 99]);

    await expect(type.apply({}, "items:", [{ op: "replace", path: `/items/${id}`, value: { value: 7 } }])).rejects.toMatchObject({ code: "23502" });
    await type.apply({}, "items:", [{ op: "replace", path: `/items/${id}`, value: { name: "b", value: 7 } }]);
    const whole = (await type.open({}, "items:"))!.result.items[String(id)] as any;
    expect([whole.name, whole.value]).toEqual(["b", 7]);
  });

  test("apply remove deletes the row", async () => {
    const type = docTypeFromDef(defineDoc("items:", { root: "items", include: [] }), pool);
    await type.apply({}, "items:", [
      { op: "add", path: "/items/-", value: { name: "doomed" } },
    ]);
    const { rows } = await pool.query("SELECT id FROM items LIMIT 1");
    const id = rows[0].id;

    await type.apply({}, "items:", [{ op: "remove", path: `/items/${id}` }]);

    const result = await type.open({}, "items:");
    expect(Object.keys(result!.result.items).length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// createDocListener — end-to-end WS flow: open tracks doc, delta triggers
// NOTIFY, listener fans out via ws.publish.
// ---------------------------------------------------------------------------

describe("createDocListener (end-to-end WS flow)", () => {
  test("open → delta → LISTEN/NOTIFY → ws.publish", async () => {
    const ws = createWs();
    const published: { channel: string; data: any }[] = [];
    ws.publish = (channel: string, data: any) => { published.push({ channel, data }); };

    const listener = await createDocListener(ws, pool, { types: [items()] });
    try {
      // Open the doc so the listener starts tracking it.
      const reader = mockClient();
      const openRes = await sendAndAwait(ws, reader, { action: "open", doc: "items:" });
      expect(openRes.result).toBeDefined();
      expect(openRes.result).toHaveProperty("items");

      // Apply an op via another client.
      const writer = mockClient();
      const delta = await sendAndAwait(ws, writer, {
        action: "delta",
        doc: "items:",
        ops: [{ op: "add", path: "/items/-", value: { name: "ws-hello" } }],
      });
      expect(delta.result?.ack).toBe(true);
      expect(delta.result?.version).toBeGreaterThan(0);

      // NOTIFY fires asynchronously from Postgres — poll for the publish.
      await waitFor(() => published.length > 0, { timeout: 3000 });
      expect(published[0]!.channel).toBe("items:");
      expect(published[0]!.data.doc).toBe("items:");
      expect(published[0]!.data.ops).toBeDefined();
      expect(Array.isArray(published[0]!.data.ops)).toBe(true);
    } finally {
      await listener.destroy();
    }
  });

  test("a DocType written by hand is told its own writes, and no other's: the database cannot know what its open reads", async () => {
    const ws = createWs();
    const published: { channel: string; data: any }[] = [];
    ws.publish = (channel: string, data: any) => { published.push({ channel, data }); };
    // a count of the items: its open reads them, its write logs its ops for the listener to tell
    const counted: DocType = {
      prefix: "items-count:",
      parse: (name) => (name === "items-count:" ? {} : null),
      async open() { return { result: { n: (await pool.query("SELECT count(*)::int AS n FROM items")).rows[0].n }, version: 0 }; },
      async apply(_ctx, name, ops) {
        return { version: Number((await pool.query("SELECT _delta_bump_and_notify($1, $2::jsonb) AS v", [name, JSON.stringify(ops)])).rows[0].v) };
      },
    };
    const listener = await createDocListener(ws, pool, { types: [items(), counted] });
    try {
      const reader = mockClient();
      expect((await sendAndAwait(ws, reader, { action: "open", doc: "items-count:" })).result).toEqual({ n: 0 });
      await sendAndAwait(ws, mockClient(), { action: "delta", doc: "items:", ops: [{ op: "add", path: "/items/-", value: { name: "unheard" } }] });
      await sendAndAwait(ws, reader, { action: "delta", doc: "items-count:", ops: [{ op: "replace", path: "/n", value: 1 }] });
      await waitFor(() => published.some((p) => p.channel === "items-count:"), { timeout: 3000 });
      await new Promise((r) => setTimeout(r, 200));
      expect(published.filter((p) => p.channel === "items-count:").map((p) => p.data.ops)).toEqual([[{ op: "replace", path: "/n", value: 1 }]]);
    } finally {
      await listener.destroy();
    }
  });

  test("a DocType that refuses a write with a wire code of its own is answered with it; any other refusal is the server's", async () => {
    const ws = createWs();
    ws.publish = () => {};
    const refusing = (prefix: string, code: unknown): DocType => ({
      ...items(),
      prefix,
      parse: (name) => (name === prefix ? {} : null),
      async apply() { throw Object.assign(new Error(`${prefix} refuses`), { code }); },
    });
    const listener = await createDocListener(ws, pool, { types: [refusing("read-only:", 403), refusing("odd:", 600), refusing("named:", "403")] });
    try {
      const write = async (doc: string) => (await sendAndAwait(ws, mockClient(), { action: "delta", doc, ops: [{ op: "add", path: "/items/-", value: { name: "x" } }] })).error;
      expect(await write("read-only:")).toMatchObject({ code: 403, message: "read-only: refuses" });
      expect((await write("odd:"))?.code).toBe(500);
      expect((await write("named:"))?.code).toBe(500);
    } finally {
      await listener.destroy();
    }
  });

  test("delta without doc returns 400", async () => {
    const ws = createWs();
    ws.publish = () => {};
    const listener = await createDocListener(ws, pool, { types: [items()] });
    try {
      const client = mockClient();
      const res = await sendAndAwait(ws, client, { action: "open" });
      expect(res.error?.code).toBe(400);
      expect(res.error?.message).toMatch(/doc is required/);
    } finally {
      await listener.destroy();
    }
  });

  test("open on unknown prefix returns 404", async () => {
    const ws = createWs();
    ws.publish = () => {};
    const listener = await createDocListener(ws, pool, { types: [items()] });
    try {
      const client = mockClient();
      const res = await sendAndAwait(ws, client, { action: "open", doc: "ghost:" });
      expect(res.error?.code).toBe(404);
    } finally {
      await listener.destroy();
    }
  });

  test("close → unsubscribes and removes from tracked set", async () => {
    const ws = createWs();
    ws.publish = () => {};
    const listener = await createDocListener(ws, pool, { types: [items()] });
    try {
      const client = mockClient();
      await sendAndAwait(ws, client, { action: "open", doc: "items:" });
      expect(client.subscriptions.has("items:")).toBe(true);
      const closed = await sendAndAwait(ws, client, { action: "close", doc: "items:" });
      expect(closed.result?.ack).toBe(true);
      expect(client.subscriptions.has("items:")).toBe(false);
    } finally {
      await listener.destroy();
    }
  });

  test("auth gate rejects with 401 when auth is configured and gate returns error", async () => {
    const ws = createWs();
    ws.publish = () => {};
    const listener = await createDocListener(ws, pool, {
      // with auth, a document says who owns it: this list is everyone's
      types: [docTypeFromDef(defineDoc("items:", { root: "items", include: [] }), pool, { auth: { gate: () => ({ error: "no" }) }, shared: true })],
      auth: {
        gate: () => ({ error: "no" }),
      },
    });
    try {
      const client = mockClient();
      const res = await sendAndAwait(ws, client, { action: "open", doc: "items:" });
      expect(res.error?.code).toBe(401);
      expect(res.error?.message).toBe("no");
    } finally {
      await listener.destroy();
    }
  });
});

// ---------------------------------------------------------------------------
// Snapshots and ops-log maintenance
// ---------------------------------------------------------------------------

describe("snapshots + pruneOpsLog", () => {
  test("a list read as it stood (openAt) reads as it is where the table keeps no history", async () => {
    const type = docTypeFromDef(defineDoc("items:", { root: "items", include: [] }), pool);
    await type.apply({}, "items:", [
      { op: "add", path: "/items/-", value: { name: "t1" } },
    ]);
    // a list, and `items` keeps no history: read as it is, as on SQLite (#74)
    const doc = await type.openAt!({}, "items:", new Date().toISOString());
    expect(Object.values(doc.items).map((r: any) => r.name)).toEqual(["t1"]);
  });

  test("delta_snapshot + delta_resolve_snapshot round-trip; an unknown name is null", async () => {
    const ts = (await pool.query("SELECT delta_snapshot($1, $2) AS ts", ["pre-op", new Date().toISOString()])).rows[0]?.ts;
    expect(ts).toBeDefined();
    const resolve = async (name: string) => (await pool.query("SELECT delta_resolve_snapshot($1) AS ts", [name])).rows[0]?.ts ?? null;
    // Both come back as Date values from pg — compare structurally.
    expect(await resolve("pre-op")).toEqual(ts);
    expect(await resolve("never-saved")).toBeNull();
  });

  test("pruneOpsLog returns a non-negative count", async () => {
    const type = docTypeFromDef(defineDoc("items:", { root: "items", include: [] }), pool);
    await type.apply({}, "items:", [
      { op: "add", path: "/items/-", value: { name: "old" } },
    ]);
    const pruned = await pruneOpsLog(pool, "0 seconds");
    expect(pruned).toBeGreaterThanOrEqual(0);
  });
});

// ---------------------------------------------------------------------------
// Fail-fast — config errors must raise, not silently return NULL
// ---------------------------------------------------------------------------

describe("fail-fast on config errors", () => {
  test("delta_open raises when the doc prefix is not registered", async () => {
    await expect(
      pool.query("SELECT delta_open($1) AS doc", ["bogus:42"]),
    ).rejects.toThrow(/no doc def for: bogus:42/);
  });

  // A definition the compiler cannot compile is refused when the SQL is written, naming what it lacks.
  const compiling = (doc: ReturnType<typeof defineDoc>) => () => generateSql(defineSchema(itemsTables), [doc]);

  test("a document whose root is no collection is refused", () => {
    expect(compiling(defineDoc("ghost:", { root: "no_such_collection", include: [] }))).toThrow(/no_such_collection/);
  });

  test("a scope key that isn't a real column is refused", () => {
    // "items.id" is the dotted-key footgun — not a column of the items table.
    expect(compiling(defineDoc("bad:", { root: "items", include: [], scope: { "items.id": ":id" } }))).toThrow(/scope key "items\.id" is not a column of "items"/);
  });

  test("a junk scope operator (e.g. '<<<:x') is refused rather than producing bad SQL", () => {
    expect(compiling(defineDoc("bad-op:", { root: "items", include: [], scope: { name: "<<<:foo" } }))).toThrow(/invalid scope operator/);
  });
});

// ---------------------------------------------------------------------------
// Scope DSL — each operator produces the right WHERE / mode
// ---------------------------------------------------------------------------

describe("scope DSL operators", () => {
  async function resolve(prefix: string, docName: string) {
    const { rows } = await pool.query(
      `SELECT _delta_resolve_scope(_delta_find_doc($2), $1) AS r`,
      [docName, prefix],
    );
    return rows[0].r as { where: string; mode: string; values: Record<string, unknown>; at: string | null };
  }

  // Identifiers come out unquoted when they don't require quoting ("id", "name"
  // are safe bare); %L always single-quotes the literal.

  test("':id' shorthand → col = <id>, single mode", async () => {
    const r = await resolve("s1:", "s1:42");
    expect(r.where).toBe("id = '42'");
    expect(r.mode).toBe("single");
    expect(r.values.id).toBe("42");
  });

  test("'=:name' → col = <name>, list mode if key isn't 'id'", async () => {
    const r = await resolve("s2:", "s2:hello");
    expect(r.where).toBe("name = 'hello'");
    expect(r.mode).toBe("list");
  });

  test("'>=:start' → col >= <param>", async () => {
    const r = await resolve("s3:", "s3:5");
    expect(r.where).toBe("value >= '5'");
    expect(r.mode).toBe("list");
  });

  test("'<=:end' → col <= <param>", async () => {
    const r = await resolve("s4:", "s4:10");
    expect(r.where).toBe("value <= '10'");
    expect(r.mode).toBe("list");
  });

  test("'like:prefix' → col ILIKE '<param>%'", async () => {
    const r = await resolve("s5:", "s5:foo");
    expect(r.where).toBe("name ILIKE 'foo%'");
    expect(r.mode).toBe("list");
  });

  test("multiple scope keys are AND'd", async () => {
    const r = await resolve("s6:", "s6:7:hello");
    expect(r.where).toContain("id = '7'");
    expect(r.where).toContain("name = 'hello'");
    expect(r.where).toContain(" AND ");
    expect(r.mode).toBe("single");  // 'id' equality → single mode
  });

  test("empty scope with an id in the doc name → defaults to WHERE id = <id>", async () => {
    const r = await resolve("s7:", "s7:99");
    expect(r.where).toMatch(/id = '99'/);
    expect(r.mode).toBe("single");
  });

  test("'at:when' → populates r.at, not WHERE (temporal snapshot marker)", async () => {
    // `at:` is a sentinel that feeds delta_open_at's `at` parameter rather
    // than adding to the WHERE — scope resolution just pulls it out.
    const r = await resolve("at-op:", "at-op:2026-06-01");
    expect(r.at).toBe("2026-06-01 00:00:00+00");   // the instant midnight UTC begins the day, whatever the session's TimeZone
    // No WHERE contribution — the 'at' op short-circuits the filter branch.
    expect(r.where).not.toContain("valid_from");
  });

  test("empty scope with no id in the doc name → list mode, WHERE TRUE", async () => {
    const r = await resolve("s8:", "s8:");
    expect(r.where).toBe("TRUE");
    expect(r.mode).toBe("list");
  });

  test("delta_open_at returns historical state before the replace landed", async () => {
    const type = docTypeFromDef(
      defineDoc("t:", { root: "items_t", include: [] }),
      pool,
    );

    // Add a row.
    await type.apply({}, "t:", [
      { op: "add", path: "/items_t/-", value: { name: "original", value: 1 } },
    ]);
    const { rows } = await pool.query(
      "SELECT id FROM current_items_t WHERE name = 'original'",
    );
    const id = rows[0].id as string;

    // Capture a timestamp BETWEEN the add and the replace.
    await new Promise((r) => setTimeout(r, 10));
    const snapshotAt = new Date().toISOString();
    await new Promise((r) => setTimeout(r, 10));

    // Update the row — temporal tables will retain the old version.
    await type.apply({}, "t:", [
      { op: "replace", path: `/items_t/${id}/name`, value: "updated" },
    ]);

    // Current state sees the update; snapshotAt sees the original.
    const current = await type.openAt!({}, `t:${id}`, new Date().toISOString());
    expect(current?.items_t?.name).toBe("updated");

    const historical = await type.openAt!({}, `t:${id}`, snapshotAt);
    expect(historical?.items_t?.name).toBe("original");
  });

  test("':id' end-to-end — delta_open('p:N') returns only rows where id=N", async () => {
    // Seed a couple of rows, then open by id.
    await pool.query("INSERT INTO items (name, value) VALUES ('a', 1), ('b', 2), ('c', 3)");
    const { rows: ids } = await pool.query("SELECT id FROM items ORDER BY id");
    const target = ids[1].id;   // middle row

    const { rows } = await pool.query(
      "SELECT delta_open($1) AS doc",
      [`endto:${target}`],
    );
    const doc = rows[0].doc;
    expect(doc).not.toBeNull();
    // Single mode puts the row under the root_collection key.
    expect(doc.items).toBeDefined();
    expect(Number(doc.items.id)).toBe(Number(target));
    expect(doc.items.name).toBe("b");
  });
});

// ---------------------------------------------------------------------------
// List-mode `include` — catalog-shaped docs (root + child collections loaded
// in full, no FK filter). Lets a small reference table + its children open
// as a single doc via plain defineDoc() instead of a hand-written DocType.
// ---------------------------------------------------------------------------

describe("list-mode include", () => {
  beforeEach(async () => {
    await pool.query("TRUNCATE products, parts, parts_t");
  });

  test("delta_open returns root AND every included collection in full", async () => {
    await pool.query(`
      INSERT INTO products (id, name) VALUES (1, 'widget'), (2, 'gadget');
      INSERT INTO parts (id, products_id, label) VALUES
        (10, 1, 'screw'),
        (11, 1, 'spring'),
        (20, 2, 'gear');
    `);

    const { rows } = await pool.query("SELECT delta_open($1) AS doc", ["catalog:"]);
    const doc = rows[0].doc;

    expect(doc.products).toBeDefined();
    expect(Object.keys(doc.products).sort()).toEqual(["1", "2"]);

    // Children load unfiltered: every parts row appears, not just children of
    // any one product. This is the whole point of list-mode include.
    expect(doc.parts).toBeDefined();
    expect(Object.keys(doc.parts).sort()).toEqual(["10", "11", "20"]);
    expect(doc.parts["10"].label).toBe("screw");
    expect(doc.parts["20"].label).toBe("gear");
  });

  test("empty include is unchanged (backwards-compat: only root)", async () => {
    await pool.query(`
      INSERT INTO products (id, name) VALUES (1, 'widget');
      INSERT INTO parts (id, products_id, label) VALUES (10, 1, 'screw');
    `);

    const { rows } = await pool.query("SELECT delta_open($1) AS doc", ["catalog-root:"]);
    const doc = rows[0].doc;

    expect(doc.products).toBeDefined();
    expect(doc.parts).toBeUndefined();
  });

  test("write to an included collection bumps the doc version", async () => {
    await pool.query("INSERT INTO products (id, name) VALUES (1, 'widget')");

    const def = defineDoc("catalog:", { root: "products", include: ["parts"] });
    const type = docTypeFromDef(def, pool);

    const before = await type.open({}, "catalog:");
    const v0 = before!.version;

    // Add a `parts` row through the list-mode doc — the path-based router in
    // delta_apply already knows how to route this; we're just confirming the
    // doc version bumps so live ops will fire.
    const applied = await type.apply({}, "catalog:", [
      { op: "add", path: "/parts/-", value: { products_id: 1, label: "screw" } },
    ]);
    expect(applied.version).toBeGreaterThan(v0);
    const ops = applied.ops!;
    expect(ops.length).toBe(1);
    expect(ops[0]!.op).toBe("add");
    expect(ops[0]!.path).toMatch(/^\/parts\/\d+$/);

    // Re-opening sees the new parts row in the list-mode payload.
    const after = await type.open({}, "catalog:");
    const parts = after!.result.parts as Record<string, { label: string }>;
    expect(Object.values(parts).map((p) => p.label)).toContain("screw");
  });

  test("temporal include passes v_at through (current rows for current open)", async () => {
    // parts_t: the parts, temporal, to exercise the temporal branch of the list read
    await pool.query(`
      INSERT INTO products (id, name) VALUES (1, 'widget');
      INSERT INTO parts_t (id, products_id, label, valid_from) VALUES (10, 1, 'screw', NOW());
    `);

    const { rows } = await pool.query("SELECT delta_open($1) AS doc", ["catalog-t:"]);
    const doc = rows[0].doc;

    expect(doc.parts_t["10"].label).toBe("screw");
    // Temporal columns are stripped on the way out.
    expect(doc.parts_t["10"].valid_from).toBeUndefined();
    expect(doc.parts_t["10"].valid_to).toBeUndefined();
  });
});
