import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { V2TestDatabase } from "./setup.js";
import { generateIR } from "../../src/cli/compiler/ir.js";
import { generateEntitySQL } from "../../src/cli/codegen/sql.js";

// posts owned by author_id; update/delete permitted only to the owner.
const domain = {
  entities: {
    posts: {
      schema: {
        id: "serial PRIMARY KEY",
        title: "text NOT NULL",
        author_id: "int NOT NULL",
      },
      label: "title",
      searchable: ["title"],
      permissions: {
        view: [],
        create: [],
        update: ["@author_id == @user_id"],
        delete: ["@author_id == @user_id"],
      },
    },
  },
  subscribables: {},
};

describe("save: update permission is evaluated against the stored row", () => {
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
    await sql`CREATE SCHEMA IF NOT EXISTS dzql_v2`;
    await sql`CREATE SEQUENCE IF NOT EXISTS dzql_v2.commit_seq`;
    await sql`
      CREATE TABLE IF NOT EXISTS dzql_v2.events (
        id bigserial PRIMARY KEY,
        commit_id bigint,
        table_name text,
        op text,
        pk jsonb,
        data jsonb,
        old_data jsonb,
        user_id int,
        affected_keys text[] DEFAULT ARRAY[]::text[],
        notify_users int[] DEFAULT ARRAY[]::int[],
        created_at timestamptz DEFAULT now()
      )
    `;
    await sql`
      CREATE OR REPLACE FUNCTION dzql_v2.compute_affected_keys(p_table text, p_op text, p_data jsonb)
      RETURNS text[] LANGUAGE sql IMMUTABLE AS $$ SELECT ARRAY[]::text[] $$
    `;
    await sql`
      CREATE TABLE posts (
        id serial PRIMARY KEY,
        title text NOT NULL,
        author_id int NOT NULL
      )
    `;
    // Row owned by user 1.
    await sql`INSERT INTO posts (id, title, author_id) VALUES (1, 'victim-post', 1)`;
    await sql`SELECT setval('posts_id_seq', 1)`;

    const ir = generateIR(domain);
    await sql.unsafe(generateEntitySQL("posts", ir.entities.posts));
  });

  afterAll(async () => {
    await db.teardown();
  });

  test("owner can update their own row", async () => {
    await sql`SELECT dzql_v2.save_posts(1, '{"id": 1, "title": "edited by owner", "author_id": 1}'::jsonb)`;
    const [row] = await sql`SELECT title, author_id FROM posts WHERE id = 1`;
    expect(row.title).toBe("edited by owner");
    expect(row.author_id).toBe(1);
  });

  test("a non-owner cannot hijack a row by putting their own id in the body", async () => {
    // Before the fix, user 2 could overwrite user 1's row by supplying
    // author_id: 2, because the predicate read the request body, not the row.
    await expectReject(
      () => sql`SELECT dzql_v2.save_posts(2, '{"id": 1, "title": "PWNED", "author_id": 2}'::jsonb)`,
      /permission_denied/,
    );
    const [row] = await sql`SELECT title, author_id FROM posts WHERE id = 1`;
    expect(row.title).toBe("edited by owner"); // unchanged from the owner's edit
    expect(row.author_id).toBe(1);
  });

  test("a non-owner is still denied when sending the true owner id", async () => {
    await expectReject(
      () => sql`SELECT dzql_v2.save_posts(2, '{"id": 1, "title": "nope", "author_id": 1}'::jsonb)`,
      /permission_denied/,
    );
  });
});
