import { test, expect, describe, beforeAll, afterAll } from 'bun:test';
import { TestDatabase } from '../setup/TestDatabase.js';

let db;
let sql;

beforeAll(async () => {
  db = new TestDatabase();
  sql = await db.setup();
});

afterAll(async () => {
  await db.teardown();
});

describe('Atomic Updates - Scope Tables Extraction', () => {
  beforeAll(async () => {
    // Create test subscribable with nested relations
    await sql`
      DELETE FROM dzql.subscribables WHERE name IN ('test_scope', 'test_nested_scope')
    `;
  });

  afterAll(async () => {
    await sql`
      DELETE FROM dzql.subscribables WHERE name IN ('test_scope', 'test_nested_scope')
    `;
  });

  test('extract_scope_tables returns root entity', async () => {
    const result = await sql`
      SELECT dzql.extract_scope_tables('products', '{}'::jsonb) as tables
    `;

    expect(result[0].tables).toContain('products');
    expect(result[0].tables).toHaveLength(1);
  });

  test('extract_scope_tables extracts simple string relations', async () => {
    const result = await sql`
      SELECT dzql.extract_scope_tables(
        'venues',
        '{"org": "organisations"}'::jsonb
      ) as tables
    `;

    expect(result[0].tables).toContain('venues');
    expect(result[0].tables).toContain('organisations');
    expect(result[0].tables).toHaveLength(2);
  });

  test('extract_scope_tables extracts object relations with entity', async () => {
    const result = await sql`
      SELECT dzql.extract_scope_tables(
        'venues',
        '{"sites": {"entity": "sites", "filter": "venue_id=$venue_id"}}'::jsonb
      ) as tables
    `;

    expect(result[0].tables).toContain('venues');
    expect(result[0].tables).toContain('sites');
    expect(result[0].tables).toHaveLength(2);
  });

  test('extract_scope_tables extracts nested relations (include)', async () => {
    const result = await sql`
      SELECT dzql.extract_scope_tables(
        'venues',
        '{
          "sites": {
            "entity": "sites",
            "filter": "venue_id=$venue_id",
            "include": {
              "allocations": "allocations"
            }
          }
        }'::jsonb
      ) as tables
    `;

    expect(result[0].tables).toContain('venues');
    expect(result[0].tables).toContain('sites');
    expect(result[0].tables).toContain('allocations');
    expect(result[0].tables).toHaveLength(3);
  });

  test('extract_scope_tables extracts deeply nested relations', async () => {
    const result = await sql`
      SELECT dzql.extract_scope_tables(
        'products',
        '{
          "faces": {"entity": "product_faces", "filter": "product_id=$id"},
          "parts": {"entity": "product_parts", "filter": "parent_id=$id"},
          "task_templates": {
            "entity": "product_task_templates",
            "filter": "product_id=$id",
            "include": {
              "dependencies": "product_task_template_dependencies"
            }
          }
        }'::jsonb
      ) as tables
    `;

    expect(result[0].tables).toContain('products');
    expect(result[0].tables).toContain('product_faces');
    expect(result[0].tables).toContain('product_parts');
    expect(result[0].tables).toContain('product_task_templates');
    expect(result[0].tables).toContain('product_task_template_dependencies');
    expect(result[0].tables).toHaveLength(5);
  });

  test('register_subscribable auto-populates scope_tables', async () => {
    await sql`
      SELECT dzql.register_subscribable(
        'test_scope',
        '{}'::jsonb,
        '{"venue_id": "int"}'::jsonb,
        'venues',
        '{"org": "organisations", "sites": {"entity": "sites", "filter": "venue_id=$venue_id"}}'::jsonb
      )
    `;

    const result = await sql`
      SELECT scope_tables FROM dzql.subscribables WHERE name = 'test_scope'
    `;

    expect(result[0].scope_tables).toContain('venues');
    expect(result[0].scope_tables).toContain('organisations');
    expect(result[0].scope_tables).toContain('sites');
  });
});

