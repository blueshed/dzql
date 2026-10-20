/**
 * A document's own rule is given who is writing (`accept`'s `who`), on Postgres in process
 * (PGlite), as delta's tests/accept.test.ts asks SQLite and the JSON file: a list everyone signed
 * in reads, written only by an admin, and an undo is not asked. The rule's refusals are delta's
 * `acceptCases`, in writes.test.ts.
 */
import { afterAll, beforeAll, expect, test } from "bun:test";
import type { Pool } from "pg";
import { applyFramework, applySql, createDocListener, docTypeFromDef, generateSql } from "../../src/postgres";
import { openPglite } from "../../src/postgres/pglite";
import { createLocal } from "@blueshed/delta/local";
import { setLogLevel } from "@blueshed/delta/logger";
import { defineDoc, defineSchema } from "@blueshed/delta/backend";
import { auth, type Me } from "@blueshed/delta/testing";

setLogLevel("silent");

const ADMIN = 1;
const schema = defineSchema({ accept_notes: { columns: { text: "text" } } });
const docs = [defineDoc("accept-board:", {
  root: "accept_notes",
  include: [],
  accept: (op, { who }) => op.op === "remove" ? "A note stays: it is never removed" : (who as Me | undefined)?.id === ADMIN || "Only an admin writes the board",
})];

let pool: Pool;
beforeAll(async () => {
  pool = await openPglite();
  await applyFramework(pool);
  await applySql(pool, generateSql(schema, docs));
});
afterAll(async () => { await pool.end(); });

test("everyone signed in reads the board, an admin writes it, and an undo is not asked", async () => {
  const local = createLocal();
  const types = docs.map((def) => docTypeFromDef<Me>(def, pool, { auth, shared: true }));
  const listener = await createDocListener(local.server, pool, { types, auth, ledger: true });
  try {
    const admin = local.as({ id: ADMIN }), bo = local.as({ id: 2 });
    await admin.call("open", { doc: "accept-board:" });
    await bo.call("open", { doc: "accept-board:" });
    const add = (text: string) => ({ doc: "accept-board:", cursor: "admin", ops: [{ op: "add", path: "/accept_notes/-", value: { text } }] });
    expect((await bo.call("delta", add("mine now"))).error).toEqual({ code: 400, message: "Only an admin writes the board" });
    expect((await admin.call("delta", add("keys at the desk"))).error).toBeUndefined();
    expect((await admin.call("delta", add("lights off"))).error).toBeUndefined();
    const texts = async () => Object.values((await bo.call("open", { doc: "accept-board:" })).result.accept_notes as Record<string, { text: string }>).map((n) => n.text);
    expect(await texts()).toEqual(["keys at the desk", "lights off"]);
    expect((await admin.call("delta", { doc: "accept-board:", cursor: "admin", ops: [{ op: "remove", path: "/accept_notes/1" }] })).error).toEqual({ code: 400, message: "A note stays: it is never removed" });
    // the admin's undo removes what it added, and the rule is not asked of it: it puts back what was
    expect((await admin.call("undo", { cursor: "admin" })).error).toBeUndefined();
    expect(await texts()).toEqual(["keys at the desk"]);
  } finally {
    await listener.destroy();
  }
});
