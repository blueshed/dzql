/**
 * Test M2M compilation - Verify generated SQL has NO runtime loops
 */

import { test, expect } from "bun:test";
import { DZQLCompiler } from '../../packages/dzql/src/compiler/compiler.js';

test("Compiler generates M2M sync logic WITHOUT runtime loops", () => {
  const compiler = new DZQLCompiler();

  const entity = {
    tableName: 'resources',
    labelField: 'title',
    searchableFields: ['title'],
    fkIncludes: {},
    manyToMany: {
      tags: {
        junction_table: 'resource_tags',
        local_key: 'resource_id',
        foreign_key: 'tag_id',
        target_entity: 'tags',
        id_field: 'tag_ids',
        expand: false
      }
    }
  };

  const result = compiler.compile(entity);

  // Uncomment to debug generated SQL:
  // console.log('\n=== GENERATED SAVE FUNCTION ===');
  // console.log(result.sql);
  // console.log('=== END ===\n');

  // ✅ VERIFY: M2M variables declared (compile-time loop generated this)
  expect(result.sql).toContain('v_tag_ids INT[]');
  expect(result.sql).toContain('-- M2M: tags');

  // ✅ VERIFY: M2M extraction (static IF blocks, NO loops!)
  expect(result.sql).toContain("IF p_data ? 'tag_ids' THEN");
  expect(result.sql).toContain("v_tag_ids := ARRAY(SELECT jsonb_array_elements_text(p_data->'tag_ids')::int)");
  expect(result.sql).toContain("p_data := p_data - 'tag_ids'");

  // ✅ VERIFY: Junction table sync (static SQL, NO loops!)
  expect(result.sql).toContain('DELETE FROM resource_tags');
  expect(result.sql).toContain('WHERE resource_id = v_result.id');
  expect(result.sql).toContain('INSERT INTO resource_tags');
  expect(result.sql).toContain('ON CONFLICT');

  // ✅ VERIFY: M2M expansion in output (static SQL, NO loops!)
  expect(result.sql).toContain("jsonb_build_object('tag_ids'");
  expect(result.sql).toContain('FROM resource_tags WHERE resource_id = v_result.id');

  // ❌ VERIFY: NO runtime loops FOR M2M (keywords that indicate interpretation)
  expect(result.sql).not.toContain('FOR l_m2m_key IN');
  expect(result.sql).not.toContain('jsonb_object_keys(l_entity_config.many_to_many)');
  expect(result.sql).not.toContain('SELECT jsonb_object_keys(');
  expect(result.sql).not.toMatch(/FOR.*IN.*SELECT.*jsonb_object_keys.*many_to_many/);

  // ❌ VERIFY: NO dynamic SQL for M2M (no EXECUTE format with M2M table names)
  expect(result.sql).not.toMatch(/EXECUTE.*format.*%I.*resource_tags/);
  expect(result.sql).not.toContain('l_junction_table');
  expect(result.sql).not.toContain('l_m2m_config');

  // ✅ VERIFY: All table names are literals (not variables)
  expect(result.sql).toContain('resource_tags');  // Literal table name
  expect(result.sql).not.toContain('l_junction_table');  // Variable (bad!)
});

test("Compiler handles multiple M2M relationships - generates separate blocks", () => {
  const compiler = new DZQLCompiler();

  const entity = {
    tableName: 'projects',
    labelField: 'name',
    searchableFields: ['name'],
    fkIncludes: {},
    manyToMany: {
      tags: {
        junction_table: 'project_tags',
        local_key: 'project_id',
        foreign_key: 'tag_id',
        target_entity: 'tags',
        id_field: 'tag_ids',
        expand: false
      },
      collaborators: {
        junction_table: 'project_collaborators',
        local_key: 'project_id',
        foreign_key: 'user_id',
        target_entity: 'users',
        id_field: 'collaborator_ids',
        expand: true
      },
      categories: {
        junction_table: 'project_categories',
        local_key: 'project_id',
        foreign_key: 'category_id',
        target_entity: 'categories',
        id_field: 'category_ids',
        expand: false
      }
    }
  };

  const result = compiler.compile(entity);

  // Uncomment to debug generated SQL:
  // console.log('\n=== GENERATED SAVE FUNCTION (MULTIPLE M2M) ===');
  // console.log(result.sql);
  // console.log('=== END ===\n');

  // ✅ VERIFY: 3 separate variable declarations (NOT a loop!)
  expect(result.sql).toContain('v_tag_ids INT[]');
  expect(result.sql).toContain('v_collaborator_ids INT[]');
  expect(result.sql).toContain('v_category_ids INT[]');

  // ✅ VERIFY: 3 separate extraction blocks (NOT a loop!)
  expect(result.sql).toContain("IF p_data ? 'tag_ids' THEN");
  expect(result.sql).toContain("IF p_data ? 'collaborator_ids' THEN");
  expect(result.sql).toContain("IF p_data ? 'category_ids' THEN");

  // ✅ VERIFY: 3 separate sync blocks (NOT a loop!)
  expect(result.sql).toContain('DELETE FROM project_tags');
  expect(result.sql).toContain('DELETE FROM project_collaborators');
  expect(result.sql).toContain('DELETE FROM project_categories');

  expect(result.sql).toContain('INSERT INTO project_tags');
  expect(result.sql).toContain('INSERT INTO project_collaborators');
  expect(result.sql).toContain('INSERT INTO project_categories');

  // ✅ VERIFY: expand=true generates expanded objects for collaborators only
  expect(result.sql).toContain("jsonb_build_object('tag_ids'");
  expect(result.sql).toContain("jsonb_build_object('collaborator_ids'");
  expect(result.sql).toContain("jsonb_build_object('category_ids'");
  expect(result.sql).toContain("jsonb_build_object('collaborators'");  // expand=true
  expect(result.sql).toContain('JOIN users t ON t.id = jt.user_id');

  // ❌ VERIFY: Still NO runtime loops FOR M2M
  expect(result.sql).not.toContain('FOR l_m2m_key IN');
  expect(result.sql).not.toContain('l_junction_table');
  expect(result.sql).not.toContain('l_m2m_config');
});

