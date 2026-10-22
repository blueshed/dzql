import { describe, expect, setSystemTime, test } from "bun:test";
import { Database } from "bun:sqlite";
import { createTables, defineDoc, defineSchema, registerDocs } from "@blueshed/delta/sqlite";
import { createLocal } from "@blueshed/delta/local";
import { sessionRows } from "../../src/rendering/sessions";

const hashOf = (cookie: string): string => new Bun.CryptoHasher("sha256").update(cookie).digest("hex");

/** Sessions as an example keeps them: a row each, found by its cookie's hash through `visit:`. */
function kept() {
  const db = new Database(":memory:");
  const schema = defineSchema({ sessions: { table: "sessions", columns: { who: "text?", cookie: "text?" }, temporal: false } });
  createTables(db, schema);
  const delta = createLocal();
  registerDocs(delta.server, db, schema, [defineDoc("session:", { root: "sessions", include: [], columns: { sessions: ["who"] } })]);
  registerDocs(delta.server, db, schema, [defineDoc("visit:", { root: "sessions", scope: { cookie: ":cookie" }, include: [] })]);
  return { db, delta, sessions: sessionRows(delta, "sessions") };
}

describe("a session is a numbered row, named by its cookie", () => {
  test("a new cookie makes a row, numbered by the serial; the same cookie finds it again; the row keeps its hash, never the cookie", async () => {
    const { db, sessions } = kept();
    const first = await sessions.of("one");
    expect(first).toBe("1");
    expect(await sessions.of("two")).toBe("2");
    expect(await sessions.of("one")).toBe("1");
    expect(db.query("SELECT id, cookie FROM sessions ORDER BY id").all()).toEqual([
      { id: 1, cookie: hashOf("one") },
      { id: 2, cookie: hashOf("two") },
    ]);
  });

  test("two tabs opening at once on a new cookie make one row", async () => {
    const { db, sessions } = kept();
    expect(await Promise.all([sessions.of("tab"), sessions.of("tab")])).toEqual(["1", "1"]);
    expect(db.query("SELECT COUNT(*) AS n FROM sessions").get()).toEqual({ n: 1 });
  });

  test("a sign-in starts a fresh cookie, its row holding who it is; the session's document shows them, and not the hash", async () => {
    const { delta, sessions } = kept();
    const { cookie, sessionId } = await sessions.start({ who: "ann" });
    expect(cookie).toMatch(/^[0-9a-f-]{36}$/);
    expect(await sessions.of(cookie)).toBe(sessionId);
    expect((await delta.call("open", { doc: `session:${sessionId}` })).result).toEqual({ sessions: { id: Number(sessionId), who: "ann" } });
  });

  test("a session kept with when it was last used lasts thirty days unused, renewed as it is used: past them its cookie names a fresh one, and the old row is let go", async () => {
    const db = new Database(":memory:");
    const schema = defineSchema({ sessions: { table: "sessions", columns: { who: "text?", cookie: "text?", seen: "timestamptz?" }, temporal: false } });
    createTables(db, schema);
    const delta = createLocal();
    registerDocs(delta.server, db, schema, [defineDoc("visit:", { root: "sessions", scope: { cookie: ":cookie" }, include: [] }), defineDoc("expired:", { root: "sessions", scope: { seen: "<:before" }, include: [] })]);
    const sessions = sessionRows(delta, "sessions", "visit:", { seen: "seen", expired: "expired:" });
    const seen = (id: string) => (db.query("SELECT seen FROM sessions WHERE id = ?").get(id) as { seen: string } | null)?.seen;
    const day = 86_400_000;
    try {
      const { cookie, sessionId } = await sessions.start({ who: "ann" });
      const made = seen(sessionId)!;
      expect(Date.parse(made)).toBeGreaterThan(Date.now() - 1000);
      setSystemTime(new Date(Date.now() + 2 * 3600_000));
      expect(await sessions.of(cookie)).toBe(sessionId);
      expect(seen(sessionId)).toBe(made); // within a day of its last renewal: not written again
      setSystemTime(new Date(Date.parse(made) + 29 * day));
      expect(await sessions.of(cookie)).toBe(sessionId); // used on its 29th day: renewed
      expect(Date.parse(seen(sessionId)!)).toBe(Date.parse(made) + 29 * day);
      const anon = await sessions.of("a-bot"); // a visit never seen again
      setSystemTime(new Date(Date.parse(made) + 60 * day)); // thirty-one days unused
      const fresh = await sessions.of(cookie);
      expect(fresh).not.toBe(sessionId); // a stolen cookie is nobody now
      expect(db.query("SELECT who FROM sessions WHERE id = ?").get(fresh)).toEqual({ who: null });
      expect(db.query("SELECT id FROM sessions ORDER BY id").all()).toEqual([{ id: Number(fresh) }]); // the expired rows let go: hers, and the bot's
      expect(anon).not.toBe(fresh);
    } finally {
      setSystemTime();
    }
  });

  test("what the store refuses is thrown, and the next visit is found all the same", async () => {
    const { sessions } = kept();
    await expect(sessions.start({ nobody: 1 })).rejects.toThrow("delta visit:");
    expect(await sessions.of("after")).toBe("1"); // refused before the serial was asked
  });
});
