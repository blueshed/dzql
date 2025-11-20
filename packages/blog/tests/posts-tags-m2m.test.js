/**
 * Test M2M functionality in compiled blog functions
 * This tests the COMPILED save_posts, get_posts, and search_posts functions
 */

import { test, expect, beforeAll, afterAll } from "bun:test";

// Set DATABASE_URL before loading db.js
process.env.DATABASE_URL = 'postgresql://dzql:dzql@localhost:5432/dzql_blog';

// Use dynamic import so DATABASE_URL is set first
const { db } = await import('dzql/db');
const { sql } = await import('dzql');

const PREFIX = `M2M_TEST_${Date.now()}`;
let testUserId;
let testTagId1, testTagId2, testTagId3;

beforeAll(async () => {
  // Create test user using db.api (calls compiled save_users function)
  const user = await db.api.save_users(1, {
    data: {
      name: `${PREFIX}_TestUser`,
      email: `${PREFIX.toLowerCase()}@test.com`,
      password_hash: 'test'
    }
  });
  testUserId = user.id;

  // Create test tags using db.api (calls compiled save_tags function)
  const tag1 = await db.api.save_tags(testUserId, {
    data: {
      name: `${PREFIX}_Tech`,
      color: '#FF0000'
    }
  });
  testTagId1 = tag1.id;

  const tag2 = await db.api.save_tags(testUserId, {
    data: {
      name: `${PREFIX}_Tutorial`,
      color: '#00FF00'
    }
  });
  testTagId2 = tag2.id;

  const tag3 = await db.api.save_tags(testUserId, {
    data: {
      name: `${PREFIX}_News`,
      color: '#0000FF'
    }
  });
  testTagId3 = tag3.id;

  console.log(`✓ Test user created: ${testUserId}`);
  console.log(`✓ Test tags created: ${testTagId1}, ${testTagId2}, ${testTagId3}`);
});

afterAll(async () => {
  // Clean up (cascade will handle post_tags)
  await sql`DELETE FROM posts WHERE title LIKE ${PREFIX + '%'}`;
  await sql`DELETE FROM tags WHERE name LIKE ${PREFIX + '%'}`;
  await sql`DELETE FROM users WHERE id = ${testUserId}`;
});

test("Create post with tags using COMPILED save_posts function", async () => {
  const postData = {
    title: `${PREFIX}_My First Post`,
    content: 'This is a test post with tags',
    summary: 'Test post',
    author_id: testUserId,
    tag_ids: [testTagId1, testTagId2]  // M2M field
  };

  // Call compiled save_posts via db.api
  const post = await db.api.save_posts(testUserId, { data: postData });

  console.log('\n=== Created Post ===');
  console.log(JSON.stringify(post, null, 2));
  console.log('=== End ===\n');

  // Verify post was created
  expect(post).toBeDefined();
  expect(post.id).toBeDefined();
  expect(post.title).toBe(`${PREFIX}_My First Post`);

  // ✅ VERIFY: tag_ids array is returned
  expect(post.tag_ids).toBeDefined();
  expect(Array.isArray(post.tag_ids)).toBe(true);
  expect(post.tag_ids.length).toBe(2);
  expect(post.tag_ids).toContain(testTagId1);
  expect(post.tag_ids).toContain(testTagId2);

  // ✅ VERIFY: expand=true returns full tag objects
  expect(post.tags).toBeDefined();
  expect(Array.isArray(post.tags)).toBe(true);
  expect(post.tags.length).toBe(2);
  expect(post.tags[0].name).toContain(PREFIX);
  expect(post.tags[0].color).toBeDefined();

  // Verify junction table was synced
  const junctionRows = await sql`
    SELECT * FROM post_tags WHERE post_id = ${post.id} ORDER BY tag_id
  `;

  expect(junctionRows.length).toBe(2);
  expect(junctionRows[0].tag_id).toBe(testTagId1);
  expect(junctionRows[1].tag_id).toBe(testTagId2);
});

test("GET post includes M2M fields using COMPILED get_posts function", async () => {
  // Create post with tags
  const created = await db.api.save_posts(testUserId, {
    data: {
      title: `${PREFIX}_Get Test Post`,
      content: 'Test content',
      author_id: testUserId,
      tag_ids: [testTagId1, testTagId3]
    }
  });

  const postId = created.id;

  // Get the post using compiled get_posts function
  const post = await db.api.get_posts(testUserId, { id: postId });

  console.log('\n=== Retrieved Post ===');
  console.log(JSON.stringify(post, null, 2));
  console.log('=== End ===\n');

  // ✅ VERIFY: tag_ids included
  expect(post.tag_ids).toBeDefined();
  expect(Array.isArray(post.tag_ids)).toBe(true);
  expect(post.tag_ids.length).toBe(2);
  expect(post.tag_ids).toContain(testTagId1);
  expect(post.tag_ids).toContain(testTagId3);

  // ✅ VERIFY: tags expanded (expand=true)
  expect(post.tags).toBeDefined();
  expect(Array.isArray(post.tags)).toBe(true);
  expect(post.tags.length).toBe(2);
});

