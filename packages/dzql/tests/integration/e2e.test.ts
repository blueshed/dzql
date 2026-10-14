import { describe, test, expect, beforeAll } from "bun:test";
import { generateCoreSQL, generateEntitySQL } from "../../src/cli/codegen/sql.js";
import { generateIR } from "../../src/cli/compiler/ir.js";

// Load our blog example directly (bypassing loader for test isolation)
import { entities } from "../../examples/blog.js";

const blogDomain = { entities, subscribables: {} };

describe("V2 End-to-End Compiler Integration", () => {
  let ir: any;
  let coreSQL: string;
  let postsSQL: string;
  let commentsSQL: string;

  beforeAll(() => {
    // 1. Generate IR from Domain Object
    ir = generateIR(blogDomain);
    
    // 2. Generate SQL
    coreSQL = generateCoreSQL();
    postsSQL = generateEntitySQL("posts", ir.entities.posts);
    commentsSQL = generateEntitySQL("comments", ir.entities.comments);
  });

  test("should generate valid IR for blog", () => {
    expect(ir.entities.posts).toBeDefined();
    expect(ir.entities.posts.primaryKey).toEqual(["id"]);
    // Check permission parsing
    expect(ir.entities.posts.permissions.create).toEqual(['@author_id == @user_id']);
  });

  test("should generate core SQL schema", () => {
    expect(coreSQL).toContain("CREATE SCHEMA IF NOT EXISTS dzql_v2");
    expect(coreSQL).toContain("CREATE TABLE IF NOT EXISTS dzql_v2.events");
  });

  test("should generate atomic UPSERT for posts", () => {
    // Check function signature
    expect(postsSQL).toContain("CREATE OR REPLACE FUNCTION dzql_v2.save_posts");
    
    // Check security
    expect(postsSQL).toContain("SECURITY DEFINER");
    expect(postsSQL).toContain("SET search_path = dzql_v2, public");
    
    // Check Update/Insert Branching (New V2 Pattern with composite PK support)
    expect(postsSQL).toContain("AND EXISTS(SELECT 1 FROM posts WHERE");
    expect(postsSQL).toContain("UPDATE posts SET");
    expect(postsSQL).toContain("INSERT INTO posts");
    
    // Check column handling in update
    expect(postsSQL).toContain("title = CASE WHEN (p_data ? 'title')");
  });

  test("should inline permission checks", () => {
    // Check that @author_id == @user_id was compiled correctly
    expect(postsSQL).toContain("IF NOT ((p_data->>'author_id')::int = p_user_id) THEN"); 
  });

  test("should compile graph rules", () => {
    // Check reactor trigger
    expect(postsSQL).toContain("INSERT INTO dzql_v2.events");
    expect(postsSQL).toContain("'reactor:notify_subscribers'");
  });
});