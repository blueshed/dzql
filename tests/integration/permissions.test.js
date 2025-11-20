/**
 * Permission Enforcement Tests (Row-Level Security)
 *
 * Tests that permissions are actually enforced at runtime:
 * - View permissions block unauthorized reads
 * - Create permissions block unauthorized inserts
 * - Update permissions block unauthorized modifications
 * - Delete permissions block unauthorized deletions
 * - Permission paths resolve correctly (@id, @owner_id, etc)
 *
 * Contract: TEST_CONTRACT.md Section 7
 */

import { describe, test, expect, beforeAll } from 'bun:test';
import { setupTests, createTestUser, testName } from '../setup/test-helpers.js';

const { sql } = setupTests();

describe('Permission Enforcement (Generic Mode)', () => {
  let aliceUserId;
  let bobUserId;

  beforeAll(async () => {
    // Create schema
    await sql`DROP TABLE IF EXISTS private_docs CASCADE`;
    await sql`
      CREATE TABLE private_docs (
        id serial PRIMARY KEY,
        title text NOT NULL,
        content text,
        owner_id int NOT NULL,
        created_at timestamptz DEFAULT now()
      )
    `;

    // Register entity with strict permissions
    await sql`
      SELECT dzql.register_entity(
        'private_docs',
        'title',
        array['title', 'content'],
        '{}',
        false,
        '{}',
        '{}',
        jsonb_build_object(
          'view', array['@owner_id'],      -- Only owner can view
          'create', array[]::text[],       -- Anyone can create
          'update', array['@owner_id'],    -- Only owner can update
          'delete', array['@owner_id']     -- Only owner can delete
        )
      )
    `;

    // Create test users
    const alice = await createTestUser(sql);
    const bob = await createTestUser(sql);
    aliceUserId = alice.user_id;
    bobUserId = bob.user_id;
  });

  test('CREATE permission - anyone can create', async () => {
    const doc = await sql`
      SELECT dzql.save_private_docs(${sql.json({
        title: testName('AliceDoc'),
        content: 'Alice content',
        owner_id: aliceUserId
      })}, ${aliceUserId}) as doc
    `;

    expect(doc[0].doc.id).toBeDefined();
    expect(doc[0].doc.owner_id).toBe(aliceUserId);
  });

  test('VIEW permission - owner can view their own doc', async () => {
    const created = await sql`
      SELECT dzql.save_private_docs(${sql.json({
        title: testName('ViewTest'),
        content: 'Test content',
        owner_id: aliceUserId
      })}, ${aliceUserId}) as doc
    `;
    const docId = created[0].doc.id;

    const fetched = await sql`
      SELECT dzql.get_private_docs(${sql.json({id: docId})}, ${aliceUserId}) as doc
    `;

    expect(fetched[0].doc.id).toBe(docId);
    expect(fetched[0].doc.title).toBeDefined();
  });

  test('VIEW permission - non-owner CANNOT view', async () => {
    const created = await sql`
      SELECT dzql.save_private_docs(${sql.json({
        title: testName('PrivateDoc'),
        content: 'Secret content',
        owner_id: aliceUserId
      })}, ${aliceUserId}) as doc
    `;
    const docId = created[0].doc.id;

    // Bob tries to view Alice's doc
    await expect(async () => {
      await sql`
        SELECT dzql.get_private_docs(${sql.json({id: docId})}, ${bobUserId}) as doc
      `;
    }).toThrow(/Permission denied/);
  });

  test('UPDATE permission - owner can update their own doc', async () => {
    const created = await sql`
      SELECT dzql.save_private_docs(${sql.json({
        title: testName('UpdateTest'),
        content: 'Original content',
        owner_id: aliceUserId
      })}, ${aliceUserId}) as doc
    `;
    const docId = created[0].doc.id;

    const updated = await sql`
      SELECT dzql.save_private_docs(${sql.json({
        id: docId,
        title: 'Updated Title'
      })}, ${aliceUserId}) as doc
    `;

    expect(updated[0].doc.title).toBe('Updated Title');
  });

  test('UPDATE permission - non-owner CANNOT update', async () => {
    const created = await sql`
      SELECT dzql.save_private_docs(${sql.json({
        title: testName('UpdateBlock'),
        content: 'Original content',
        owner_id: aliceUserId
      })}, ${aliceUserId}) as doc
    `;
    const docId = created[0].doc.id;

    // Bob tries to update Alice's doc
    await expect(async () => {
      await sql`
        SELECT dzql.save_private_docs(${sql.json({
          id: docId,
          title: 'Hacked Title'
        })}, ${bobUserId}) as doc
      `;
    }).toThrow(/Permission denied/);
  });

  test('DELETE permission - owner can delete their own doc', async () => {
    const created = await sql`
      SELECT dzql.save_private_docs(${sql.json({
        title: testName('DeleteTest'),
        content: 'To be deleted',
        owner_id: aliceUserId
      })}, ${aliceUserId}) as doc
    `;
    const docId = created[0].doc.id;

    const deleted = await sql`
      SELECT dzql.delete_private_docs(${sql.json({id: docId})}, ${aliceUserId}) as result
    `;

    expect(deleted[0].result).toBeDefined();

    // Verify it's gone
    const check = await sql`
      SELECT * FROM private_docs WHERE id = ${docId}
    `;
    expect(check.length).toBe(0);
  });

  test('DELETE permission - non-owner CANNOT delete', async () => {
    const created = await sql`
      SELECT dzql.save_private_docs(${sql.json({
        title: testName('DeleteBlock'),
        content: 'Protected content',
        owner_id: aliceUserId
      })}, ${aliceUserId}) as doc
    `;
    const docId = created[0].doc.id;

    // Bob tries to delete Alice's doc
    await expect(async () => {
      await sql`
        SELECT dzql.delete_private_docs(${sql.json({id: docId})}, ${bobUserId}) as result
      `;
    }).toThrow(/Permission denied/);
  });

  test('SEARCH respects view permissions - only returns owned docs', async () => {
    // Create multiple docs with different owners
    await sql`
      SELECT dzql.save_private_docs(${sql.json({
        title: testName('Alice1'),
        content: 'Alice content',
        owner_id: aliceUserId
      })}, ${aliceUserId})
    `;
    await sql`
      SELECT dzql.save_private_docs(${sql.json({
        title: testName('Alice2'),
        content: 'Alice content',
        owner_id: aliceUserId
      })}, ${aliceUserId})
    `;
    await sql`
      SELECT dzql.save_private_docs(${sql.json({
        title: testName('Bob1'),
        content: 'Bob content',
        owner_id: bobUserId
      })}, ${bobUserId})
    `;

    // Alice searches - should only see her docs
    const aliceSearch = await sql`
      SELECT dzql.search_private_docs(${sql.json({})}, ${aliceUserId}) as result
    `;

    const aliceDocs = aliceSearch[0].result.data;
    expect(aliceDocs).toBeArray();
    // All returned docs should belong to Alice
    aliceDocs.forEach(doc => {
      expect(doc.owner_id).toBe(aliceUserId);
    });

    // Bob searches - should only see his docs
    const bobSearch = await sql`
      SELECT dzql.search_private_docs(${sql.json({})}, ${bobUserId}) as result
    `;

    const bobDocs = bobSearch[0].result.data;
    expect(bobDocs).toBeArray();
    // All returned docs should belong to Bob
    bobDocs.forEach(doc => {
      expect(doc.owner_id).toBe(bobUserId);
    });
  });

  test('Public view permissions - empty array allows anyone', async () => {
    // Create public docs table
    await sql`DROP TABLE IF EXISTS public_docs CASCADE`;
    await sql`
      CREATE TABLE public_docs (
        id serial PRIMARY KEY,
        title text NOT NULL,
        author_id int NOT NULL
      )
    `;

    await sql`
      SELECT dzql.register_entity(
        'public_docs',
        'title',
        array['title'],
        '{}',
        false,
        '{}',
        '{}',
        jsonb_build_object(
          'view', array[]::text[],        -- Anyone can view
          'create', array[]::text[],      -- Anyone can create
          'update', array['@author_id'],  -- Only author can update
          'delete', array['@author_id']   -- Only author can delete
        )
      )
    `;

    // Alice creates a doc
    const created = await sql`
      SELECT dzql.save_public_docs(${sql.json({
        title: testName('PublicDoc'),
        author_id: aliceUserId
      })}, ${aliceUserId}) as doc
    `;
    const docId = created[0].doc.id;

    // Bob can view it (public read)
    const fetched = await sql`
      SELECT dzql.get_public_docs(${sql.json({id: docId})}, ${bobUserId}) as doc
    `;
    expect(fetched[0].doc.id).toBe(docId);

    // But Bob still can't update it (author-only)
    await expect(async () => {
      await sql`
        SELECT dzql.save_public_docs(${sql.json({
          id: docId,
          title: 'Hacked'
        })}, ${bobUserId}) as doc
      `;
    }).toThrow(/Permission denied/);
  });
});