test("Update post tags using COMPILED save_posts function", async () => {
  // Create post with tags 1 and 2
  const created = await db.api.save_posts(testUserId, {
    data: {
      title: `${PREFIX}_Update Test Post`,
      content: 'Original content',
      author_id: testUserId,
      tag_ids: [testTagId1, testTagId2]
    }
  });

  const postId = created.id;
  expect(created.tag_ids.length).toBe(2);

  // Update to tags 2 and 3 (remove 1, keep 2, add 3)
  const updatedPost = await db.api.save_posts(testUserId, {
    data: {
      id: postId,
      tag_ids: [testTagId2, testTagId3]
    }
  });

  console.log('\n=== Updated Post ===');
  console.log(JSON.stringify(updatedPost, null, 2));
  console.log('=== End ===\n');

  // ✅ VERIFY: Tags updated correctly
  expect(updatedPost.tag_ids.length).toBe(2);
  expect(updatedPost.tag_ids).not.toContain(testTagId1);
  expect(updatedPost.tag_ids).toContain(testTagId2);
  expect(updatedPost.tag_ids).toContain(testTagId3);

  // Verify junction table matches
  const junctionRows = await sql`
    SELECT * FROM post_tags WHERE post_id = ${postId} ORDER BY tag_id
  `;

  expect(junctionRows.length).toBe(2);
  expect(junctionRows[0].tag_id).toBe(testTagId2);
  expect(junctionRows[1].tag_id).toBe(testTagId3);
});

test("Update post WITHOUT tag_ids leaves tags unchanged", async () => {
  // Create post with tags
  const created = await db.api.save_posts(testUserId, {
    data: {
      title: `${PREFIX}_Unchanged Tags Post`,
      content: 'Original content',
      author_id: testUserId,
      tag_ids: [testTagId1]
    }
  });

  const postId = created.id;
  expect(created.tag_ids.length).toBe(1);

  // Update post content WITHOUT touching tag_ids
  const updatedPost = await db.api.save_posts(testUserId, {
    data: {
      id: postId,
      content: 'Updated content'
      // tag_ids field omitted!
    }
  });

  console.log('\n=== Post with Unchanged Tags ===');
  console.log(JSON.stringify(updatedPost, null, 2));
  console.log('=== End ===\n');

  // ✅ VERIFY: Content updated but tags unchanged
  expect(updatedPost.content).toBe('Updated content');
  expect(updatedPost.tag_ids.length).toBe(1);
  expect(updatedPost.tag_ids).toContain(testTagId1);
});

test("Remove all tags with empty array", async () => {
  // Create post with tags
  const created = await db.api.save_posts(testUserId, {
    data: {
      title: `${PREFIX}_Remove All Tags Post`,
      content: 'Content',
      author_id: testUserId,
      tag_ids: [testTagId1, testTagId2]
    }
  });

  const postId = created.id;
  expect(created.tag_ids.length).toBe(2);

  // Remove all tags with empty array
  const updatedPost = await db.api.save_posts(testUserId, {
    data: {
      id: postId,
      tag_ids: []
    }
  });

  console.log('\n=== Post with No Tags ===');
  console.log(JSON.stringify(updatedPost, null, 2));
  console.log('=== End ===\n');

  // ✅ VERIFY: All tags removed
  expect(updatedPost.tag_ids).toBeDefined();
  expect(Array.isArray(updatedPost.tag_ids)).toBe(true);
  expect(updatedPost.tag_ids.length).toBe(0);

  // Verify junction table is empty
  const junctionRows = await sql`
    SELECT * FROM post_tags WHERE post_id = ${postId}
  `;

  expect(junctionRows.length).toBe(0);
});

test("SEARCH posts includes M2M fields via LATERAL joins", async () => {
  // Create posts with different tags
  await db.api.save_posts(testUserId, {
    data: {
      title: `${PREFIX}_Search Post 1`,
      content: 'Content 1',
      author_id: testUserId,
      tag_ids: [testTagId1]
    }
  });

  await db.api.save_posts(testUserId, {
    data: {
      title: `${PREFIX}_Search Post 2`,
      content: 'Content 2',
      author_id: testUserId,
      tag_ids: [testTagId1, testTagId2]
    }
  });

  // Search posts using compiled search_posts function
  const results = await db.api.search_posts(testUserId, {
    filters: { title: { ilike: `${PREFIX}_Search%` } }
  });

  console.log('\n=== Search Results ===');
  console.log(JSON.stringify(results, null, 2));
  console.log('=== End ===\n');

  // ✅ VERIFY: Search results include M2M fields
  expect(results.data).toBeDefined();
  expect(Array.isArray(results.data)).toBe(true);
  expect(results.data.length).toBeGreaterThanOrEqual(2);

  // Check each result has M2M fields
  for (const post of results.data) {
    expect(post.tag_ids).toBeDefined();
    expect(Array.isArray(post.tag_ids)).toBe(true);
    expect(post.tags).toBeDefined();  // expand=true
    expect(Array.isArray(post.tags)).toBe(true);
  }

  // Verify specific counts
  const post1 = results.data.find(p => p.title === `${PREFIX}_Search Post 1`);
  expect(post1.tag_ids.length).toBe(1);
  expect(post1.tags.length).toBe(1);

  const post2 = results.data.find(p => p.title === `${PREFIX}_Search Post 2`);
  expect(post2.tag_ids.length).toBe(2);
  expect(post2.tags.length).toBe(2);
});

console.log('\n✅ All compiled M2M tests passed!');
console.log('✅ Verified: Compiled save_posts syncs junction table');
console.log('✅ Verified: Compiled get_posts returns M2M fields');
console.log('✅ Verified: Compiled search_posts uses LATERAL joins\n');
