/**
 * A row a trigger changes is told to the documents holding it: `delta_touch(collection,
 * id)`, called from the trigger, adds the row to the write's touched set, and the write tells it as
 * it tells its own -- to every open document that held it before or holds it after, each what
 * changed for it.
 *
 * Here: lines kept in a journal, each adding its amount to its account's balance by a trigger; the
 * chart of accounts is open, and told the new balance of a line written through the journal. Called
 * before the trigger changes the row (as the trigger should), each field that changed is told; called
 * after, every field of the row (it cannot know what was). Outside a write it does nothing.
 */
import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test";
import type { Pool } from "pg";
import { setLogLevel } from "@blueshed/delta/logger";
import { applyFramework, applySql, defineDoc, defineSchema, generateSql } from "../../src/postgres";
import { sharedPglite } from "../helpers/pglite";

setLogLevel("silent");

let pool: Pool;

beforeAll(async () => {
  pool = await sharedPglite();
  await applyFramework(pool);
  const schema = defineSchema({
    accounts: { columns: { name: "text", balance: { type: "integer", default: 0 } }, temporal: false },
    lines: { columns: { account_id: "integer", amount: "integer" }, temporal: false },
  });
  await applySql(pool, generateSql(schema, [
    defineDoc("chart:", { root: "accounts", include: [] }),
    defineDoc("account:", { root: "accounts", include: [] }),
    defineDoc("journal:", { root: "lines", include: [] }),
  ]));
  await pool.query(`CREATE FUNCTION lines_post() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      PERFORM delta_touch('accounts', NEW.account_id);   -- before the row changes: what changed is told
      UPDATE accounts SET balance = balance + NEW.amount WHERE id = NEW.account_id;
      RETURN NEW;
    END $$`);
  await pool.query("CREATE TRIGGER lines_post AFTER INSERT ON lines FOR EACH ROW EXECUTE FUNCTION lines_post()");
});
afterAll(async () => { await pool.end(); });

beforeEach(async () => {
  await pool.query("TRUNCATE accounts, lines, _delta_ops_log, _delta_held, _delta_versions");
  await pool.query("INSERT INTO accounts (id, name, balance) VALUES (1, 'cash', 0), (2, 'bank', 0)");
  await pool.query("SELECT setval('seq_accounts', 2)");
  await pool.query("INSERT INTO _delta_held (doc_name, holder) VALUES ('chart:', 1), ('account:2', 1)");   // open
});

const write = async (doc: string, ops: unknown[]) => (await pool.query("SELECT delta_apply($1, $2::jsonb) AS r", [doc, JSON.stringify(ops)])).rows[0].r;
const told = async (doc: string) => (await pool.query("SELECT ops FROM _delta_ops_log WHERE doc_name = $1 ORDER BY id", [doc])).rows.map((r) => r.ops);

test("a line written through the journal: the open chart is told the account's new balance", async () => {
  await write("journal:", [{ op: "add", path: "/lines/-", value: { account_id: 1, amount: 10 } }]);
  expect(await told("chart:")).toEqual([[{ op: "replace", path: "/accounts/1/balance", value: 10 }]]);
  expect(await told("account:2")).toEqual([]);   // holds no row the write changed
  // and the writer is told its line, as ever
  expect((await told("journal:"))[0]).toEqual([{ op: "add", path: "/lines/1", value: { id: 1, account_id: 1, amount: 10 } }]);
});

test("two lines to one account and one to another, in one write: each account told once, as the write left it", async () => {
  await write("journal:", [
    { op: "add", path: "/lines/-", value: { account_id: 1, amount: 10 } },
    { op: "add", path: "/lines/-", value: { account_id: 2, amount: 5 } },
    { op: "add", path: "/lines/-", value: { account_id: 1, amount: 7 } },
  ]);
  expect(await told("chart:")).toEqual([[
    { op: "replace", path: "/accounts/1/balance", value: 17 },
    { op: "replace", path: "/accounts/2/balance", value: 5 },
  ]]);
  expect(await told("account:2")).toEqual([[{ op: "replace", path: "/accounts/balance", value: 5 }]]);
});

test("called after the row changed: every field is told, the values right", async () => {
  await pool.query(`CREATE OR REPLACE FUNCTION lines_post() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      UPDATE accounts SET balance = balance + NEW.amount WHERE id = NEW.account_id;
      PERFORM delta_touch('accounts', NEW.account_id);   -- after: what it was is gone
      RETURN NEW;
    END $$`);
  try {
    await write("journal:", [{ op: "add", path: "/lines/-", value: { account_id: 1, amount: 3 } }]);
    expect(await told("chart:")).toEqual([[
      { op: "replace", path: "/accounts/1/balance", value: 3 },
      { op: "replace", path: "/accounts/1/name", value: "cash" },
    ]]);
  } finally {
    await pool.query(`CREATE OR REPLACE FUNCTION lines_post() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        PERFORM delta_touch('accounts', NEW.account_id);
        UPDATE accounts SET balance = balance + NEW.amount WHERE id = NEW.account_id;
        RETURN NEW;
      END $$`);
  }
});

test("outside a write it does nothing: a line put in by hand is told to no one", async () => {
  await pool.query("INSERT INTO lines (account_id, amount) VALUES (1, 4)");
  expect(Number((await pool.query("SELECT balance FROM accounts WHERE id = 1")).rows[0].balance)).toBe(4);
  expect(await told("chart:")).toEqual([]);
  // and the next write tells only its own
  await write("journal:", [{ op: "add", path: "/lines/-", value: { account_id: 2, amount: 1 } }]);
  expect(await told("chart:")).toEqual([[{ op: "replace", path: "/accounts/2/balance", value: 1 }]]);
});

test("a collection there is not is refused, and the write with it", async () => {
  const err = await pool.query("SELECT delta_touch('no_such', 1)").catch((e) => e);
  expect(err).toBeInstanceOf(Error);   // outside a write, refused all the same
  expect(err.message).toContain("Unknown collection: no_such");
});
