/**
 * Graph Rules Tests
 *
 * Tests that graph_rules define cascading actions correctly:
 * - CASCADE DELETE: deleting parent deletes children
 * - SET NULL: deleting parent sets FK to null
 * - RESTRICT: prevent delete if children exist
 * - Cascading updates work as expected
 * - Complex multi-level cascades work
 *
 * Contract: TEST_CONTRACT.md Section 6
 *
 * STATUS: Graph rules are NOT YET IMPLEMENTED in DZQL.
 * The register_entity() function accepts graph_rules parameter but doesn't enforce them.
 * These tests document the expected behavior once implemented.
 */

import { describe, test, expect, beforeAll } from 'bun:test';
import { setupTests, createTestUser, testName } from '../setup/test-helpers.js';

const { sql } = setupTests();

describe('Graph Rules', () => {
  let testUserId;

  beforeAll(async () => {
    // Create parent table
    await sql`DROP TABLE IF EXISTS comments CASCADE`;
    await sql`DROP TABLE IF EXISTS blog_posts CASCADE`;
    await sql`
      CREATE TABLE blog_posts (
        id serial PRIMARY KEY,
        title text NOT NULL,
        author_id int,
        created_at timestamptz DEFAULT now()
      )
    `;

    // Create child table with FK
    await sql`
      CREATE TABLE comments (
        id serial PRIMARY KEY,
        post_id int,
        content text NOT NULL,
        author_id int,
        created_at timestamptz DEFAULT now()
      )
    `;

    // Register parent entity
    await sql`
      SELECT dzql.register_entity(
        'blog_posts',
        'title',
        array['title'],
        '{}',
        false,
        '{}',
        '{}',
        jsonb_build_object(
          'view', array[]::text[],
          'create', array[]::text[],
          'update', array[]::text[],
          'delete', array[]::text[]
        )
      )
    `;

    // Register child entity with CASCADE DELETE graph rule
    await sql`
      SELECT dzql.register_entity(
        'comments',
        'content',
        array['content'],
        '{"post": "blog_posts"}',
        false,
        jsonb_build_object(
          'delete', jsonb_build_object(
            'comments', 'CASCADE'
          )
        ),
        '{}',
        jsonb_build_object(
          'view', array[]::text[],
          'create', array[]::text[],
          'update', array[]::text[],
          'delete', array[]::text[]
        )
      )
    `;

    const user = await createTestUser(sql);
    testUserId = user.user_id;
  });

  test.skip('TODO: CASCADE DELETE - deleting parent deletes children', async () => {
    // NOT IMPLEMENTED: Graph rules CASCADE not enforced
    // Create a blog post
    const post = await sql`
      SELECT dzql.save_blog_posts(${sql.json({
        title: testName('Post'),
        author_id: testUserId
      })}, ${testUserId}) as post
    `;
    const postId = post[0].post.id;

    // Create comments on the post
    const comment1 = await sql`
      SELECT dzql.save_comments(${sql.json({
        post_id: postId,
        content: 'First comment',
        author_id: testUserId
      })}, ${testUserId}) as comment
    `;
    const comment1Id = comment1[0].comment.id;

    const comment2 = await sql`
      SELECT dzql.save_comments(${sql.json({
        post_id: postId,
        content: 'Second comment',
        author_id: testUserId
      })}, ${testUserId}) as comment
    `;
    const comment2Id = comment2[0].comment.id;

    // Delete the blog post
    await sql`
      SELECT dzql.delete_blog_posts(${sql.json({id: postId})}, ${testUserId})
    `;

    // Comments should be deleted (CASCADE)
    const remainingComments = await sql`
      SELECT * FROM comments WHERE id IN (${comment1Id}, ${comment2Id})
    `;
    expect(remainingComments.length).toBe(0);
  });

  test.skip('TODO: Multiple children cascade deleted', async () => {
    // NOT IMPLEMENTED: Graph rules CASCADE not enforced
    // Create post with many comments
    const post = await sql`
      SELECT dzql.save_blog_posts(${sql.json({
        title: testName('MultiComment'),
        author_id: testUserId
      })}, ${testUserId}) as post
    `;
    const postId = post[0].post.id;

    // Create 5 comments
    const commentIds = [];
    for (let i = 0; i < 5; i++) {
      const comment = await sql`
        SELECT dzql.save_comments(${sql.json({
          post_id: postId,
          content: `Comment ${i}`,
          author_id: testUserId
        })}, ${testUserId}) as comment
      `;
      commentIds.push(comment[0].comment.id);
    }

    // Verify comments exist
    const beforeDelete = await sql`
      SELECT COUNT(*) as count FROM comments WHERE post_id = ${postId}
    `;
    expect(Number(beforeDelete[0].count)).toBe(5);

    // Delete post
    await sql`
      SELECT dzql.delete_blog_posts(${sql.json({id: postId})}, ${testUserId})
    `;

    // All comments should be gone
    const afterDelete = await sql`
      SELECT COUNT(*) as count FROM comments WHERE post_id = ${postId}
    `;
    expect(Number(afterDelete[0].count)).toBe(0);
  });

  test.skip('TODO: SET NULL - deleting parent sets FK to null', async () => {
    // NOT IMPLEMENTED: Graph rules SET NULL not enforced
    // Create SET NULL test tables
    await sql`DROP TABLE IF EXISTS optional_refs CASCADE`;
    await sql`DROP TABLE IF EXISTS nullable_parents CASCADE`;
    await sql`
      CREATE TABLE nullable_parents (
        id serial PRIMARY KEY,
        name text NOT NULL
      )
    `;

    await sql`
      CREATE TABLE optional_refs (
        id serial PRIMARY KEY,
        parent_id int,
        label text NOT NULL
      )
    `;

    await sql`
      SELECT dzql.register_entity(
        'nullable_parents',
        'name',
        array['name'],
        '{}',
        false,
        '{}',
        '{}',
        jsonb_build_object(
          'view', array[]::text[],
          'create', array[]::text[],
          'update', array[]::text[],
          'delete', array[]::text[]
        )
      )
    `;

    await sql`
      SELECT dzql.register_entity(
        'optional_refs',
        'label',
        array['label'],
        '{"parent": "nullable_parents"}',
        false,
        jsonb_build_object(
          'delete', jsonb_build_object(
            'optional_refs', 'SET NULL'
          )
        ),
        '{}',
        jsonb_build_object(
          'view', array[]::text[],
          'create', array[]::text[],
          'update', array[]::text[],
          'delete', array[]::text[]
        )
      )
    `;

    // Create parent
    const parent = await sql`
      SELECT dzql.save_nullable_parents(${sql.json({
        name: testName('Parent')
      })}, ${testUserId}) as parent
    `;
    const parentId = parent[0].parent.id;

    // Create child
    const child = await sql`
      SELECT dzql.save_optional_refs(${sql.json({
        parent_id: parentId,
        label: 'Child'
      })}, ${testUserId}) as child
    `;
    const childId = child[0].child.id;

    // Delete parent
    await sql`
      SELECT dzql.delete_nullable_parents(${sql.json({id: parentId})}, ${testUserId})
    `;

    // Child should still exist but parent_id should be NULL
    const updatedChild = await sql`
      SELECT * FROM optional_refs WHERE id = ${childId}
    `;
    expect(updatedChild.length).toBe(1);
    expect(updatedChild[0].parent_id).toBeNull();
  });

  test.skip('TODO: RESTRICT - prevent delete if children exist', async () => {
    // NOT IMPLEMENTED: Graph rules RESTRICT not enforced
    // Create RESTRICT test tables
    await sql`DROP TABLE IF EXISTS protected_children CASCADE`;
    await sql`DROP TABLE IF EXISTS restricted_parents CASCADE`;
    await sql`
      CREATE TABLE restricted_parents (
        id serial PRIMARY KEY,
        name text NOT NULL
      )
    `;

    await sql`
      CREATE TABLE protected_children (
        id serial PRIMARY KEY,
        parent_id int NOT NULL,
        label text NOT NULL
      )
    `;

    await sql`
      SELECT dzql.register_entity(
        'restricted_parents',
        'name',
        array['name'],
        '{}',
        false,
        '{}',
        '{}',
        jsonb_build_object(
          'view', array[]::text[],
          'create', array[]::text[],
          'update', array[]::text[],
          'delete', array[]::text[]
        )
      )
    `;

    await sql`
      SELECT dzql.register_entity(
        'protected_children',
        'label',
        array['label'],
        '{"parent": "restricted_parents"}',
        false,
        jsonb_build_object(
          'delete', jsonb_build_object(
            'protected_children', 'RESTRICT'
          )
        ),
        '{}',
        jsonb_build_object(
          'view', array[]::text[],
          'create', array[]::text[],
          'update', array[]::text[],
          'delete', array[]::text[]
        )
      )
    `;

    // Create parent
    const parent = await sql`
      SELECT dzql.save_restricted_parents(${sql.json({
        name: testName('RestrictParent')
      })}, ${testUserId}) as parent
    `;
    const parentId = parent[0].parent.id;

    // Create child
    await sql`
      SELECT dzql.save_protected_children(${sql.json({
        parent_id: parentId,
        label: 'Child'
      })}, ${testUserId})
    `;

    // Try to delete parent - should fail
    await expect(async () => {
      await sql`
        SELECT dzql.delete_restricted_parents(${sql.json({id: parentId})}, ${testUserId})
      `;
    }).toThrow();

    // Parent should still exist
    const checkParent = await sql`
      SELECT * FROM restricted_parents WHERE id = ${parentId}
    `;
    expect(checkParent.length).toBe(1);
  });

  test('No children - RESTRICT allows delete', async () => {
    // Create parent without children
    const parent = await sql`
      SELECT dzql.save_restricted_parents(${sql.json({
        name: testName('NoChildren')
      })}, ${testUserId}) as parent
    `;
    const parentId = parent[0].parent.id;

    // Delete should succeed (no children)
    await sql`
      SELECT dzql.delete_restricted_parents(${sql.json({id: parentId})}, ${testUserId})
    `;

    // Parent should be deleted
    const checkParent = await sql`
      SELECT * FROM restricted_parents WHERE id = ${parentId}
    `;
    expect(checkParent.length).toBe(0);
  });

  test.skip('TODO: Multi-level CASCADE - grandchildren deleted', async () => {
    // Create 3-level hierarchy: post -> comment -> reply
    // Deleting post should cascade to comments and replies
    // This requires more complex graph rule setup
  });

  test.skip('TODO: Mixed rules - CASCADE and SET NULL in same delete', async () => {
    // One child uses CASCADE, another uses SET NULL
    // Both should work correctly when parent deleted
  });

  test('Graph rules don\'t affect direct deletes', async () => {
    // Create post with comment
    const post = await sql`
      SELECT dzql.save_blog_posts(${sql.json({
        title: testName('DirectDelete'),
        author_id: testUserId
      })}, ${testUserId}) as post
    `;
    const postId = post[0].post.id;

    const comment = await sql`
      SELECT dzql.save_comments(${sql.json({
        post_id: postId,
        content: 'Comment',
        author_id: testUserId
      })}, ${testUserId}) as comment
    `;
    const commentId = comment[0].comment.id;

    // Directly delete the comment (not cascading from parent)
    await sql`
      SELECT dzql.delete_comments(${sql.json({id: commentId})}, ${testUserId})
    `;

    // Comment should be gone
    const checkComment = await sql`
      SELECT * FROM comments WHERE id = ${commentId}
    `;
    expect(checkComment.length).toBe(0);

    // Post should still exist
    const checkPost = await sql`
      SELECT * FROM blog_posts WHERE id = ${postId}
    `;
    expect(checkPost.length).toBe(1);
  });

  test.skip('TODO: CASCADE creates delete events for children', async () => {
    // NOT IMPLEMENTED: Graph rules CASCADE not enforced
    // Clear events
    await sql`DELETE FROM dzql.events WHERE table_name IN ('blog_posts', 'comments')`;

    // Create post with comment
    const post = await sql`
      SELECT dzql.save_blog_posts(${sql.json({
        title: testName('EventTest'),
        author_id: testUserId
      })}, ${testUserId}) as post
    `;
    const postId = post[0].post.id;

    const comment = await sql`
      SELECT dzql.save_comments(${sql.json({
        post_id: postId,
        content: 'Comment for events',
        author_id: testUserId
      })}, ${testUserId}) as comment
    `;
    const commentId = comment[0].comment.id;

    // Delete post (should cascade to comment)
    await sql`
      SELECT dzql.delete_blog_posts(${sql.json({id: postId})}, ${testUserId})
    `;

    // Check delete events
    const postEvents = await sql`
      SELECT * FROM dzql.events
      WHERE table_name = 'blog_posts'
      AND pk->>'id' = ${postId.toString()}
      AND op = 'delete'
    `;
    expect(postEvents.length).toBeGreaterThan(0);

    const commentEvents = await sql`
      SELECT * FROM dzql.events
      WHERE table_name = 'comments'
      AND pk->>'id' = ${commentId.toString()}
      AND op = 'delete'
    `;
    expect(commentEvents.length).toBeGreaterThan(0);
  });
});
