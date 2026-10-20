/**
 * A document's own rule is given who is writing (`accept`'s `who`): a list everyone signed in
 * reads, written only by an admin; with no sign-in, the writer is no one; an undo is not asked. The rule's refusals, the same on every backend, are `acceptCases` (src/cases/writes.ts).
 */
import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTables, defineDoc, defineSchema, registerDocs } from "../src/server/sqlite";
import * as json from "../src/server/json";
import { createLocal } from "../src/server/local";
import { setLogLevel } from "../src/server/logger";
import { auth, type Me } from "@blueshed/delta/testing";

setLogLevel("silent");

const ADMIN = 1;
const schema = defineSchema({ notes: { columns: { text: "text" } } });
const docs = [defineDoc("board:", {
  root: "notes",
  include: [],
  accept: (op, { who }) => op.op === "remove" ? "A note stays: it is never removed" : (who as Me | undefined)?.id === ADMIN || "Only an admin writes the board",
})];

for (const [name, register] of [
  ["SQLite", (local: ReturnType<typeof createLocal>) => {
    const db = new Database(":memory:");
    createTables(db, schema);
    registerDocs(local.server, db, schema, docs, [], { ledger: true, auth, shared: true });
  }],
  ["the JSON file", (local: ReturnType<typeof createLocal>) => {
    const dir = mkdtempSync(join(tmpdir(), "delta-accept-"));
    json.registerDocs(local.server, join(dir, "data.json"), schema, docs, [], { ledger: true, auth, shared: true });
    return () => rmSync(dir, { recursive: true, force: true });
  }],
] as const) {
  test(`${name}: everyone signed in reads the board, an admin writes it, and an undo is not asked`, async () => {
    const local = createLocal();
    const end = register(local);
    try {
      const admin = local.as({ id: ADMIN }), bo = local.as({ id: 2 });
      await admin.call("open", { doc: "board:" });
      await bo.call("open", { doc: "board:" });
      expect((await bo.call("delta", { doc: "board:", ops: [{ op: "add", path: "/notes/-", value: { text: "mine now" } }] })).error).toEqual({ code: 400, message: "Only an admin writes the board" });
      expect((await admin.call("delta", { doc: "board:", cursor: "admin", ops: [{ op: "add", path: "/notes/-", value: { text: "keys at the desk" } }] })).error).toBeUndefined();
      expect((await admin.call("delta", { doc: "board:", cursor: "admin", ops: [{ op: "add", path: "/notes/-", value: { text: "lights off" } }] })).error).toBeUndefined();
      const texts = async () => Object.values((await bo.call("open", { doc: "board:" })).result.notes as Record<string, { text: string }>).map((n) => n.text);
      expect(await texts()).toEqual(["keys at the desk", "lights off"]);
      expect((await admin.call("delta", { doc: "board:", cursor: "admin", ops: [{ op: "remove", path: "/notes/1" }] })).error).toEqual({ code: 400, message: "A note stays: it is never removed" });
      // the admin's undo removes what it added, and the rule is not asked of it: it puts back what was
      expect((await admin.call("undo", { cursor: "admin" })).error).toBeUndefined();
      expect(await texts()).toEqual(["keys at the desk"]);
    } finally {
      end?.();
    }
  });
}
