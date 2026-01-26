import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { V2TestDatabase } from "./setup.js";
import { generateCoreSQL, generateAuthSQL, generateEntitySQL, generateSchemaSQL } from "../../src/cli/codegen/sql.js";
import { generateIR } from "../../src/cli/compiler/ir.js";
import { entities } from "../../examples/blog.js";

const blogDomain = { entities, subscribables: {} };

describe("V2 Database Integration (Real Postgres)", () => {
  let db: V2TestDatabase;
  let sql: any;

  beforeAll(async () => {
    db = new V2TestDatabase();
    // This connects to localhost:5433 by default (from setup.ts)
    sql = await db.setup();

    try {
      // 1. Generate SQL
      const ir = generateIR(blogDomain);
      const coreSQL = generateCoreSQL();
      const usersSchema = generateSchemaSQL("users", ir.entities.users);
      const postsSchema = generateSchemaSQL("posts", ir.entities.posts);
      const commentsSchema = generateSchemaSQL("comments", ir.entities.comments);
      const usersSQL = generateEntitySQL("users", ir.entities.users);
      const postsSQL = generateEntitySQL("posts", ir.entities.posts);
      const commentsSQL = generateEntitySQL("comments", ir.entities.comments);

      // 2. Apply SQL to the real DB
      await db.applySQL(coreSQL);
      await db.applySQL(usersSchema);
      await db.applySQL(postsSchema);
      await db.applySQL(commentsSchema);
      // Auth functions must come after users table is created
      const authSQL = generateAuthSQL();
      await db.applySQL(authSQL);
      await db.applySQL(usersSQL);
      await db.applySQL(postsSQL);
      await db.applySQL(commentsSQL);

      // 3. Create a test user for FK relationships using register_user
      const userResult = await sql`SELECT dzql_v2.register_user('test@example.com', 'password123', ${sql.json({ name: 'Test Author' })}) as data`;
      // Update userId reference - register_user returns the new user_id
      const testUserId = userResult[0].data.user_id;
    } catch (e) {
      console.error("Setup failed:", e);
      throw e;
    }
  });

  afterAll(async () => {
    await db.teardown();
  });

  test("should save a post via compiled function (Atomic Upsert)", async () => {
    const userId = 1;
    const postData = { id: 1, title: "Real DB Test", content: "It works!", author_id: 1 };

    // Call the compiled PL/pgSQL function
    const result = await sql`
      SELECT dzql_v2.save_posts(${userId}, ${sql.json(postData)}) as data
    `;

    const saved = result[0].data;
    expect(saved.id).toBe(1);
    expect(saved.title).toBe("Real DB Test");

    // Verify persistence
    const rows = await sql`SELECT * FROM posts WHERE id = 1`;
    expect(rows.length).toBe(1);
    expect(rows[0].title).toBe("Real DB Test");
  });

  test("should enforce permissions (Inlined SQL)", async () => {
    const hackerId = 2;
    const postData = { id: 2, title: "Hacked", content: "Bad", author_id: 1 };

    // Should fail because @author_id (1) != @user_id (2)
    try {
      await sql`
        SELECT dzql_v2.save_posts(${hackerId}, ${sql.json(postData)})
      `;
      expect(true).toBe(false); // Should not fail
    } catch (e: any) {
      expect(e.message).toContain("permission_denied");
    }
  });

  test("should emit normalized row events (Commit Batching)", async () => {
    // We expect the 'insert' from the first test to be in the events table
    const events = await sql`
      SELECT * FROM dzql_v2.events
      WHERE table_name = 'posts'
      ORDER BY id DESC LIMIT 1
    `;

    expect(events.length).toBe(1);
    expect(events[0].op).toBe("insert");
    expect(events[0].data.title).toBe("Real DB Test");
    expect(events[0].old_data).toBeNull(); // Insert has no old data
    expect(events[0].commit_id).toBeDefined(); // Ensure commit ID was generated
  });

  test("should populate old_data on update", async () => {
    const userId = 1;
    // Update the existing post (id: 1)
    const updateData = { id: 1, title: "Updated Title" };

    await sql`
      SELECT dzql_v2.save_posts(${userId}, ${sql.json(updateData)})
    `;

    const events = await sql`
      SELECT * FROM dzql_v2.events
      WHERE table_name = 'posts' AND op = 'update'
      ORDER BY id DESC LIMIT 1
    `;

    expect(events.length).toBe(1);
    expect(events[0].op).toBe("update");
    expect(events[0].data.title).toBe("Updated Title");
    expect(events[0].old_data).not.toBeNull();
    expect(events[0].old_data.title).toBe("Real DB Test"); // Previous title
  });

  test("should trigger reactors (Graph Rules)", async () => {
    // The blog.ts example has a reactor 'notify_subscribers' on create
    const reactorEvents = await sql`
      SELECT * FROM dzql_v2.events
      WHERE op LIKE 'reactor:%'
      ORDER BY id DESC LIMIT 1
    `;

    expect(reactorEvents.length).toBe(1);
    expect(reactorEvents[0].op).toBe("reactor:notify_subscribers");
    expect(reactorEvents[0].data.post_id).toBe("1");
  });

  test("should delete a post via compiled function (Atomic Delete)", async () => {
    const userId = 1;
    // Call the compiled PL/pgSQL function
    const result = await sql`
      SELECT dzql_v2.delete_posts(${userId}, ${sql.json({ id: 1 })}) as data
    `;

    const deleted = result[0].data;
    expect(deleted.id).toBe(1);

    // Verify gone
    const rows = await sql`SELECT * FROM posts WHERE id = 1`;
    expect(rows.length).toBe(0);

    // Verify Event
    const events = await sql`
      SELECT * FROM dzql_v2.events
      WHERE table_name = 'posts' AND op = 'delete'
      ORDER BY id DESC LIMIT 1
    `;
    expect(events.length).toBe(1);
    expect(events[0].pk.id).toBe(1);
  });

  test("should get a post via compiled function", async () => {
    // Re-create post first
    await sql`INSERT INTO posts (id, title, author_id) VALUES (100, 'Get Test', 1)`;

    const userId = 1;
    const result = await sql`
      SELECT dzql_v2.get_posts(${userId}, ${sql.json({ id: 100 })}) as data
    `;

    expect(result[0].data.title).toBe("Get Test");
  });

  test("should search posts via compiled function", async () => {
    // Search
    const userId = 1;
    const result = await sql`
      SELECT dzql_v2.search_posts(${userId}, ${sql.json({ limit: 5 })})
    `;

    const posts = result.map((r: any) => r.search_posts);

    expect(posts).toBeArray();
    expect(posts.length).toBeGreaterThan(0);
    expect(posts[0].title).toBe("Get Test");
  });

  test("should include FK expansions in save event data", async () => {
    // Create a new post - the event should include the author FK expansion
    const userId = 1;
    const postData = { title: "FK Test Post", content: "Testing FK expansion in events", author_id: 1 };

    await sql`
      SELECT dzql_v2.save_posts(${userId}, ${sql.json(postData)}) as data
    `;

    // Query the event and verify it includes the author object
    const events = await sql`
      SELECT * FROM dzql_v2.events
      WHERE table_name = 'posts' AND op = 'insert'
      ORDER BY id DESC LIMIT 1
    `;

    expect(events.length).toBe(1);
    expect(events[0].data.title).toBe("FK Test Post");
    expect(events[0].data.author_id).toBe(1);

    // This is the key assertion: the event data should include the expanded author object
    expect(events[0].data.author).toBeDefined();
    expect(events[0].data.author.id).toBe(1);
    expect(events[0].data.author.name).toBe("Test Author");
    expect(events[0].data.author.email).toBe("test@example.com");
  });
});
