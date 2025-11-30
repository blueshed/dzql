import { describe, test, expect, beforeAll } from 'bun:test';

// Set DATABASE_URL before loading db.js (which connects at module load time)
process.env.DATABASE_URL = 'postgresql://dzql:dzql@localhost:5432/dzql_blog';

// Use dynamic import so DATABASE_URL is set before db.js loads
// Note: static imports are hoisted and execute before process.env assignment
const { db } = await import('dzql/db');

describe('Blog Application - DZQL db.api', () => {
  let aliceUserId;
  let bobUserId;

  beforeAll(async () => {
    // Get existing user IDs from seed data - call compiled function directly
    // Use userId=1 (alice) for initial query
    const users = await db.api.search_users(1, {});
    aliceUserId = users.data.find(u => u.email === 'alice@blog.com')?.id;
    bobUserId = users.data.find(u => u.email === 'bob@blog.com')?.id;
  });

  describe('Authentication via db.api', () => {
    test('register_user creates new user without exposing password_hash', async () => {
      const uniqueEmail = `user${Date.now()}@test.com`;
      const profile = await db.api.register_user({
        email: uniqueEmail,
        password: 'testpass123',
        options: { name: 'Test User' }
      });

      expect(profile).toHaveProperty('user_id');
      expect(profile).toHaveProperty('email', uniqueEmail);
      expect(profile).toHaveProperty('name', 'Test User');
      expect(profile).not.toHaveProperty('password_hash');
    });

    test('login_user authenticates with correct password', async () => {
      const profile = await db.api.login_user({
        email: 'alice@blog.com',
        password: 'password123'
      });

      expect(profile).toHaveProperty('user_id', aliceUserId);
      expect(profile).toHaveProperty('email', 'alice@blog.com');
      expect(profile).not.toHaveProperty('password_hash');
    });

    test('login_user rejects incorrect password', async () => {
      await expect(async () => {
        await db.api.login_user({ email: 'alice@blog.com', password: 'wrongpassword' });
      }).toThrow();
    });
  });

  describe('Users CRUD via db.api compiled functions', () => {
    test('get_users returns user without password_hash', async () => {
      const user = await db.api.get_users(aliceUserId, { id: aliceUserId });

      expect(user).toHaveProperty('id', aliceUserId);
      expect(user).toHaveProperty('email', 'alice@blog.com');
      expect(user).not.toHaveProperty('password_hash');
    });

    test('search_users returns users without password_hash', async () => {
      const response = await db.api.search_users(aliceUserId, {});

      expect(response.data).toBeArray();
      expect(response.data.length).toBeGreaterThan(0);
      expect(response.total).toBeGreaterThan(0);

      // Verify no user has password_hash
      response.data.forEach(user => {
        expect(user).not.toHaveProperty('password_hash');
        expect(user).toHaveProperty('id');
        expect(user).toHaveProperty('email');
      });
    });

    test('save_users creates new user', async () => {
      const uniqueEmail = `charlie${Date.now()}@test.com`;
      const userData = { name: 'Charlie', email: uniqueEmail, password_hash: 'dummy' };
      const user = await db.api.save_users(1, { data: userData });

      expect(user).toHaveProperty('id');
      expect(user).toHaveProperty('name', 'Charlie');
      expect(user).toHaveProperty('email', uniqueEmail);
      expect(user).not.toHaveProperty('password_hash');
    });

    test('lookup_users returns value/label pairs', async () => {
      const results = await db.api.lookup_users(aliceUserId, { filter: 'alice' });

      expect(results).toBeArray();
      expect(results.length).toBeGreaterThan(0);
      expect(results[0]).toHaveProperty('value');
      expect(results[0]).toHaveProperty('label');
    });
  });

  describe('Posts CRUD via db.api', () => {
    let postId;

    test('save_posts creates new post', async () => {
      const postData = {
        title: 'My First Post',
        content: 'This is the content of my first post.',
        summary: 'First post summary',
        author_id: aliceUserId
      };
      const post = await db.api.save_posts(aliceUserId, { data: postData });

      expect(post).toHaveProperty('id');
      expect(post).toHaveProperty('title', 'My First Post');
      expect(post).toHaveProperty('author_id', aliceUserId);
      expect(post.deleted_at).toBeNull();

      postId = post.id;
    });

    test('get_posts returns post', async () => {
      const post = await db.api.get_posts(aliceUserId, { id: postId });

      expect(post).toHaveProperty('id', postId);
      expect(post).toHaveProperty('title', 'My First Post');
    });

    test('search_posts finds posts', async () => {
      const response = await db.api.search_posts(aliceUserId, {});

      expect(response.data).toBeArray();
      expect(response.data.length).toBeGreaterThan(0);
      expect(response.total).toBeGreaterThan(0);
    });

    test('delete_posts soft deletes post', async () => {
      const post = await db.api.delete_posts(aliceUserId, { id: postId });

      expect(post.deleted_at).not.toBeNull();
    });
  });

  describe('Comments CRUD via db.api', () => {
    let postId;
    let commentId;

    beforeAll(async () => {
      // Create a post for commenting
      const postData = {
        title: 'Post for Comments',
        content: 'Content',
        author_id: aliceUserId
      };
      const post = await db.api.save_posts(aliceUserId, { data: postData });
      postId = post.id;
    });

    test('save_comments creates new comment', async () => {
      const commentData = {
        content: 'Great post!',
        post_id: postId,
        author_id: bobUserId
      };
      const comment = await db.api.save_comments(bobUserId, { data: commentData });

      expect(comment).toHaveProperty('id');
      expect(comment).toHaveProperty('content', 'Great post!');
      expect(comment).toHaveProperty('post_id', postId);
      expect(comment).toHaveProperty('author_id', bobUserId);

      commentId = comment.id;
    });

    test('get_comments returns comment', async () => {
      const comment = await db.api.get_comments(bobUserId, { id: commentId });

      expect(comment).toHaveProperty('id', commentId);
      expect(comment).toHaveProperty('content', 'Great post!');
    });

    test('search_comments finds comments with filter', async () => {
      const response = await db.api.search_comments(aliceUserId, {
        filters: { post_id: postId }
      });

      expect(response.data).toBeArray();
      expect(response.data.length).toBeGreaterThan(0);
      expect(response.data[0]).toHaveProperty('post_id', postId);
    });
  });
});
