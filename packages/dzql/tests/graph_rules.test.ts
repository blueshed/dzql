import { describe, test, expect } from "bun:test";
import { compileGraphRules } from "../src/cli/compiler/graph_rules.js";
import type { GraphRuleIR } from "../src/shared/ir.js";

// Mock entity graph rules in IR format
const mockGraphRules = {
  onCreate: [
    {
      trigger: 'create' as const,
      action: 'reactor' as const,
      target: 'notify_subscribers',
      params: { post_id: '@id' }
    }
  ] as GraphRuleIR[],
  onDelete: [
    {
      trigger: 'delete' as const,
      action: 'delete' as const,
      target: 'comments',
      params: { post_id: '@id' }
    }
  ] as GraphRuleIR[]
};

describe("Graph Rules Compiler", () => {

  test("should compile reactor to event insertion", () => {
    // Should insert into dzql_v2.events with op='reactor:notify_subscribers'
    const sql = compileGraphRules('posts', 'create', mockGraphRules.onCreate);

    expect(sql).toContain("INSERT INTO dzql_v2.events");
    expect(sql).toContain("'reactor:notify_subscribers'");
    // Simply check for the variable resolution logic
    expect(sql).toContain("v_result->>'id'");
  });

  test("should compile delete action to SQL delete", () => {
    // Should generate DELETE FROM comments ...
    const sql = compileGraphRules('posts', 'delete', mockGraphRules.onDelete);

    expect(sql).toContain("DELETE FROM comments");
    expect(sql).toContain("post_id = (v_old_data->>'id')::int"); // Variable resolution from old record
  });

  test("should compile create action with field defaults", () => {
    const rules: GraphRuleIR[] = [{
      trigger: 'create',
      action: 'create',
      target: 'memberships',
      params: { user_id: '@user_id', org_id: '@id', valid_from: '@today' }
    }];

    const sql = compileGraphRules('organisations', 'create', rules);

    expect(sql).toContain("INSERT INTO memberships");
    expect(sql).toContain("user_id, org_id, valid_from");
    expect(sql).toContain("p_user_id");
    expect(sql).toContain("(v_result->>'id')::int");
    expect(sql).toContain("CURRENT_DATE");
  });

  test("should compile update action with match clause", () => {
    const rules: GraphRuleIR[] = [{
      trigger: 'update',
      action: 'update',
      target: 'audit_log',
      params: { last_modified: '@now' },
      match: { entity_id: '@id' }
    }];

    const sql = compileGraphRules('posts', 'update', rules);

    expect(sql).toContain("UPDATE audit_log");
    expect(sql).toContain("SET last_modified = NOW()");
    expect(sql).toContain("WHERE entity_id = (v_result->>'id')::int");
  });

  test("should compile validate action", () => {
    const rules: GraphRuleIR[] = [{
      trigger: 'create',
      action: 'validate',
      target: 'check_quota',
      params: { user_id: '@user_id' },
      error_message: 'Quota exceeded'
    }];

    const sql = compileGraphRules('posts', 'create', rules);

    expect(sql).toContain("IF NOT check_quota(");
    expect(sql).toContain("user_id => p_user_id");
    expect(sql).toContain("RAISE EXCEPTION 'Quota exceeded'");
  });

  test("should compile execute action", () => {
    const rules: GraphRuleIR[] = [{
      trigger: 'create',
      action: 'execute',
      target: 'send_notification',
      params: { post_id: '@id', author_id: '@author_id' }
    }];

    const sql = compileGraphRules('posts', 'create', rules);

    expect(sql).toContain("PERFORM send_notification(");
    expect(sql).toContain("post_id => (v_result->>'id')");
    expect(sql).toContain("author_id => (v_result->>'author_id')");
  });

  test("should compile conditional rule with @before/@after", () => {
    const rules: GraphRuleIR[] = [{
      trigger: 'update',
      action: 'reactor',
      target: 'status_changed',
      condition: "@before.status = 'draft' AND @after.status = 'published'",
      params: { post_id: '@id' }
    }];

    const sql = compileGraphRules('posts', 'update', rules);

    expect(sql).toContain("-- Condition:");
    expect(sql).toContain("IF (v_old_data->>'status') = 'draft' AND (v_result->>'status') = 'published' THEN");
    expect(sql).toContain("INSERT INTO dzql_v2.events");
    expect(sql).toContain("END IF;");
  });

  test("should resolve @before variables in delete trigger", () => {
    const rules: GraphRuleIR[] = [{
      trigger: 'delete',
      action: 'execute',
      target: 'archive_post',
      params: { title: '@before.title', author_id: '@before.author_id' }
    }];

    const sql = compileGraphRules('posts', 'delete', rules);

    expect(sql).toContain("PERFORM archive_post(");
    expect(sql).toContain("title => (v_old_data->>'title')");
    // Note: execute/validate params don't get ::int cast - they're named parameters
    expect(sql).toContain("author_id => (v_old_data->>'author_id')");
  });

  test("should handle multiple actions", () => {
    const rules: GraphRuleIR[] = [
      {
        trigger: 'create',
        action: 'validate',
        target: 'check_permissions',
        params: { user_id: '@user_id' },
        error_message: 'Not allowed'
      },
      {
        trigger: 'create',
        action: 'create',
        target: 'audit_log',
        params: { entity_id: '@id', action: 'created' }
      },
      {
        trigger: 'create',
        action: 'reactor',
        target: 'notify_admins',
        params: { post_id: '@id' }
      }
    ];

    const sql = compileGraphRules('posts', 'create', rules);

    // Should have all three actions
    expect(sql).toContain("IF NOT check_permissions");
    expect(sql).toContain("INSERT INTO audit_log");
    expect(sql).toContain("reactor:notify_admins");
  });

});
