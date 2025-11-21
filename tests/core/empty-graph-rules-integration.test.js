/**
 * Integration test for compiler bug: empty graph_rules
 *
 * Bug report: bug.md
 * Issue: Compiler generates calls to missing graph functions when graph_rules is empty
 *
 * This test reproduces the exact scenario from the bug report to ensure it's fixed.
 */

import { test, expect, describe } from 'bun:test';
import { DZQLCompiler } from '../../packages/dzql/src/compiler/compiler.js';

describe('Empty graph_rules integration test', () => {
  test('compiles entity with empty graph_rules from SQL without generating graph function calls', () => {
    const compiler = new DZQLCompiler();

    // Exact SQL from bug report
    const sql = `
      SELECT dzql.register_entity(
        'events',
        'title',
        ARRAY['title', 'description'],
        '{"resource": "resources"}',
        false,
        '{}',
        '{"ownership": ["@owner_id"]}',
        '{
          "view": [],
          "create": [],
          "update": ["@owner_id"],
          "delete": ["@owner_id"]
        }',
        '{}'  -- Empty graph_rules
      );
    `;

    const result = compiler.compileFromSQL(sql);

    // Verify compilation succeeded
    expect(result.summary.successful).toBe(1);
    expect(result.summary.failed).toBe(0);
    expect(result.results).toHaveLength(1);

    const compiled = result.results[0];
    const generatedSQL = compiled.sql;

    // CRITICAL: Should NOT contain graph function definitions when graph_rules is empty
    expect(generatedSQL).not.toContain('CREATE OR REPLACE FUNCTION _graph_events_on_create');
    expect(generatedSQL).not.toContain('CREATE OR REPLACE FUNCTION _graph_events_on_update');
    expect(generatedSQL).not.toContain('CREATE OR REPLACE FUNCTION _graph_events_on_delete');

    // CRITICAL: Should NOT contain PERFORM calls to graph functions
    expect(generatedSQL).not.toContain('PERFORM _graph_events_on_create(');
    expect(generatedSQL).not.toContain('PERFORM _graph_events_on_update(');
    expect(generatedSQL).not.toContain('PERFORM _graph_events_on_delete(');

    // Should still generate all CRUD operations
    expect(generatedSQL).toContain('CREATE OR REPLACE FUNCTION get_events');
    expect(generatedSQL).toContain('CREATE OR REPLACE FUNCTION save_events');
    expect(generatedSQL).toContain('CREATE OR REPLACE FUNCTION delete_events');
    expect(generatedSQL).toContain('CREATE OR REPLACE FUNCTION lookup_events');
    expect(generatedSQL).toContain('CREATE OR REPLACE FUNCTION search_events');

    // Should generate permission functions
    expect(generatedSQL).toContain('CREATE OR REPLACE FUNCTION can_view_events');
    expect(generatedSQL).toContain('CREATE OR REPLACE FUNCTION can_create_events');
    expect(generatedSQL).toContain('CREATE OR REPLACE FUNCTION can_update_events');
    expect(generatedSQL).toContain('CREATE OR REPLACE FUNCTION can_delete_events');
  });

  test('compiles entity with null graph_rules without generating graph function calls', () => {
    const compiler = new DZQLCompiler();

    const sql = `
      SELECT dzql.register_entity(
        'resources',
        'name',
        ARRAY['name'],
        '{}',
        false,
        '{}',
        '{}',
        '{"view": [], "create": []}',
        NULL  -- NULL graph_rules
      );
    `;

    const result = compiler.compileFromSQL(sql);
    const generatedSQL = result.results[0].sql;

    // Should not generate any graph functions
    expect(generatedSQL).not.toContain('_graph_resources_');
    expect(generatedSQL).not.toContain('PERFORM _graph_');

    // Should still work correctly
    expect(generatedSQL).toContain('CREATE OR REPLACE FUNCTION save_resources');
  });

  test('compiles entity WITH graph_rules and generates function calls correctly', () => {
    const compiler = new DZQLCompiler();

    const sql = `
      SELECT dzql.register_entity(
        'tasks',
        'title',
        ARRAY['title'],
        '{}',
        false,
        '{}',
        '{}',
        '{"view": [], "create": []}',
        '{
          "on_create": {
            "notify_owner": {
              "description": "Notify owner",
              "actions": [{
                "type": "execute",
                "function": "notify_user",
                "params": {"user_id": "@owner_id"}
              }]
            }
          }
        }'
      );
    `;

    const result = compiler.compileFromSQL(sql);
    const generatedSQL = result.results[0].sql;

    // SHOULD contain graph function definition when rules exist
    expect(generatedSQL).toContain('CREATE OR REPLACE FUNCTION _graph_tasks_on_create');

    // SHOULD contain PERFORM call to graph function
    expect(generatedSQL).toContain('PERFORM _graph_tasks_on_create(');

    // Should NOT contain on_update or on_delete functions (not defined)
    expect(generatedSQL).not.toContain('_graph_tasks_on_update');
    expect(generatedSQL).not.toContain('_graph_tasks_on_delete');
  });

  test('compiles multiple entities with mixed graph_rules correctly', () => {
    const compiler = new DZQLCompiler();

    const sql = `
      -- Entity without graph rules
      SELECT dzql.register_entity(
        'posts',
        'title',
        ARRAY['title'],
        '{}',
        false,
        '{}',
        '{}',
        '{"view": [], "create": []}',
        '{}'
      );

      -- Entity with graph rules
      SELECT dzql.register_entity(
        'comments',
        'content',
        ARRAY['content'],
        '{}',
        false,
        '{}',
        '{}',
        '{"view": [], "create": []}',
        '{
          "on_create": {
            "increment_count": {
              "actions": [{
                "type": "update",
                "entity": "posts",
                "match": {"id": "@post_id"},
                "data": {"comment_count": "comment_count + 1"}
              }]
            }
          }
        }'
      );
    `;

    const result = compiler.compileFromSQL(sql);

    expect(result.summary.successful).toBe(2);

    const postsSQL = result.results[0].sql;
    const commentsSQL = result.results[1].sql;

    // Posts (empty graph_rules) should NOT have graph functions
    expect(postsSQL).not.toContain('_graph_posts_');

    // Comments (has graph_rules) SHOULD have graph functions
    expect(commentsSQL).toContain('CREATE OR REPLACE FUNCTION _graph_comments_on_create');
    expect(commentsSQL).toContain('PERFORM _graph_comments_on_create(');
  });

  test('compiles entity with only on_update graph rule (no on_create)', () => {
    const compiler = new DZQLCompiler();

    const sql = `
      SELECT dzql.register_entity(
        'articles',
        'title',
        ARRAY['title'],
        '{}',
        false,
        '{}',
        '{}',
        '{"view": [], "create": []}',
        '{
          "on_update": {
            "track_changes": {
              "actions": [{
                "type": "execute",
                "function": "log_change",
                "params": {"entity": "articles"}
              }]
            }
          }
        }'
      );
    `;

    const result = compiler.compileFromSQL(sql);
    const generatedSQL = result.results[0].sql;

    // Should have on_update but NOT on_create or on_delete
    expect(generatedSQL).toContain('CREATE OR REPLACE FUNCTION _graph_articles_on_update');
    expect(generatedSQL).toContain('PERFORM _graph_articles_on_update(');

    expect(generatedSQL).not.toContain('_graph_articles_on_create');
    expect(generatedSQL).not.toContain('_graph_articles_on_delete');
  });
});

