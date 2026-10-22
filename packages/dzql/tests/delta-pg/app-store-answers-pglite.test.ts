/**
 * How the Postgres listener answers, on PGlite: what an app's own constraints and triggers refuse
 * is the writer's (todo #94: a CHECK 400, an exclusion 409, a trigger's RAISE 400); a 5xx says no
 * more than that the server failed, its detail logged (todo #103); history answers 100 entries at
 * most, and a socket holds so many documents open at once (todo #106); and with custom documents
 * defined but none open, a write reads nothing more of the log for them (todo #101).
 */
import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import type { Pool } from "pg";
import { setLogLevel } from "@blueshed/delta/logger";
import { createTable } from "@blueshed/delta/migrations";
import { createWs } from "@blueshed/delta/server";
import { mockClient, sendAndAwait } from "@blueshed/delta/testing";
import { applyFramework, createDocListener, defineCustomDoc, defineDoc, defineSchema, docTypeFromDef, generateSql, applySql, openStore } from "../../src/postgres";
import { SERVER_FAILED } from "../../src/postgres/listener";
import { openPglite } from "../../src/postgres/pglite";

setLogLevel("silent");

const schema = defineSchema({ bookings: { columns: { room: "text", lo: "integer", hi: "integer", amount: "integer" }, temporal: false } });
const bookings = defineDoc("bookings:", { root: "bookings", include: [] });
const history = [
  { id: "001-bookings", changes: [createTable("bookings", { columns: { room: { type: "text" }, lo: { type: "integer" }, hi: { type: "integer" }, amount: { type: "integer" } }, temporal: false })] },
  {
    id: "002-rules",
    up: async (tx: any) => {
      await tx.query("ALTER TABLE bookings ADD CONSTRAINT bookings_paid CHECK (amount >= 0)");
      await tx.query("ALTER TABLE bookings ADD CONSTRAINT bookings_once EXCLUDE USING gist (int8range(lo, hi) WITH &&)");
      await tx.query(`CREATE FUNCTION bookings_rules() RETURNS trigger AS $$
        BEGIN
          IF NEW.room = 'closed' THEN RAISE EXCEPTION 'that room is closed'; END IF;
          IF NEW.room = 'broken' THEN PERFORM 1 / 0; END IF;
          RETURN NEW;
        END $$ LANGUAGE plpgsql`);
      await tx.query("CREATE TRIGGER bookings_rules BEFORE INSERT ON bookings FOR EACH ROW EXECUTE FUNCTION bookings_rules()");
    },
  },
] as any[];

describe("openStore's answers", () => {
  const folder = mkdtempSync(`${tmpdir()}/answers-`); // a folder of its own, whatever DATABASE_URL says
  const store = openStore({ schema, database: folder, migrations: { list: history, app: "bookings", schema } });
  store.register([bookings]);
  const book = (value: Record<string, unknown>) => store.owner.call("delta", { doc: "bookings:", ops: [{ op: "add", path: "/bookings/-", value: { room: "blue", lo: 1, hi: 2, amount: 10, ...value } }] });
  beforeAll(() => store.open(), 60_000);
  afterAll(async () => { await store.close(); rmSync(folder, { recursive: true, force: true }); }, 60_000);

  test("an app's constraints and triggers, added in a migration, refuse as the writer's mistake: CHECK 400, exclusion 409, RAISE 400", async () => {
    expect((await book({ lo: 1, hi: 5 })).error).toBeUndefined();
    expect((await book({ lo: 10, hi: 12, amount: -1 })).error).toMatchObject({ code: 400, message: expect.stringContaining("bookings_paid") });
    expect((await book({ lo: 3, hi: 7 })).error).toMatchObject({ code: 409, message: expect.stringContaining("bookings_once") });
    expect((await book({ lo: 20, hi: 21, room: "closed" })).error).toEqual({ code: 400, message: "that room is closed" });
  }, 60_000);

  test("a 5xx says the server failed and no more; what went wrong is logged", async () => {
    setLogLevel("error");
    const logged = spyOn(console, "error").mockImplementation(() => {});
    try {
      expect((await book({ lo: 30, hi: 31, room: "broken" })).error).toEqual({ code: 500, message: SERVER_FAILED });
      expect(logged.mock.calls.map((c) => String(c[0])).join("\n")).toContain("division by zero");
    } finally {
      logged.mockRestore();
      setLogLevel("silent");
    }
  }, 60_000);

  test("history answers 50 entries unless it asks, and never more than 100 whatever it asks", async () => {
    for (let i = 0; i < 105; i++) expect((await book({ lo: 100 + 2 * i, hi: 101 + 2 * i })).error).toBeUndefined();
    const entries = async (limit?: unknown) => (await store.owner.call("history", { doc: "bookings:", ...(limit === undefined ? {} : { limit }) })).result.length;
    expect(await entries()).toBe(50);
    expect(await entries(1000)).toBe(100);
    expect(await entries(7)).toBe(7);
    expect(await entries(-3)).toBe(1);
  }, 120_000);
});

