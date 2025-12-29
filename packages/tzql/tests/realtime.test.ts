import { describe, test, expect } from "bun:test";
import { generateAffectedKeysFunction } from "../src/cli/codegen/realtime.js";

const mockSubscribable = {
  name: "post_detail",
  params: { post_id: "int" },
  root: { entity: "posts", key: "post_id" },
  scopeTables: ["posts", "comments"]
};

describe("Realtime Logic Generation", () => {
  test("should generate affected keys function", () => {
    const sql = generateAffectedKeysFunction("post_detail", mockSubscribable);
    
    expect(sql).toContain("CREATE OR REPLACE FUNCTION dzql_v2.post_detail_affected_keys");
    expect(sql).toContain("RETURNS text[]");
    
    // Logic check: should return array of keys
    expect(sql).toContain("WHEN 'posts' THEN");
    expect(sql).toContain("RETURN ARRAY['post_detail:' || COALESCE(p_new->>'id', p_old->>'id')]"); 
  });
});
