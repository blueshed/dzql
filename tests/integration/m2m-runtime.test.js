/**
 * Many-to-Many Runtime Tests (Interpreted/Generic Mode)
 *
 * Tests that M2M relationships actually work at runtime:
 * - Junction tables are synced correctly
 * - IDs are returned in results
 * - Full objects are expanded when configured
 * - Events include M2M data
 * - Partial updates work correctly
 *
 * Contract: https://github.com/dzql TEST_CONTRACT.md Section 4
 */

import { describe, test, expect, beforeAll } from 'bun:test';
import { setupTests, createTestUser } from '../setup/test-helpers.js';

const { sql } = setupTests();

describe('M2M Runtime (Generic Mode)', () => {
  let testUserId;

  beforeAll(async () => {
    // Drop and recreate schema for clean M2M testing
    await sql`DROP TABLE IF EXISTS post_tags CASCADE`;
    await sql`DROP TABLE IF EXISTS posts CASCADE`;
    await sql`DROP TABLE IF EXISTS tags CASCADE`;

    await sql`
      CREATE TABLE IF NOT EXISTS users (
        id serial PRIMARY KEY,
        name text NOT NULL,
        email text UNIQUE NOT NULL,
        password_hash text NOT NULL
      )
    `;

    await sql`
      CREATE TABLE tags (
        id serial PRIMARY KEY,
        name text UNIQUE NOT NULL
      )
    `;

    await sql`
      CREATE TABLE posts (
        id serial PRIMARY KEY,
        title text NOT NULL,
        content text,  -- Nullable
        author_id int REFERENCES users(id),
        created_at timestamptz DEFAULT now()
      )
    `;

    await sql`
      CREATE TABLE post_tags (
        post_id int REFERENCES posts(id) ON DELETE CASCADE,
        tag_id int REFERENCES tags(id) ON DELETE CASCADE,
        PRIMARY KEY (post_id, tag_id)
      )
    `;

    // Register entity with M2M
    await sql`
      SELECT dzql.register_entity(
        'posts',
        'title',
        array['title', 'content'],
        '{"author": "users"}',
        false,
        '{}',
        '{}',
        jsonb_build_object('view', array[]::text[], 'create', array[]::text[], 'update', array[]::text[], 'delete', array[]::text[]),
        jsonb_build_object(
          'many_to_many', jsonb_build_object(
            'tags', jsonb_build_object(
              'junction_table', 'post_tags',
              'local_key', 'post_id',
              'foreign_key', 'tag_id',
              'target_entity', 'tags',
              'id_field', 'tag_ids',
              'expand', true
            )
          )
        )
      )
    `;

    // Create test data
    const user = await createTestUser(sql);
    testUserId = user.user_id;

    await sql`INSERT INTO tags (name) VALUES ('javascript'), ('typescript'), ('python'), ('rust') ON CONFLICT (name) DO NOTHING`;
  });

  test('CREATE with tag_ids syncs junction table', async () => {
    const postData = {
      title: 'Test Post',
      content: 'Content here',
      author_id: testUserId,
      tag_ids: [1, 2] // javascript, typescript
    };

    const result = await sql`
      SELECT dzql.save_posts(${sql.json(postData)}, ${testUserId}) as post
    `;
    const post = result[0].post;

    expect(post.id).toBeDefined();
    expect(post.tag_ids).toEqual([1, 2]);

    // Verify junction table was actually synced
    const junctionRows = await sql`
      SELECT tag_id FROM post_tags WHERE post_id = ${post.id} ORDER BY tag_id
    `;
    expect(junctionRows.map(r => r.tag_id)).toEqual([1, 2]);
  });

  test('UPDATE tag_ids adds and removes relationships atomically', async () => {
    // Create post with tags [1, 2]
    const created = await sql`
      SELECT dzql.save_posts(${sql.json({title: 'Update Test', author_id: testUserId, tag_ids: [1, 2]})}, ${testUserId}) as post
    `;
    const postId = created[0].post.id;

    // Update to [2, 3] - keep 2, remove 1, add 3
    const updated = await sql`
      SELECT dzql.save_posts(${sql.json({id: postId, tag_ids: [2, 3]})}, ${testUserId}) as post
    `;
    const post = updated[0].post;

    expect(post.tag_ids).toEqual([2, 3]);

    // Verify junction table reflects the change
    const junctionRows = await sql`
      SELECT tag_id FROM post_tags WHERE post_id = ${postId} ORDER BY tag_id
    `;
    expect(junctionRows.map(r => r.tag_id)).toEqual([2, 3]);
  });

  test('Empty array [] removes all relationships', async () => {
    // Create post with tags
    const created = await sql`
      SELECT dzql.save_posts(${sql.json({title: 'Clear Test', author_id: testUserId, tag_ids: [1, 2, 3]})}, ${testUserId}) as post
    `;
    const postId = created[0].post.id;

    // Update with empty array
    const updated = await sql`
      SELECT dzql.save_posts(${sql.json({id: postId, tag_ids: []})}, ${testUserId}) as post
    `;
    const post = updated[0].post;

    expect(post.tag_ids).toEqual([]);

    // Verify junction table is empty
    const junctionRows = await sql`
      SELECT tag_id FROM post_tags WHERE post_id = ${postId}
    `;
    expect(junctionRows.length).toBe(0);
  });

  test('Omitting tag_ids leaves relationships unchanged', async () => {
    // Create post with tags
    const created = await sql`
      SELECT dzql.save_posts(${sql.json({title: 'Omit Test', author_id: testUserId, tag_ids: [1, 2]})}, ${testUserId}) as post
    `;
    const postId = created[0].post.id;

    // Update title without mentioning tag_ids
    const updated = await sql`
      SELECT dzql.save_posts(${sql.json({id: postId, title: 'Updated Title'})}, ${testUserId}) as post
    `;
    const post = updated[0].post;

    expect(post.title).toBe('Updated Title');
    expect(post.tag_ids).toEqual([1, 2]); // Should be unchanged

    // Verify junction table still has original tags
    const junctionRows = await sql`
      SELECT tag_id FROM post_tags WHERE post_id = ${postId} ORDER BY tag_id
    `;
    expect(junctionRows.map(r => r.tag_id)).toEqual([1, 2]);
  });

  test('expand=true includes full tag objects', async () => {
    const created = await sql`
      SELECT dzql.save_posts(${sql.json({title: 'Expand Test', author_id: testUserId, tag_ids: [1, 2]})}, ${testUserId}) as post
    `;
    const post = created[0].post;

    // Should include both tag_ids and expanded tags
    expect(post.tag_ids).toEqual([1, 2]);
    expect(post.tags).toBeArray();
    expect(post.tags.length).toBe(2);
    expect(post.tags[0]).toHaveProperty('id');
    expect(post.tags[0]).toHaveProperty('name');
    expect(['javascript', 'typescript']).toContain(post.tags[0].name);
  });

  test('GET returns M2M data', async () => {
    const created = await sql`
      SELECT dzql.save_posts(${sql.json({title: 'GET Test', author_id: testUserId, tag_ids: [1, 3]})}, ${testUserId}) as post
    `;
    const postId = created[0].post.id;

    const fetched = await sql`
      SELECT dzql.get_posts(${sql.json({id: postId})}, ${testUserId}) as post
    `;
    const post = fetched[0].post;

    expect(post.tag_ids).toEqual([1, 3]);
    expect(post.tags).toBeArray();
    expect(post.tags.length).toBe(2);
  });

  test('SEARCH returns M2M data for all results', async () => {
    // Create posts with different tags
    await sql`SELECT dzql.save_posts(${sql.json({title: 'Search 1', author_id: testUserId, tag_ids: [1]})}, ${testUserId})`;
    await sql`SELECT dzql.save_posts(${sql.json({title: 'Search 2', author_id: testUserId, tag_ids: [1, 2]})}, ${testUserId})`;

    const results = await sql`
      SELECT dzql.search_posts(${sql.json({limit: 10})}, ${testUserId}) as result
    `;
    const searchData = results[0].result;

    expect(searchData.data).toBeArray();
    expect(searchData.data.length).toBeGreaterThan(0);

    // Every result should have tag_ids
    searchData.data.forEach(post => {
      expect(post).toHaveProperty('tag_ids');
      expect(Array.isArray(post.tag_ids)).toBe(true);
    });
  });

  test('Events include M2M data in after field', async () => {
    const created = await sql`
      SELECT dzql.save_posts(${sql.json({title: 'Event Test', author_id: testUserId, tag_ids: [1, 2]})}, ${testUserId}) as post
    `;
    const postId = created[0].post.id;

    // Check event was created with M2M data
    const events = await sql`
      SELECT * FROM dzql.events
      WHERE table_name = 'posts'
      AND pk->>'id' = ${postId.toString()}
      AND op = 'insert'
      ORDER BY event_id DESC
      LIMIT 1
    `;

    expect(events.length).toBe(1);
    expect(events[0].after).toBeDefined();
    expect(events[0].after.tag_ids).toEqual([1, 2]);
    expect(events[0].after.tags).toBeArray();
    expect(events[0].after.tags.length).toBe(2);
  });

  test.skip('TODO: Update events include M2M before/after state', async () => {
    // KNOWN BUG: l_existing_record in generic_save doesn't expand M2M
    // Need to add M2M expansion for l_existing_record before creating event
    const created = await sql`
      SELECT dzql.save_posts(${sql.json({title: 'Update Event Test', author_id: testUserId, tag_ids: [1, 2]})}, ${testUserId}) as post
    `;
    const postId = created[0].post.id;

    // Update tags
    await sql`
      SELECT dzql.save_posts(${sql.json({id: postId, tag_ids: [2, 3]})}, ${testUserId}) as post
    `;

    // Check update event
    const events = await sql`
      SELECT * FROM dzql.events
      WHERE table_name = 'posts'
      AND pk->>'id' = ${postId.toString()}
      AND op = 'update'
      ORDER BY event_id DESC
      LIMIT 1
    `;

    expect(events.length).toBe(1);
    expect(events[0].before.tag_ids).toEqual([1, 2]);
    expect(events[0].after.tag_ids).toEqual([2, 3]);
  });
});
