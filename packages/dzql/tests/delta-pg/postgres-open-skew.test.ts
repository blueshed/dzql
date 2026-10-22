/**
 * Servers of one app starting beside running ones, on the suite's Postgres server (todo #86, #87):
 * a second open of an unchanged app changes nothing the first uses, so every write made while it
 * opens goes through; an older server restarting mid-deploy (v1 beside v2) leaves v2's compiled
 * documents as they are and runs on them; and the DDL as it opens gives way to a transaction that
 * holds what it would lock, rather than queue every read behind it. Each in a schema of its own.
 * On PGlite: app-store-compiled-pglite.test.ts.
 */
import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { Pool } from "pg";
import { setLogLevel } from "@blueshed/delta/logger";
import { createTable } from "@blueshed/delta/migrations";
import { defineDoc, defineSchema, openStore } from "../../src/postgres";
import { PG_URL } from "./setup";

setLogLevel("silent");

let admin: Pool;
const schemas = ["open_skew_writes", "open_skew_versions", "open_skew_locks", "open_skew_migrate"];
beforeAll(async () => {
  admin = new Pool({ connectionString: PG_URL, max: 4 });
  for (const ns of schemas) await admin.query(`DROP SCHEMA IF EXISTS ${ns} CASCADE`);
});
afterAll(async () => {
  for (const ns of schemas) await admin.query(`DROP SCHEMA IF EXISTS ${ns} CASCADE`);
  await admin.end();
});

const boards = defineSchema({ skew_boards: { columns: { title: "text" }, temporal: false } });
const boardsHistory = [{ id: "001-boards", changes: [createTable("skew_boards", { columns: { title: { type: "text" } }, temporal: false })] }];
const boardsDoc = defineDoc("boards:", { root: "skew_boards", include: [] });

describe("a second server opening beside a running one", () => {
  test("every write made through the first while the second opens goes through", async () => {
    const namespace = schemas[0]!;
    const server = () => {
      const store = openStore({ schema: boards, database: PG_URL, namespace, migrations: { app: "boards", list: boardsHistory, schema: boards } });
      store.register([boardsDoc]);
      return store;
    };
    const first = server();
    await first.open();
    const second = server();
    try {
      const write = (i: number) => first.owner.call("delta", { doc: "boards:", ops: [{ op: "add", path: "/skew_boards/-", value: { title: `board ${i}` } }] });
      // writes in flight the whole time the second opens, and after
      let opened = false;
      const writes: Promise<any>[] = [];
      const writing = (async () => {
        for (let i = 0; !opened || i < 40; i++) {
          writes.push(write(i));
          if (writes.length % 8 === 0) await Promise.all(writes.slice(-8));
        }
      })();
      await second.open();
      opened = true;
      await writing;
      const answers = await Promise.all(writes);
      expect(answers.filter((a) => a.error).map((a) => a.error)).toEqual([]);
      expect(Number((await admin.query(`SELECT count(*) FROM ${namespace}.skew_boards`)).rows[0].count)).toBe(answers.length);
    } finally {
      await second.close();
      await first.close();
    }
  }, 120_000);
});

describe("an older server restarting beside a newer one (a deploy rolling)", () => {
  test("v2 opens, v1 restarts: v2's documents still work, and v1 says it runs on the newer set", async () => {
    const namespace = schemas[1]!;
    const cards = defineSchema({ ...boards.tables, skew_cards: { columns: { text: "text" }, temporal: false } } as any);
    const v2History = [...boardsHistory, { id: "002-cards", changes: [createTable("skew_cards", { columns: { text: { type: "text" } }, temporal: false })] }];
    const v1 = () => {
      const store = openStore({ schema: boards, database: PG_URL, namespace, migrations: { app: "boards", list: boardsHistory, schema: boards } });
      store.register([boardsDoc]);
      return store;
    };
    const v2 = openStore({ schema: cards, database: PG_URL, namespace, migrations: { app: "boards", list: v2History, schema: cards } });
    v2.register([boardsDoc, defineDoc("cards:", { root: "skew_cards", include: [] })]);

    const before = v1();
    await before.open();
    await before.close();
    await v2.open();
    const restarted = v1();
    setLogLevel("warn");
    const warned = spyOn(console, "warn").mockImplementation(() => {});
    try {
      await restarted.open();
      expect(warned.mock.calls.map((c) => String(c[0])).join("\n")).toContain("compiled by a newer server (generation 2");
      const wrote = await v2.owner.call("delta", { doc: "cards:", ops: [{ op: "add", path: "/skew_cards/-", value: { text: "still here" } }] });
      expect(wrote.error).toBeUndefined();
      expect((await restarted.owner.call("open", { doc: "boards:" })).error).toBeUndefined(); // v1's own documents, on v2's set
      expect((await admin.query(`SELECT generation::int, doc_types FROM ${namespace}._delta_compiled ORDER BY generation`)).rows)
        .toEqual([{ generation: 1, doc_types: ["boards:"] }, { generation: 2, doc_types: ["boards:", "cards:"] }]);
    } finally {
      warned.mockRestore();
      setLogLevel("silent");
      await restarted.close();
      await v2.close();
    }
    // a rollback says so, and puts v1's set back as the newest
    const rolledBack = openStore({ schema: boards, database: PG_URL, namespace, rollback: true, migrations: { app: "boards", list: boardsHistory, schema: boards } });
    rolledBack.register([boardsDoc]);
    await rolledBack.open();
    try {
      expect((await admin.query(`SELECT generation::int FROM ${namespace}._delta_compiled ORDER BY generation DESC LIMIT 1`)).rows[0].generation).toBe(3);
    } finally {
      await rolledBack.close();
    }
  }, 120_000);
});