describe("the listener on a socket", () => {
  let pool: Pool;
  const notes = defineDoc("note:", { root: "notes", include: [], implied: true });
  const notesSchema = defineSchema({ notes: { columns: { text: "text" }, temporal: false } });
  beforeAll(async () => {
    pool = await openPglite();
    await applyFramework(pool);
    await applySql(pool, generateSql(notesSchema, [notes]));
  }, 60_000);
  afterAll(() => pool.end());

  test("a socket holds so many documents open at once: one more is refused, 429, until it closes one", async () => {
    const ws = createWs();
    ws.setServer({ publish: () => {} } as any);
    const listener = await createDocListener(ws, pool, { types: [docTypeFromDef(notes, pool)], maxOpen: 3 });
    try {
      const socket = mockClient({ clientId: "a" });
      for (const id of [1, 2, 3]) expect((await sendAndAwait(ws, socket, { action: "open", doc: `note:${id}` })).error).toBeUndefined();
      expect((await sendAndAwait(ws, socket, { action: "open", doc: "note:4" })).error).toMatchObject({ code: 429, message: expect.stringContaining("Too many documents open") });
      expect((await sendAndAwait(ws, socket, { action: "open", doc: "note:2" })).error).toBeUndefined(); // one it holds, again
      expect((await sendAndAwait(ws, mockClient({ clientId: "b" }), { action: "open", doc: "note:4" })).error).toBeUndefined(); // another socket's own
      await sendAndAwait(ws, socket, { action: "close", doc: "note:1" });
      expect((await sendAndAwait(ws, socket, { action: "open", doc: "note:4" })).error).toBeUndefined();
    } finally {
      await listener.destroy();
    }
  }, 60_000);

  test("with a custom document defined but none open, a write reads the log for no one; once one is open, it does", async () => {
    let reads = 0;
    const counted = new Proxy(pool, {
      get(target, key) {
        const value = (target as any)[key];
        if (key !== "query") return typeof value === "function" ? value.bind(target) : value;
        return (text: string, params?: unknown[]) => { if (/_delta_fetch_log/.test(text)) reads++; return target.query(text, params as any); };
      },
    });
    const told: unknown[] = [];
    const ws = createWs();
    ws.setServer({ publish: (channel: string) => void told.push(channel) } as any);
    const everyNote = defineCustomDoc("every-note:", { watch: ["notes"], parse: () => ({}), matches: () => true, query: async (p) => ({ notes: (await p.query("SELECT id::text, text FROM notes")).rows }) });
    const listener = await createDocListener(ws, counted, { types: [docTypeFromDef(notes, counted)], custom: [everyNote] });
    // written in this process, holding nothing open: the log is read only for the custom documents
    const writer = mockClient({ clientId: "writer", local: true });
    const write = async (text: string) => {
      expect((await sendAndAwait(ws, writer, { action: "delta", doc: "note:", ops: [{ op: "add", path: "/notes/-", value: { text } }] })).error).toBeUndefined();
      for (let i = 0; i < 20; i++) await pool.query("SELECT 1"); // the notification heard
    };
    try {
      await write("unseen");
      expect(reads).toBe(0);
      const viewer = mockClient({ clientId: "viewer" });
      expect((await sendAndAwait(ws, viewer, { action: "open", doc: "every-note:" })).error).toBeUndefined();
      await write("seen");
      expect(reads).toBeGreaterThan(0);
      expect(told).toContain("every-note:");
    } finally {
      await listener.destroy();
    }
  }, 60_000);
});
