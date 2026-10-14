import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { V2TestDatabase } from "./setup.js";
import { generateIR } from "../../src/cli/compiler/ir.js";
import { generateSearchFunction } from "../../src/cli/codegen/sql.js";

// Minimal domain: users with a hidden secret column and a public view permission.
const domain = {
  entities: {
    users: {
      schema: {
        id: "serial PRIMARY KEY",
        name: "text NOT NULL",
        email: "text UNIQUE NOT NULL",
        password_hash: "text NOT NULL",
      },
      label: "name",
      searchable: ["name", "email"],
      hidden: ["password_hash"],
      permissions: { view: ['TRUE'], create: ['AUTHENTICATED'], update: ["@id"], delete: ["@id"] },
    },
  },
  subscribables: {},
};

describe("search: untrusted filter/sort inputs", () => {
  let db: V2TestDatabase;
  let sql: any;

  // Await the query to completion inside a try/catch so the connection is fully
  // drained before assertions (postgres' tagged-template queries are lazy).
  async function expectReject(run: () => Promise<unknown>, re: RegExp) {
    let err: any;
    try {
      await run();
    } catch (e) {
      err = e;
    }
    expect(err, "expected the query to be rejected").toBeDefined();
    expect(String(err.message)).toMatch(re);
  }

  beforeAll(async () => {
    db = new V2TestDatabase();
    sql = await db.setup();
    await sql`CREATE SCHEMA IF NOT EXISTS dzql_v2`;
    // Shared per-process DB: drop first so this file is order-independent.
    await sql`DROP TABLE IF EXISTS users CASCADE`;
    await sql`
      CREATE TABLE users (
        id serial PRIMARY KEY,
        name text NOT NULL,
        email text UNIQUE NOT NULL,
        password_hash text NOT NULL
      )
    `;
    await sql`
      INSERT INTO users (name, email, password_hash) VALUES
        ('alice', 'a@x', 'secret-hash-abc'),
        ('bob', 'b@x', 'zzz')
    `;
    const ir = generateIR(domain);
    await sql.unsafe(generateSearchFunction("users", ir.entities.users));
  });

  afterAll(async () => {
    await db.teardown();
  });

  test("normal search hides the password_hash column", async () => {
    const rows = await sql`SELECT dzql_v2.search_users(2, '{"limit": 5}'::jsonb) AS r`;
    expect(rows.length).toBe(2);
    for (const { r } of rows) {
      expect(r).not.toHaveProperty("password_hash");
    }
  });

  test("a valid sort still works (sanity)", async () => {
    const rows = await sql`SELECT dzql_v2.search_users(2, '{"sort_field": "name", "sort_order": "desc"}'::jsonb) AS r`;
    expect(rows.map((x: any) => x.r.name)).toEqual(["bob", "alice"]);
  });

  test("filtering on a hidden column is rejected (no oracle)", async () => {
    // Before the fix this returned 1 row for a matching prefix and 0 otherwise,
    // leaking password_hash one predicate at a time.
    await expectReject(
      () => sql`SELECT dzql_v2.search_users(2, '{"filters": {"password_hash": {"like": "secret%"}}}'::jsonb)`,
      /invalid filter field/,
    );
  });

  test("filtering on an unknown column is rejected", async () => {
    await expectReject(
      () => sql`SELECT dzql_v2.search_users(2, '{"filters": {"nope": {"eq": "x"}}}'::jsonb)`,
      /invalid filter field/,
    );
  });

  test("a crafted sort_order cannot inject SQL into ORDER BY", async () => {
    // Before the fix, sort_order was spliced via %s; this payload ran a
    // correlated subquery over password_hash (division-by-zero as the signal).
    const payload = {
      sort_order:
        "asc, (select case when substr(password_hash,1,1)='s' then 1 else 1/0 end from users where id=1)",
    };
    await expectReject(
      () => sql`SELECT dzql_v2.search_users(2, ${sql.json(payload)}::jsonb)`,
      /invalid sort_order/,
    );
  });

  test("a crafted sort_field is rejected", async () => {
    await expectReject(
      () => sql`SELECT dzql_v2.search_users(2, '{"sort_field": "password_hash"}'::jsonb)`,
      /invalid sort_field/,
    );
  });
});
