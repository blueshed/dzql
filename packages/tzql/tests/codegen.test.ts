import { describe, test, expect } from "bun:test";
import { generateCoreSQL, generateEntitySQL } from "../src/cli/codegen/sql.js"; 
import { generateManifest } from "../src/cli/codegen/manifest.js";
import { generateIR } from "../src/cli/compiler/ir.js";

const mockEntityIR = {
  name: "posts",
  table: "posts",
  primaryKey: ["id"],
  columns: [
    { name: "id", type: "serial PRIMARY KEY" },
    { name: "title", type: "text NOT NULL" }
  ],
  permissions: {
    create: [],
    view: []
  },
  graphRules: {
    onCreate: []
  }
};

describe("SQL Code Generation", () => {
  test("generateCoreSQL should produce migration table", () => {
    const sql = generateCoreSQL();
    expect(sql).toContain("CREATE SCHEMA IF NOT EXISTS dzql_v2");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS dzql_v2.migrations");
  });

  test("generateEntitySQL should produce save function", () => {
    const sql = generateEntitySQL("posts", mockEntityIR);
    expect(sql).toContain("CREATE OR REPLACE FUNCTION dzql_v2.save_posts");
    expect(sql).toContain("AND EXISTS(SELECT 1 FROM posts WHERE"); // Check existence check (composite PK support)
    expect(sql).toContain("UPDATE posts SET"); // Check update branch
    expect(sql).toContain("INSERT INTO posts"); // Check insert branch
  });
});

const mockRawEntity = {
  schema: {
    id: "serial PRIMARY KEY",
    title: "text NOT NULL"
  },
  permissions: {
    create: [],
    view: []
  }
};

describe("Manifest Generation", () => {
  test("should generate allowlist", () => {
    // Create IR first
    const ir = generateIR({
        entities: { posts: mockRawEntity },
        subscribables: {}
    });

    const manifest = generateManifest(ir);
    
    expect(manifest.version).toBe("2.0.0");
    expect(manifest.functions).toBeDefined();
    
    // Check allowlist
    expect(manifest.functions["save_posts"]).toBeDefined();
    expect(manifest.functions["get_posts"]).toBeDefined();
    expect(manifest.functions["delete_posts"]).toBeDefined();
    
    // Check signatures (basic check for now)
    expect(manifest.functions["save_posts"].args).toEqual(["p_user_id", "p_data"]);
  });
});