/**
 * SQL Validation Tests
 * Validates the structure and syntax of generated SQL without requiring a database
 */

import { describe, test, expect } from 'bun:test';
import { readFileSync } from 'fs';
import { compileFromSQL } from '../../src/compiler/compiler.js';

describe('SQL Validation Tests', () => {
  let compiledSQL;
  let compiledEntity;

  test('compiles test entity successfully', () => {
    const entitySQL = readFileSync('./tests/compiler/examples/test-graph-rules.sql', 'utf8');
    const result = compileFromSQL(entitySQL);

    expect(result.results.length).toBe(1);
    expect(result.errors.length).toBe(0);

    compiledEntity = result.results[0];
    compiledSQL = compiledEntity.sql;
  });

  describe('Generated SQL Structure', () => {
    test('includes header comment', () => {
      expect(compiledSQL).toContain('DZQL Compiled Functions for:');
      expect(compiledSQL).toContain('organisations');
    });

    test('generates permission functions', () => {
      expect(compiledSQL).toContain('CREATE OR REPLACE FUNCTION can_view_organisations');
      expect(compiledSQL).toContain('CREATE OR REPLACE FUNCTION can_create_organisations');
      expect(compiledSQL).toContain('CREATE OR REPLACE FUNCTION can_update_organisations');
      expect(compiledSQL).toContain('CREATE OR REPLACE FUNCTION can_delete_organisations');
    });

    test('generates operation functions', () => {
      expect(compiledSQL).toContain('CREATE OR REPLACE FUNCTION get_organisations');
      expect(compiledSQL).toContain('CREATE OR REPLACE FUNCTION save_organisations');
      expect(compiledSQL).toContain('CREATE OR REPLACE FUNCTION delete_organisations');
      expect(compiledSQL).toContain('CREATE OR REPLACE FUNCTION lookup_organisations');
      expect(compiledSQL).toContain('CREATE OR REPLACE FUNCTION search_organisations');
    });

    test('generates graph rule functions', () => {
      expect(compiledSQL).toContain('CREATE OR REPLACE FUNCTION _graph_organisations_on_create');
    });

    test('all functions use SECURITY DEFINER', () => {
      const functionCount = (compiledSQL.match(/CREATE OR REPLACE FUNCTION/g) || []).length;
      const securityDefinerCount = (compiledSQL.match(/SECURITY DEFINER/g) || []).length;
      expect(functionCount).toBe(securityDefinerCount);
    });

    test('all functions use plpgsql language', () => {
      const functionCount = (compiledSQL.match(/CREATE OR REPLACE FUNCTION/g) || []).length;
      const plpgsqlCount = (compiledSQL.match(/LANGUAGE plpgsql/g) || []).length;
      expect(functionCount).toBe(plpgsqlCount);
    });
  });

  describe('Permission Functions', () => {
    test('can_view has correct signature', () => {
      expect(compiledSQL).toMatch(/CREATE OR REPLACE FUNCTION can_view_organisations\(\s*p_user_id INT,\s*p_record JSONB/);
      expect(compiledSQL).toMatch(/can_view_organisations.*RETURNS BOOLEAN/s);
    });

    test('can_view includes owner check', () => {
      const viewFunction = compiledSQL.match(/CREATE OR REPLACE FUNCTION can_view_organisations.*?END;/s)[0];
      expect(viewFunction).toContain("(p_record->>'owner_id')::int = p_user_id");
    });

    test('can_view includes acts_for traversal', () => {
      const viewFunction = compiledSQL.match(/CREATE OR REPLACE FUNCTION can_view_organisations.*?END;/s)[0];
      expect(viewFunction).toContain('EXISTS');
      expect(viewFunction).toContain('FROM acts_for');
      expect(viewFunction).toContain('valid_to IS NULL');
    });

    test('can_create has correct signature', () => {
      expect(compiledSQL).toMatch(/CREATE OR REPLACE FUNCTION can_create_organisations\(\s*p_user_id INT,\s*p_record JSONB/);
    });

    test('can_delete has correct signature', () => {
      expect(compiledSQL).toMatch(/CREATE OR REPLACE FUNCTION can_delete_organisations\(\s*p_user_id INT,\s*p_record JSONB/);
    });
  });

  describe('GET Function', () => {
    test('has correct signature', () => {
      expect(compiledSQL).toMatch(/CREATE OR REPLACE FUNCTION get_organisations\(\s*p_user_id INT,\s*p_id INT/);
      expect(compiledSQL).toMatch(/get_organisations.*RETURNS JSONB/s);
    });

    test('includes permission check', () => {
      const getFunction = compiledSQL.match(/CREATE OR REPLACE FUNCTION get_organisations.*?END;/s)[0];
      expect(getFunction).toContain('IF NOT can_view_organisations');
      expect(getFunction).toContain('Permission denied');
    });

    test('includes FK expansion', () => {
      const getFunction = compiledSQL.match(/CREATE OR REPLACE FUNCTION get_organisations.*?END;/s)[0];
      expect(getFunction).toContain('Expand org');
      expect(getFunction).toContain('jsonb_build_object');
    });
  });

  describe('SAVE Function', () => {
    test('has correct signature', () => {
      expect(compiledSQL).toMatch(/CREATE OR REPLACE FUNCTION save_organisations\(\s*p_user_id INT,\s*p_data JSONB/);
      expect(compiledSQL).toMatch(/save_organisations.*RETURNS JSONB/s);
    });

    test('includes insert/update detection', () => {
      const saveFunction = compiledSQL.match(/CREATE OR REPLACE FUNCTION save_organisations.*?END;/s)[0];
      expect(saveFunction).toContain('v_is_insert BOOLEAN');
      expect(saveFunction).toContain("IF p_data->>'id' IS NULL THEN");
    });

    test('includes permission checks', () => {
      const saveFunction = compiledSQL.match(/CREATE OR REPLACE FUNCTION save_organisations.*?END;/s)[0];
      expect(saveFunction).toContain('IF NOT can_create_organisations');
      expect(saveFunction).toContain('IF NOT can_update_organisations');
    });

    test('includes graph rules call', () => {
      const saveFunction = compiledSQL.match(/CREATE OR REPLACE FUNCTION save_organisations.*?END;/s)[0];
      expect(saveFunction).toContain('IF v_is_insert THEN');
      expect(saveFunction).toContain('_graph_organisations_on_create');
    });

    test('performs upsert', () => {
      const saveFunction = compiledSQL.match(/CREATE OR REPLACE FUNCTION save_organisations.*?END;/s)[0];
      expect(saveFunction).toContain('INSERT INTO organisations');
      expect(saveFunction).toContain('UPDATE organisations');
    });
  });

  describe('DELETE Function', () => {
    test('has correct signature', () => {
      expect(compiledSQL).toMatch(/CREATE OR REPLACE FUNCTION delete_organisations\(\s*p_user_id INT,\s*p_id INT/);
    });

    test('includes permission check', () => {
      const deleteFunction = compiledSQL.match(/CREATE OR REPLACE FUNCTION delete_organisations.*?END;/s)[0];
      expect(deleteFunction).toContain('IF NOT can_delete_organisations');
    });

    test('performs delete', () => {
      const deleteFunction = compiledSQL.match(/CREATE OR REPLACE FUNCTION delete_organisations.*?END;/s)[0];
      expect(deleteFunction).toContain('DELETE FROM organisations');
    });
  });

  describe('LOOKUP Function', () => {
    test('has correct signature', () => {
      expect(compiledSQL).toMatch(/CREATE OR REPLACE FUNCTION lookup_organisations/);
      expect(compiledSQL).toContain('p_filter TEXT DEFAULT NULL');
      expect(compiledSQL).toContain('p_limit INT DEFAULT 50');
    });

    test('returns value/label pairs', () => {
      const lookupFunction = compiledSQL.match(/CREATE OR REPLACE FUNCTION lookup_organisations.*?END;/s)[0];
      expect(lookupFunction).toContain("'value', id");
      expect(lookupFunction).toContain("'label', name");
    });

    test('includes filtering', () => {
      const lookupFunction = compiledSQL.match(/CREATE OR REPLACE FUNCTION lookup_organisations.*?END;/s)[0];
      expect(lookupFunction).toContain('ILIKE');
    });
  });

  describe('SEARCH Function', () => {
    test('has correct signature', () => {
      expect(compiledSQL).toMatch(/CREATE OR REPLACE FUNCTION search_organisations/);
      expect(compiledSQL).toContain('p_filters JSONB DEFAULT');
      expect(compiledSQL).toContain('p_search TEXT DEFAULT NULL');
      expect(compiledSQL).toContain('p_sort JSONB DEFAULT NULL');
      expect(compiledSQL).toContain('p_page INT DEFAULT 1');
      expect(compiledSQL).toContain('p_limit INT DEFAULT 25');
    });

    test('builds dynamic WHERE clause', () => {
      const searchFunction = compiledSQL.match(/CREATE OR REPLACE FUNCTION search_organisations.*?END;/s)[0];
      expect(searchFunction).toContain("v_where_clause TEXT := 'TRUE'");
      expect(searchFunction).toContain('FOR v_field, v_filter IN SELECT * FROM jsonb_each(p_filters)');
    });

    test('supports all filter operators', () => {
      const searchFunction = compiledSQL.match(/CREATE OR REPLACE FUNCTION search_organisations.*?END;/s)[0];
      expect(searchFunction).toContain("WHEN 'eq' THEN");
      expect(searchFunction).toContain("WHEN 'ne' THEN");
      expect(searchFunction).toContain("WHEN 'gt' THEN");
      expect(searchFunction).toContain("WHEN 'gte' THEN");
      expect(searchFunction).toContain("WHEN 'lt' THEN");
      expect(searchFunction).toContain("WHEN 'lte' THEN");
      expect(searchFunction).toContain("WHEN 'in' THEN");
      expect(searchFunction).toContain("WHEN 'ilike' THEN");
    });

    test('returns paginated results', () => {
      const searchFunction = compiledSQL.match(/CREATE OR REPLACE FUNCTION search_organisations.*?END;/s)[0];
      expect(searchFunction).toContain('v_offset := (p_page - 1) * p_limit');
      expect(searchFunction).toContain("'data', v_data");
      expect(searchFunction).toContain("'total', v_total");
      expect(searchFunction).toContain("'page', p_page");
      expect(searchFunction).toContain("'limit', p_limit");
    });
  });

  describe('Graph Rules', () => {
    test('has correct signature', () => {
      expect(compiledSQL).toMatch(/CREATE OR REPLACE FUNCTION _graph_organisations_on_create\(\s*p_user_id INT,\s*p_record JSONB/);
      expect(compiledSQL).toMatch(/_graph_organisations_on_create.*RETURNS VOID/s);
    });

    test('includes comment describing the rule', () => {
      const graphFunction = compiledSQL.match(/CREATE OR REPLACE FUNCTION _graph_organisations_on_create.*?END;/s)[0];
      expect(graphFunction).toContain('Creator becomes owner');
    });

    test('performs INSERT action', () => {
      const graphFunction = compiledSQL.match(/CREATE OR REPLACE FUNCTION _graph_organisations_on_create.*?END;/s)[0];
      expect(graphFunction).toContain('INSERT INTO acts_for');
      expect(graphFunction).toContain('user_id, org_id, valid_from');
    });

    test('resolves special variables', () => {
      const graphFunction = compiledSQL.match(/CREATE OR REPLACE FUNCTION _graph_organisations_on_create.*?END;/s)[0];
      expect(graphFunction).toContain('p_user_id'); // @user_id
      expect(graphFunction).toContain("(p_record->>'id')"); // @id
      expect(graphFunction).toContain('CURRENT_DATE'); // @today
    });
  });

  describe('Checksum and Metadata', () => {
    test('includes checksum', () => {
      expect(compiledEntity.checksum).toBeDefined();
      expect(compiledEntity.checksum).toMatch(/^[a-f0-9]{64}$/i);
    });

    test('includes table name', () => {
      expect(compiledEntity.tableName).toBe('organisations');
    });

    test('includes generation timestamp', () => {
      expect(compiledEntity.generatedAt).toBeDefined();
      expect(new Date(compiledEntity.generatedAt)).toBeInstanceOf(Date);
    });

    test('includes compilation time', () => {
      expect(compiledEntity.compilationTime).toBeDefined();
      expect(typeof compiledEntity.compilationTime).toBe('number');
      expect(compiledEntity.compilationTime).toBeGreaterThan(0);
    });
  });

  describe('SQL Syntax Validation', () => {
    test('no obvious syntax errors', () => {
      // Check for balanced parentheses
      const openParens = (compiledSQL.match(/\(/g) || []).length;
      const closeParens = (compiledSQL.match(/\)/g) || []).length;
      expect(openParens).toBe(closeParens);
    });

    test('all functions are properly closed', () => {
      const createCount = (compiledSQL.match(/CREATE OR REPLACE FUNCTION/g) || []).length;
      const endCount = (compiledSQL.match(/END;\s*\$\$ LANGUAGE plpgsql/g) || []).length;
      expect(createCount).toBe(endCount);
    });

    test('no trailing commas in parameter lists', () => {
      expect(compiledSQL).not.toMatch(/,\s*\)/);
    });

    test('all SQL keywords are uppercase', () => {
      expect(compiledSQL).toContain('CREATE OR REPLACE FUNCTION');
      expect(compiledSQL).toContain('RETURNS');
      expect(compiledSQL).toContain('DECLARE');
      expect(compiledSQL).toContain('BEGIN');
      expect(compiledSQL).toContain('END');
      expect(compiledSQL).toContain('LANGUAGE');
      expect(compiledSQL).toContain('SECURITY DEFINER');
    });
  });
});