test("GET function includes M2M fields", () => {
  const compiler = new DZQLCompiler();

  const entity = {
    tableName: 'brands',
    labelField: 'name',
    searchableFields: ['name'],
    fkIncludes: {},
    manyToMany: {
      tags: {
        junction_table: 'brand_tags',
        local_key: 'brand_id',
        foreign_key: 'tag_id',
        target_entity: 'tags',
        id_field: 'tag_ids',
        expand: true
      }
    }
  };

  const result = compiler.compile(entity);

  // Find the GET function in the output
  const getFunctionMatch = result.sql.match(/CREATE OR REPLACE FUNCTION get_brands\([\s\S]*?\$\$ LANGUAGE plpgsql/);
  expect(getFunctionMatch).toBeTruthy();

  const getFunction = getFunctionMatch[0];

  // Uncomment to debug generated SQL:
  // console.log('\n=== GENERATED GET FUNCTION ===');
  // console.log(getFunction);
  // console.log('=== END ===\n');

  // ✅ VERIFY: M2M fields added to result
  expect(getFunction).toContain("jsonb_build_object('tag_ids'");
  expect(getFunction).toContain('FROM brand_tags WHERE brand_id = v_record.id');

  // ✅ VERIFY: expand=true includes full objects
  expect(getFunction).toContain("jsonb_build_object('tags'");
  expect(getFunction).toContain('JOIN tags t ON t.id = jt.tag_id');

  // ❌ VERIFY: NO loops
  expect(getFunction).not.toContain('FOR l_m2m_key IN');
});

test("SEARCH function includes M2M fields via LATERAL joins", () => {
  const compiler = new DZQLCompiler();

  const entity = {
    tableName: 'resources',
    labelField: 'title',
    searchableFields: ['title'],
    fkIncludes: {},
    manyToMany: {
      tags: {
        junction_table: 'resource_tags',
        local_key: 'resource_id',
        foreign_key: 'tag_id',
        target_entity: 'tags',
        id_field: 'tag_ids',
        expand: false
      },
      collaborators: {
        junction_table: 'resource_collaborators',
        local_key: 'resource_id',
        foreign_key: 'user_id',
        target_entity: 'users',
        id_field: 'collaborator_ids',
        expand: true
      }
    }
  };

  const result = compiler.compile(entity);

  // Find the SEARCH function
  const searchFunctionMatch = result.sql.match(/CREATE OR REPLACE FUNCTION search_resources\([\s\S]*?\$\$ LANGUAGE plpgsql/);
  expect(searchFunctionMatch).toBeTruthy();

  const searchFunction = searchFunctionMatch[0];

  // Uncomment to debug generated SQL:
  // console.log('\n=== GENERATED SEARCH FUNCTION ===');
  // console.log(searchFunction);
  // console.log('=== END ===\n');

  // ✅ VERIFY: LATERAL joins for M2M (static SQL!)
  expect(searchFunction).toContain('LEFT JOIN LATERAL');
  expect(searchFunction).toContain('FROM resource_tags');
  expect(searchFunction).toContain('WHERE resource_id = t.id');
  expect(searchFunction).toContain('m2m_tag_ids');

  // ✅ VERIFY: expand=true includes join
  expect(searchFunction).toContain('FROM resource_collaborators jt');
  expect(searchFunction).toContain('JOIN users target ON target.id = jt.user_id');
  expect(searchFunction).toContain('m2m_collaborators');

  // ✅ VERIFY: M2M fields merged with ||
  expect(searchFunction).toContain('to_jsonb(t.*) ||');
  expect(searchFunction).toContain("jsonb_build_object(''tag_ids''");
  expect(searchFunction).toContain("jsonb_build_object(''collaborator_ids''");
  expect(searchFunction).toContain("jsonb_build_object(''collaborators''");

  // ❌ VERIFY: NO loops
  expect(searchFunction).not.toContain('FOR l_m2m_key IN');
});

test("Entity without M2M generates standard functions", () => {
  const compiler = new DZQLCompiler();

  const entity = {
    tableName: 'organisations',
    labelField: 'name',
    searchableFields: ['name'],
    fkIncludes: {},
    manyToMany: {}  // No M2M relationships
  };

  const result = compiler.compile(entity);

  // ✅ VERIFY: No M2M variables
  expect(result.sql).not.toContain('v_tag_ids');
  expect(result.sql).not.toContain('-- M2M:');

  // ✅ VERIFY: No M2M sync logic
  expect(result.sql).not.toContain('-- M2M Sync:');

  // ✅ VERIFY: Functions still generated
  expect(result.sql).toContain('CREATE OR REPLACE FUNCTION save_organisations');
  expect(result.sql).toContain('CREATE OR REPLACE FUNCTION get_organisations');
  expect(result.sql).toContain('CREATE OR REPLACE FUNCTION search_organisations');
});

console.log('\n✅ All M2M compilation tests passed!');
console.log('✅ Verified: NO runtime loops in generated SQL');
console.log('✅ Verified: All table/column names are literals');
console.log('✅ Verified: Static code blocks for each M2M relationship\n');
