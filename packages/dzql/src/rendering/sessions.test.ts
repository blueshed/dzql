import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { createTables, defineDoc, defineSchema, registerDocs } from "@blueshed/delta/sqlite";
import { createLocal } from "@blueshed/delta/local";
import { sessionRows } from "./sessions";

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

  test("what the store refuses is thrown, and the next visit is found all the same", async () => {
    const { sessions } = kept();
    await expect(sessions.start({ nobody: 1 })).rejects.toThrow("delta visit:");
    expect(await sessions.of("after")).toBe("1"); // refused before the serial was asked
  });
});
