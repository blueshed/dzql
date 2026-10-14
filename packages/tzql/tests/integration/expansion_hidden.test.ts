import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { V2TestDatabase } from "./setup.js";
import { generateIR } from "../../src/cli/compiler/ir.js";
import { generateEntitySQL } from "../../src/cli/codegen/sql.js";

// posts.author -> users (hidden: password_hash). Expanding the FK must not
// leak the target's hidden column.
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
      hidden: ["password_hash"],
      permissions: { view: [], create: [], update: ["@id"], delete: ["@id"] },
    },
    posts: {
      schema: {
        id: "serial PRIMARY KEY",
        title: "text NOT NULL",
        author_id: "int NOT NULL REFERENCES users(id)",
      },
      label: "title",
      includes: { author: "users" },
      permissions: { view: [], create: [], update: ["@author_id == @user_id"], delete: ["@author_id == @user_id"] },
    },
  },
  subscribables: {},
};

describe("FK/M2M expansion does not leak the target's hidden columns", () => {
  let db: V2TestDatabase;
  let sql: any;

  beforeAll(async () => {
    db = new V2TestDatabase();
    sql = await db.setup();
    await sql`CREATE SCHEMA IF NOT EXISTS dzql_v2`;
    await sql`CREATE SEQUENCE IF NOT EXISTS dzql_v2.commit_seq`;
    await sql`
      CREATE TABLE IF NOT EXISTS dzql_v2.events (
        id bigserial PRIMARY KEY, commit_id bigint, table_name text, op text,
        pk jsonb, data jsonb, old_data jsonb, user_id int,
        affected_keys text[] DEFAULT ARRAY[]::text[], notify_users int[] DEFAULT ARRAY[]::int[],
        created_at timestamptz DEFAULT now()
      )`;
    await sql`
      CREATE OR REPLACE FUNCTION dzql_v2.compute_affected_keys(p_table text, p_op text, p_data jsonb)
      RETURNS text[] LANGUAGE sql IMMUTABLE AS $$ SELECT ARRAY[]::text[] $$`;
    // Shared per-process DB: drop first (posts before users for the FK).
    await sql`DROP TABLE IF EXISTS posts CASCADE`;
    await sql`DROP TABLE IF EXISTS users CASCADE`;
    await sql`CREATE TABLE users (id serial PRIMARY KEY, name text NOT NULL, email text UNIQUE NOT NULL, password_hash text NOT NULL)`;
    await sql`CREATE TABLE posts (id serial PRIMARY KEY, title text NOT NULL, author_id int NOT NULL REFERENCES users(id))`;
    await sql`INSERT INTO users (id, name, email, password_hash) VALUES (1, 'alice', 'a@x', 'secret-hash')`;
    await sql`INSERT INTO posts (id, title, author_id) VALUES (1, 'hello', 1)`;

    const ir = generateIR(domain);
    await sql.unsafe(generateEntitySQL("users", ir.entities.users, ir.entities));
    await sql.unsafe(generateEntitySQL("posts", ir.entities.posts, ir.entities));
  });

  afterAll(async () => {
    await db.teardown();
  });

  test("get_posts expands author WITHOUT password_hash", async () => {
    const [{ r }] = await sql`SELECT dzql_v2.get_posts(1, '{"id": 1}'::jsonb) AS r`;
    expect(r.author).toBeDefined();
    expect(r.author.name).toBe("alice");
    expect(r.author).not.toHaveProperty("password_hash");
  });

  test("search_posts (no M2M here) still returns posts and never a hidden col", async () => {
    const rows = await sql`SELECT dzql_v2.search_posts(1, '{"limit": 10}'::jsonb) AS r`;
    expect(rows.length).toBe(1);
    expect(rows[0].r).not.toHaveProperty("password_hash");
  });
});