describe('Bug regression test - exact scenario from bug.md', () => {
  test('reproduces bug report scenario and verifies it is fixed', () => {
    const compiler = new DZQLCompiler();

    // Exact scenario from bug.md
    const sql = `
      SELECT dzql.register_entity(
        'events',
        'title',
        ARRAY['title', 'description'],
        '{"resource": "resources"}',
        false,
        '{}',
        '{"ownership": ["@owner_id"]}',
        '{
          "view": [],
          "create": [],
          "update": ["@owner_id"],
          "delete": ["@owner_id"]
        }',
        '{}'
      );
    `;

    const result = compiler.compileFromSQL(sql);
    const generatedSQL = result.results[0].sql;

    // Bug: Compiler was generating this line even though graph_rules was empty
    // Expected: This line should NOT exist
    const buggyLine = 'PERFORM _graph_events_on_create(p_user_id, to_jsonb(v_result));';
    expect(generatedSQL).not.toContain(buggyLine);

    // Bug would cause this error at runtime:
    // PostgresError: function _graph_events_on_create(integer, jsonb) does not exist

    // Verify the save function exists but doesn't call non-existent graph functions
    const saveFunctionMatch = generatedSQL.match(/CREATE OR REPLACE FUNCTION save_events[\s\S]*?\$\$ LANGUAGE plpgsql/);
    expect(saveFunctionMatch).toBeTruthy();

    const saveFunction = saveFunctionMatch[0];

    // The save function should exist
    expect(saveFunction).toContain('v_is_insert BOOLEAN');

    // But should NOT call graph functions
    expect(saveFunction).not.toContain('_graph_events_on_create');
    expect(saveFunction).not.toContain('_graph_events_on_update');

    console.log('✅ Bug is FIXED: No graph function calls generated for empty graph_rules');
  });
});