describe("the DDL as it opens gives way", () => {
  test("held up by a long transaction, a new set waits lockTimeout for each lock, tries again, then says why, having changed nothing", async () => {
    const namespace = schemas[2]!;
    const first = openStore({ schema: boards, database: PG_URL, namespace });
    first.register([boardsDoc]);
    await first.open();
    await first.close();
    // a long transaction holds the table the next set puts its policy on (an exclusive lock waits for it)
    const blocker = await admin.connect();
    await blocker.query("BEGIN");
    await blocker.query(`LOCK TABLE ${namespace}.skew_boards IN ACCESS SHARE MODE`);
    const owned = defineDoc("boards:", { root: "skew_boards", include: [], owns: "@id" });
    const next = openStore({ schema: boards, database: PG_URL, namespace, lockTimeout: 200, auth: { gate: () => 1 } as any });
    next.register([owned]);
    try {
      const started = Date.now();
      await expect(next.open()).rejects.toThrow("could not take its locks within 200 ms, 3 times");
      expect(Date.now() - started).toBeLessThan(10_000);
    } finally {
      await blocker.query("ROLLBACK");
      blocker.release();
    }
    expect((await admin.query(`SELECT count(*)::int AS n FROM ${namespace}._delta_compiled`)).rows[0].n).toBe(1); // nothing changed
  }, 60_000);

  test("a migration held up by a long transaction gives way too, then says why, recording nothing; once it ends, the migration runs and fences the ledger", async () => {
    const namespace = schemas[3]!;
    const server = (list: unknown[]) => {
      const store = openStore({ schema: boards, database: PG_URL, namespace, lockTimeout: 200, migrations: { app: "boards", list: list as any, schema: boards } });
      store.register([boardsDoc]);
      return store;
    };
    const first = server(boardsHistory);
    await first.open();
    for (const title of ["one", "two"]) {
      expect((await first.owner.call("delta", { doc: "boards:", cursor: "ada", ops: [{ op: "add", path: "/skew_boards/-", value: { title } }] })).error).toBeUndefined();
    }
    await first.close();
    const next = [...boardsHistory, { id: "002-colour", up: async (tx: any) => void (await tx.query("ALTER TABLE skew_boards ADD COLUMN colour TEXT")) }];
    const blocker = await admin.connect();
    try {
      await blocker.query("BEGIN");
      await blocker.query(`LOCK TABLE ${namespace}.skew_boards IN ACCESS SHARE MODE`); // a long read of the table it alters
      await expect(server(next).open()).rejects.toThrow("could not take its locks within 200 ms, 3 times");
      expect((await admin.query(`SELECT id FROM ${namespace}.delta_migrations ORDER BY id`)).rows.map((r) => r.id)).toEqual(["001-boards"]);
      await blocker.query("ROLLBACK");
      // a write in flight on the ledger: the fence ahead cannot hold it still, so the migration fences it all itself
      await blocker.query("BEGIN");
      await blocker.query(`LOCK TABLE ${namespace}._delta_ledger IN ROW EXCLUSIVE MODE`);
      const again = server(next);
      const opened = again.open();
      // the write ends once the migration is in (the compiled SQL after it waits for the ledger too, and tries again)
      for (let ran = false; !ran; await Bun.sleep(20)) {
        ran = (await admin.query(`SELECT 1 FROM ${namespace}.delta_migrations WHERE id = '002-colour'`)).rowCount === 1;
      }
      await blocker.query("ROLLBACK");
      await opened;
      try {
        expect((await admin.query(`SELECT id FROM ${namespace}.delta_migrations ORDER BY id`)).rows.map((r) => r.id)).toEqual(["001-boards", "002-colour"]);
        expect((await admin.query(`SELECT count(*)::int AS n FROM ${namespace}._delta_ledger WHERE undoable`)).rows[0].n).toBe(0);
      } finally {
        await again.close();
      }
    } finally {
      await blocker.query("ROLLBACK").catch(() => {});
      blocker.release();
    }
  }, 60_000);
});
