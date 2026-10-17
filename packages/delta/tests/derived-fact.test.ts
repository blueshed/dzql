/**
 * A fact from another parent's rows, worked out and never stored: whether a tool is out, and when it
 * is due back, from the open loans, which hang from members. A tool's list holds its own rows only (a
 * row has one parent), so the fact is a recompute document over both collections: read again on
 * every write to either, and told to whoever holds it. The Shed's run 2 kept it as a column on the
 * tool, written beside each loan (delta #79): a second copy, for the app's writes to keep honest.
 * The loans hold the tool once (`unique`), so a tool is out on one loan at a time.
 */
import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { createLocal } from "../src/server/local";
import { createTables, defineCustomDoc, defineDoc, defineSchema, registerDocs } from "../src/server/sqlite";
import { setLogLevel } from "../src/server/logger";

setLogLevel("silent");

const schema = defineSchema({
  tools: { columns: { name: "text" }, temporal: false, unique: ["name"] },
  members: { columns: { name: "text" }, temporal: false },
  loans: {
    parent: "members",
    columns: { tool: "integer", due: "timestamptz", returned: "timestamptz?" },
    temporal: false,
    unique: [{ columns: ["tool"], whereNull: ["returned"] }],
  },
});
const shed = defineDoc("shed:", { root: "tools", include: [] });              // the list, as Sam keeps it
const member = defineDoc("member:", { root: "members", include: ["loans"] }); // a member's basket and loans

// The board: every tool, each with whether it is out and when it is due, from the open loans.
const board = defineCustomDoc("board:", {
  watch: ["tools", "loans"],
  parse: (id: string) => id,
  recompute: (db: Database) => ({
    tools: Object.fromEntries((db.query(`
      SELECT t.id, t.name, l.id IS NOT NULL AS out, l.due
        FROM tools t LEFT JOIN loans l ON l.tool = t.id AND l.returned IS NULL
       ORDER BY t.id`).all() as any[]).map((t) => [t.id, { ...t, out: !!t.out }])),
  }),
});

function setup() {
  const db = new Database(":memory:");
  createTables(db, schema);
  db.run("INSERT INTO tools (id, name) VALUES (1, 'spade'), (2, 'rake')");
  db.run("INSERT INTO members (id, name) VALUES (1, 'ann')");
  const local = createLocal();
  const told: any[] = [];
  local.onPublish((channel, data) => { if (channel === "board:") told.push(data); });
  registerDocs(local.server, db, schema, [shed, member], [board]);
  return { local, told };
}

describe("a fact from another parent's rows, worked out", () => {
  test("a tool borrowed is out, with its due date, on the board; returned, it is in", async () => {
    const { local, told } = setup();
    expect((await local.call("open", { doc: "board:" })).result.tools[1]).toEqual({ id: 1, name: "spade", out: false, due: null });
    await local.call("open", { doc: "member:1" });
    const borrowed = await local.call("delta", { doc: "member:1", ops: [{ op: "add", path: "/loans/-", value: { tool: 1, due: "2026-11-01" } }] });
    expect(borrowed.error).toBeUndefined();
    const out = told.at(-1).ops[0];
    expect(out.op).toBe("replace");
    expect(out.value.tools[1]).toEqual({ id: 1, name: "spade", out: true, due: "2026-11-01T00:00:00+00:00" });
    expect(out.value.tools[2].out).toBe(false);

    const [loan] = Object.keys((await local.call("open", { doc: "member:1" })).result.loans);
    await local.call("delta", { doc: "member:1", ops: [{ op: "replace", path: `/loans/${loan}/returned`, value: "2026-10-20" }] });
    expect(told.at(-1).ops[0].value.tools[1].out).toBe(false);
  });

  test("a tool out is refused a second loan, 409, and the board does not change", async () => {
    const { local, told } = setup();
    await local.call("open", { doc: "board:" });
    await local.call("open", { doc: "member:1" });
    await local.call("delta", { doc: "member:1", ops: [{ op: "add", path: "/loans/-", value: { tool: 1, due: "2026-11-01" } }] });
    const again = await local.call("delta", { doc: "member:1", ops: [{ op: "add", path: "/loans/-", value: { tool: 1, due: "2026-12-01" } }] });
    expect(again.error?.code).toBe(409);
    expect(told.at(-1).ops[0].value.tools[1].due).toBe("2026-11-01T00:00:00+00:00");
  });

  test("a renamed tool is renamed on the board: the list is the tools' own rows", async () => {
    const { local, told } = setup();
    await local.call("open", { doc: "board:" });
    await local.call("open", { doc: "shed:" });
    await local.call("delta", { doc: "shed:", ops: [{ op: "replace", path: "/tools/2/name", value: "leaf rake" }] });
    expect(told.at(-1).ops[0].value.tools[2].name).toBe("leaf rake");
  });
});
