import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { V2TestDatabase } from "./setup.js";
import { generateCoreSQL, generateAuthSQL } from "../../src/cli/codegen/sql.js";

describe("register_user: only allow-listed columns may be set at sign-up", () => {
  let db: V2TestDatabase;
  let sql: any;

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
    await sql.unsafe(generateCoreSQL());
    // Tests share one per-process DB; drop first so table shape is deterministic
    // regardless of which other test file ran before this one.
    await sql`DROP TABLE IF EXISTS users CASCADE`;
    // users table carries a privileged column that must NOT be client-settable.
    await sql`
      CREATE TABLE users (
        id serial PRIMARY KEY,
        email text UNIQUE NOT NULL,
        name text,
        is_admin boolean NOT NULL DEFAULT false,
        password_hash text NOT NULL
      )
    `;
    // Only 'name' is registerable.
    await sql.unsafe(generateAuthSQL(["name"]));
  });

  afterAll(async () => {
    await db.teardown();
  });

  test("registering with an allow-listed field works", async () => {
    const [{ data }] = await sql`
      SELECT dzql_v2.register_user('a@x', 'pw', ${sql.json({ name: "Alice" })}) AS data`;
    expect(data.name).toBe("Alice");
    const [row] = await sql`SELECT is_admin FROM users WHERE email = 'a@x'`;
    expect(row.is_admin).toBe(false);
  });

  test("registering with no options works", async () => {
    const [{ data }] = await sql`
      SELECT dzql_v2.register_user('b@x', 'pw') AS data`;
    expect(data.user_id).toBeGreaterThan(0);
  });

  test("self-provisioning a privileged column is rejected", async () => {
    // Before the fix, options were merged after stripping only 4 keys, so
    // is_admin:true would be written straight through.
    await expectReject(
      () => sql`SELECT dzql_v2.register_user('c@x', 'pw', ${sql.json({ name: "C", is_admin: true })})`,
      /not allowed at registration/,
    );
    const rows = await sql`SELECT 1 FROM users WHERE email = 'c@x'`;
    expect(rows.length).toBe(0); // nothing created
  });
});
