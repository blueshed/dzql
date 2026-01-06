/**
 * Tests for DzqlNamespace - invoket integration
 *
 * These tests verify the namespace works correctly with the manifest
 * and can execute CRUD operations against a real database.
 */

import { describe, test, expect, beforeAll, afterAll, beforeEach, spyOn } from "bun:test";
import { V2TestDatabase } from "./integration/setup.js";
import { generateCoreSQL, generateAuthSQL, generateEntitySQL, generateSchemaSQL } from "../src/cli/codegen/sql.js";
import { generateManifest } from "../src/cli/codegen/manifest.js";
import { generateIR } from "../src/cli/compiler/ir.js";
import { entities } from "../examples/blog.js";
import { writeFileSync, mkdirSync, rmSync } from "fs";
import { join } from "path";
import type { Context } from "../src/runtime/namespace.js";

const blogDomain = { entities, subscribables: {} };

// Mock Context for testing
const mockContext: Context = {
  cwd: process.cwd(),
  run: async () => ({ stdout: "", stderr: "", code: 0, ok: true, failed: false })
};

describe("DzqlNamespace", () => {
  let db: V2TestDatabase;
  let sql: any;
  let testManifestPath: string;
  let originalEnv: string | undefined;
  let consoleOutput: string[] = [];
  let consoleErrorOutput: string[] = [];

  beforeAll(async () => {
    // Setup test database
    db = new V2TestDatabase();
    sql = await db.setup();

    // Generate and apply SQL
    const ir = generateIR(blogDomain);
    const coreSQL = generateCoreSQL();
    const usersSchema = generateSchemaSQL("users", ir.entities.users);
    const postsSchema = generateSchemaSQL("posts", ir.entities.posts);
    const commentsSchema = generateSchemaSQL("comments", ir.entities.comments);
    const usersSQL = generateEntitySQL("users", ir.entities.users);
    const postsSQL = generateEntitySQL("posts", ir.entities.posts);
    const commentsSQL = generateEntitySQL("comments", ir.entities.comments);

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

    // Create a test user for FK relationships using register_user
    await sql`SELECT dzql_v2.register_user('test@example.com', 'password123', ${sql.json({ name: 'Test Author' })})`;

    // Generate manifest and write to temp location
    const manifest = generateManifest(ir);
    testManifestPath = join(process.cwd(), "dist/runtime");
    mkdirSync(testManifestPath, { recursive: true });
    writeFileSync(
      join(testManifestPath, "manifest.json"),
      JSON.stringify(manifest, null, 2)
    );

    // Set DATABASE_URL to test database
    originalEnv = process.env.DATABASE_URL;
    const testDbUrl = db.baseUrl.replace(/\/[^/]*$/, `/${db.dbName}`);
    process.env.DATABASE_URL = testDbUrl;
  });

  afterAll(async () => {
    // Restore environment
    if (originalEnv !== undefined) {
      process.env.DATABASE_URL = originalEnv;
    } else {
      delete process.env.DATABASE_URL;
    }

    // Cleanup manifest
    try {
      rmSync(join(testManifestPath, "manifest.json"));
    } catch {}

    await db.teardown();
  });

  beforeEach(() => {
    consoleOutput = [];
    consoleErrorOutput = [];
  });

  // Helper to capture console output and prevent process.exit
  function setupMocks() {
    const logSpy = spyOn(console, "log").mockImplementation((...args) => {
      consoleOutput.push(args.map(String).join(" "));
    });

    const errorSpy = spyOn(console, "error").mockImplementation((...args) => {
      consoleErrorOutput.push(args.map(String).join(" "));
    });

    const exitSpy = spyOn(process, "exit").mockImplementation((() => {
      // Don't actually exit - just throw to stop execution
      throw new Error("EXIT");
    }) as any);

    return () => {
      logSpy.mockRestore();
      errorSpy.mockRestore();
      exitSpy.mockRestore();
    };
  }

  // Helper to parse JSON output - find the first valid JSON object
  function parseOutput(): any {
    for (const line of consoleOutput) {
      try {
        const parsed = JSON.parse(line);
        if (parsed && typeof parsed === 'object' && 'success' in parsed) {
          return parsed;
        }
      } catch {
        continue;
      }
    }
    return null;
  }

  function parseErrorOutput(): any {
    if (consoleErrorOutput.length === 0) return null;
    // Find JSON in error output
    for (const line of consoleErrorOutput) {
      try {
        return JSON.parse(line);
      } catch {
        continue;
      }
    }
    return null;
  }

  test("entities() lists available entities", async () => {
    const { DzqlNamespace } = await import("../src/runtime/namespace.js");
    const ns = new DzqlNamespace();

    const restore = setupMocks();

    try {
      await ns.entities(mockContext);
    } catch (e: any) {
      if (e.message !== "EXIT") throw e;
    } finally {
      restore();
    }

    const result = parseOutput();
    expect(result).not.toBeNull();
    expect(result.success).toBe(true);
    expect(result.entities).toBeDefined();
    expect(result.entities.posts).toBeDefined();
    expect(result.entities.comments).toBeDefined();
  });

  test("functions() lists available functions", async () => {
    const { DzqlNamespace } = await import("../src/runtime/namespace.js");
    const ns = new DzqlNamespace();

    const restore = setupMocks();

    try {
      await ns.functions(mockContext);
    } catch (e: any) {
      if (e.message !== "EXIT") throw e;
    } finally {
      restore();
    }

    const result = parseOutput();
    expect(result).not.toBeNull();
    expect(result.success).toBe(true);
    expect(result.functions).toBeDefined();
    expect(result.functions.save_posts).toBeDefined();
    expect(result.functions.get_posts).toBeDefined();
    expect(result.functions.search_posts).toBeDefined();
    expect(result.functions.delete_posts).toBeDefined();
    expect(result.functions.login_user).toBeDefined();
    expect(result.functions.register_user).toBeDefined();
  });

  test("save() creates a new entity", async () => {
    const { DzqlNamespace } = await import("../src/runtime/namespace.js");
    const ns = new DzqlNamespace(1); // userId = 1

    const restore = setupMocks();

    try {
      await ns.save(mockContext, "posts", { title: "Test Post", content: "Hello", author_id: 1 });
    } catch (e: any) {
      if (e.message !== "EXIT") throw e;
    } finally {
      restore();
    }

    const result = parseOutput();
    expect(result).not.toBeNull();
    expect(result.success).toBe(true);
    expect(result.result).toBeDefined();
    expect(result.result.id).toBeDefined();
    expect(result.result.title).toBe("Test Post");
  });

  test("get() retrieves an entity by ID", async () => {
    // First create a post directly in DB
    const created = await sql`
      INSERT INTO posts (title, content, author_id)
      VALUES ('Get Test', 'Content', 1)
      RETURNING id
    `;
    const postId = created[0].id;

    const { DzqlNamespace } = await import("../src/runtime/namespace.js");
    const ns = new DzqlNamespace(1);

    const restore = setupMocks();

    try {
      await ns.get(mockContext, "posts", { id: postId });
    } catch (e: any) {
      if (e.message !== "EXIT") throw e;
    } finally {
      restore();
    }

    const result = parseOutput();
    expect(result).not.toBeNull();
    expect(result.success).toBe(true);
    expect(result.result).toBeDefined();
    expect(result.result.id).toBe(postId);
    expect(result.result.title).toBe("Get Test");
  });

  test("search() finds entities", async () => {
    // Create some posts
    await sql`
      INSERT INTO posts (title, content, author_id)
      VALUES ('Search Post 1', 'Content', 1), ('Search Post 2', 'More', 1)
    `;

    const { DzqlNamespace } = await import("../src/runtime/namespace.js");
    const ns = new DzqlNamespace(1);

    const restore = setupMocks();

    try {
      await ns.search(mockContext, "posts", { limit: 10 });
    } catch (e: any) {
      if (e.message !== "EXIT") throw e;
    } finally {
      restore();
    }

    const result = parseOutput();
    expect(result).not.toBeNull();
    expect(result.success).toBe(true);
    expect(result.result).toBeArray();
    expect(result.result.length).toBeGreaterThan(0);
  });

  test("delete() removes an entity", async () => {
    // Create a post to delete - author_id must match userId for permission
    const created = await sql`
      INSERT INTO posts (title, content, author_id)
      VALUES ('To Delete', 'Content', 1)
      RETURNING id
    `;
    const postId = created[0].id;

    const { DzqlNamespace } = await import("../src/runtime/namespace.js");
    const ns = new DzqlNamespace(1); // userId must match author_id

    const restore = setupMocks();

    try {
      await ns.delete(mockContext, "posts", { id: postId });
    } catch (e: any) {
      if (e.message !== "EXIT") throw e;
    } finally {
      restore();
    }

    const result = parseOutput();
    const errorResult = parseErrorOutput();

    if (!result && errorResult) {
      console.log("Delete failed with:", errorResult);
    }

    expect(result).not.toBeNull();
    expect(result.success).toBe(true);

    // Verify it's gone
    const check = await sql`SELECT * FROM posts WHERE id = ${postId}`;
    expect(check.length).toBe(0);
  });

  test("call() executes arbitrary manifest function", async () => {
    const { DzqlNamespace } = await import("../src/runtime/namespace.js");
    const ns = new DzqlNamespace(1);

    const restore = setupMocks();

    try {
      await ns.call(mockContext, "save_posts", { title: "Call Test", content: "Via call()", author_id: 1 });
    } catch (e: any) {
      if (e.message !== "EXIT") throw e;
    } finally {
      restore();
    }

    const result = parseOutput();
    const errorResult = parseErrorOutput();

    if (!result && errorResult) {
      console.log("Call failed with:", errorResult);
    }

    expect(result).not.toBeNull();
    expect(result.success).toBe(true);
    expect(result.result.title).toBe("Call Test");
  });

  test("call() with unknown function returns error", async () => {
    const { DzqlNamespace } = await import("../src/runtime/namespace.js");
    const ns = new DzqlNamespace(1);

    const restore = setupMocks();

    try {
      await ns.call(mockContext, "nonexistent_function", {});
    } catch (e: any) {
      if (e.message !== "EXIT") {
        throw e;
      }
    } finally {
      restore();
    }

    const errorResult = parseErrorOutput();
    expect(errorResult).not.toBeNull();
    expect(errorResult.success).toBe(false);
    expect(errorResult.error).toContain("not found in manifest");
  });
});
