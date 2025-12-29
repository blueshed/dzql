import { describe, test, expect } from "bun:test";
import { compileGraphRules } from "../src/cli/compiler/graph_rules.js";

const mockEntity = {
  name: 'posts',
  graphRules: {
    onCreate: [
      {
        type: 'reactor',
        name: 'notify_subscribers',
        params: { post_id: '@id' }
      }
    ],
    onDelete: [
      {
        type: 'delete',
        target: 'comments',
        params: { post_id: '@id' } // Implicitly means CASCADE logic
      }
    ]
  }
};

describe("Graph Rules Compiler", () => {
  
  test("should compile reactor to event insertion", () => {
    // Should insert into dzql_v2.events with op='reactor:notify_subscribers'
    const sql = compileGraphRules('posts', 'create', mockEntity.graphRules.onCreate);
    
    expect(sql).toContain("INSERT INTO dzql_v2.events");
    expect(sql).toContain("'reactor:notify_subscribers'");
    // Simply check for the variable resolution logic
    expect(sql).toContain("v_result->>'id'"); 
  });

  test("should compile delete action to SQL delete", () => {
    // Should generate DELETE FROM comments ...
    const sql = compileGraphRules('posts', 'delete', mockEntity.graphRules.onDelete);
    
    expect(sql).toContain("DELETE FROM comments");
    expect(sql).toContain("post_id = (p_pk->>'id')::int"); // Variable resolution from PK
  });

});