describe('Atomic Updates - Path Mapping', () => {
  // Test the JavaScript-side path mapping (we'll test this via the codegen module)
  // For now, test the concept with manual path building

  test('path mapping for root entity is "."', () => {
    // This tests the concept - actual implementation is in subscribable-codegen.js
    const paths = buildTestPathMapping('venues', {});
    expect(paths['venues']).toBe('.');
  });

  test('path mapping for simple relations', () => {
    const paths = buildTestPathMapping('venues', {
      org: 'organisations',
      sites: { entity: 'sites', filter: 'venue_id=$venue_id' }
    });

    expect(paths['venues']).toBe('.');
    expect(paths['organisations']).toBe('org');
    expect(paths['sites']).toBe('sites');
  });

  test('path mapping for nested relations', () => {
    const paths = buildTestPathMapping('venues', {
      sites: {
        entity: 'sites',
        filter: 'venue_id=$venue_id',
        include: {
          allocations: 'allocations'
        }
      }
    });

    expect(paths['venues']).toBe('.');
    expect(paths['sites']).toBe('sites');
    expect(paths['allocations']).toBe('sites.allocations');
  });
});

describe('Atomic Updates - Client Patching Logic', () => {
  // Test the patching logic that would run on the client

  test('insert adds item to array', () => {
    const localData = {
      venues: { id: 1, name: 'Test Venue' },
      sites: [{ id: 1, name: 'Site A' }]
    };

    applyTestUpdate(localData, 'sites', 'insert', { id: 2 }, { id: 2, name: 'Site B' });

    expect(localData.sites).toHaveLength(2);
    expect(localData.sites[1].name).toBe('Site B');
  });

  test('update modifies existing item in array', () => {
    const localData = {
      venues: { id: 1, name: 'Test Venue' },
      sites: [
        { id: 1, name: 'Site A' },
        { id: 2, name: 'Site B' }
      ]
    };

    applyTestUpdate(localData, 'sites', 'update', { id: 2 }, { id: 2, name: 'Site B Updated' });

    expect(localData.sites).toHaveLength(2);
    expect(localData.sites[1].name).toBe('Site B Updated');
  });

  test('delete removes item from array', () => {
    const localData = {
      venues: { id: 1, name: 'Test Venue' },
      sites: [
        { id: 1, name: 'Site A' },
        { id: 2, name: 'Site B' }
      ]
    };

    applyTestUpdate(localData, 'sites', 'delete', { id: 1 }, null);

    expect(localData.sites).toHaveLength(1);
    expect(localData.sites[0].id).toBe(2);
  });

  test('root update modifies root object', () => {
    const localData = {
      venues: { id: 1, name: 'Test Venue', capacity: 100 }
    };

    // Simulate root entity update
    if (localData.venues) {
      Object.assign(localData.venues, { name: 'Updated Venue' });
    }

    expect(localData.venues.name).toBe('Updated Venue');
    expect(localData.venues.capacity).toBe(100); // Unchanged field preserved
  });

  test('pk matching with composite keys', () => {
    const item = { product_id: 1, part_id: 2, name: 'Part' };
    const pk = { product_id: 1, part_id: 2 };

    expect(testPkMatch(item, pk)).toBe(true);
    expect(testPkMatch(item, { product_id: 1, part_id: 3 })).toBe(false);
  });
});

// Helper functions for testing (these mirror the client-side implementation)

function buildTestPathMapping(rootEntity, relations) {
  const paths = {};
  paths[rootEntity] = '.';

  const buildPaths = (rels, parentPath = '') => {
    for (const [relName, relConfig] of Object.entries(rels || {})) {
      const entity = typeof relConfig === 'string' ? relConfig : relConfig?.entity;
      const currentPath = parentPath ? `${parentPath}.${relName}` : relName;

      if (entity) {
        paths[entity] = currentPath;
      }

      if (typeof relConfig === 'object' && relConfig !== null) {
        if (relConfig.include) {
          buildPaths(relConfig.include, currentPath);
        }
        if (relConfig.relations) {
          buildPaths(relConfig.relations, currentPath);
        }
      }
    }
  };

  buildPaths(relations);
  return paths;
}

function applyTestUpdate(localData, path, op, pk, data) {
  const arr = localData[path];
  if (!Array.isArray(arr)) return;

  if (op === 'insert' && data) {
    arr.push(data);
  } else if (op === 'update' && data && pk) {
    const idx = arr.findIndex(item => testPkMatch(item, pk));
    if (idx !== -1) {
      Object.assign(arr[idx], data);
    }
  } else if (op === 'delete' && pk) {
    const idx = arr.findIndex(item => testPkMatch(item, pk));
    if (idx !== -1) {
      arr.splice(idx, 1);
    }
  }
}

function testPkMatch(item, pk) {
  if (!item || !pk) return false;
  for (const [key, value] of Object.entries(pk)) {
    if (item[key] !== value) return false;
  }
  return true;
}
