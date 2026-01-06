import { describe, test, expect } from "bun:test";
import { compilePermission } from "../src/cli/compiler/permissions.js";

// Mock IR context for resolving relationships
const mockContext = {
  entities: {
    posts: {
      table: 'posts',
      primaryKey: ['id'],
      columns: [{name: 'id', type: 'int'}, {name: 'org_id', type: 'int'}]
    },
    organisations: {
      table: 'organisations',
      primaryKey: ['id'],
      columns: [{name: 'id', type: 'int'}]
    },
    acts_for: {
      table: 'acts_for',
      primaryKey: ['user_id', 'org_id'],
      columns: [{name: 'user_id', type: 'int'}, {name: 'org_id', type: 'int'}, {name: 'role', type: 'text'}]
    }
  }
};

describe("Permission Compiler", () => {

  test("should compile simple owner check", () => {
    // Rule: @author_id == @user_id
    // Context: posts table
    const sql = compilePermission('posts', '@author_id', mockContext);

    // Should generate: (p_data->>'author_id')::int = p_user_id
    expect(sql).toContain("(p_data->>'author_id')::int = p_user_id");
  });

  test("should compile graph traversal", () => {
    // Rule: @org_id->acts_for[org_id=$].user_id
    // Meaning: Join via org_id from p_data, check if user_id matches

    const sql = compilePermission('posts', '@org_id->acts_for[org_id=$].user_id', mockContext);

    expect(sql).toContain("EXISTS");
    expect(sql).toContain("FROM acts_for");
    expect(sql).toContain("acts_for.org_id = (p_data->>'org_id')::int"); // Join via jsonb param
    expect(sql).toContain("acts_for.user_id = p_user_id");   // Match
  });

  test("should compile condition", () => {
    // Rule: @org_id->acts_for[org_id=$]{role='admin'}.user_id
    const sql = compilePermission('posts', "@org_id->acts_for[org_id=$]{role='admin'}.user_id", mockContext);

    expect(sql).toContain("acts_for.role = 'admin'");
  });

  test("should compile multiple conditions", () => {
    // Rule: @org_id->acts_for[org_id=$]{active,role=admin}.user_id
    const sql = compilePermission('posts', "@org_id->acts_for[org_id=$]{active,role=admin}.user_id", mockContext);

    expect(sql).toContain("acts_for.active = true");
    expect(sql).toContain("acts_for.role = 'admin'");
  });

});
