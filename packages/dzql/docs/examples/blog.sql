-- ============================================================================
-- Blog Application Example
-- ============================================================================
--
-- This example demonstrates:
--   - Multiple related entities (users, posts, comments, tags)
--   - Many-to-many relationships (posts <-> tags via post_tags junction)
--   - Soft delete (posts.deleted_at)
--   - FK includes (dereferencing author, post)
--   - Permission paths (author can edit/delete own content)
--   - Notification paths (notify post author when comments added)
--
-- To use this example:
--   1. Create tables first (see CREATE TABLE statements below)
--   2. Run the dzql.register_entity() calls to enable CRUD operations
--   3. Use the generated API: save_posts, get_posts, search_posts, etc.
--
-- For a complete working example with Docker, tests, and frontend:
--   See packages/blog/ in the DZQL repository
--
-- ============================================================================

-- Create tables
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS posts (
  id SERIAL PRIMARY KEY,
  title VARCHAR(500) NOT NULL,
  content TEXT NOT NULL,
  summary TEXT,
  author_id INT REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW(),
  deleted_at TIMESTAMP
);

CREATE TABLE IF NOT EXISTS comments (
  id SERIAL PRIMARY KEY,
  content TEXT NOT NULL,
  post_id INT REFERENCES posts(id),
  author_id INT REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW()
);

-- Tags table for categorizing posts
CREATE TABLE IF NOT EXISTS tags (
  id SERIAL PRIMARY KEY,
  name VARCHAR(50) UNIQUE NOT NULL,
  color VARCHAR(7) DEFAULT '#3788d8'
);

-- Junction table for post-tag many-to-many relationship
CREATE TABLE IF NOT EXISTS post_tags (
  post_id INT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  tag_id INT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (post_id, tag_id)
);

CREATE INDEX IF NOT EXISTS idx_post_tags_post_id ON post_tags(post_id);
CREATE INDEX IF NOT EXISTS idx_post_tags_tag_id ON post_tags(tag_id);

-- ============================================================================
-- DZQL Entity Registrations
-- ============================================================================

-- Users entity - blog authors
select dzql.register_entity(
  'users',
  'name',
  array['name', 'email'],
  '{}',  -- no FK includes
  false, -- hard delete
  '{}',  -- no reverse FK
  '{}',  -- no notifications
  jsonb_build_object(
    'view', array[]::text[],           -- Anyone can view users
    'create', array[]::text[],         -- Anyone can register
    'update', array['@id'],            -- Only update own profile
    'delete', array['@id']             -- Only delete own account
  )
);

-- Register tags entity first
select dzql.register_entity(
  'tags',
  'name',
  array['name'],
  '{}',  -- no FK includes
  false, -- hard delete
  '{}',  -- no temporal
  '{}',  -- no notifications
  jsonb_build_object(
    'view', array[]::text[],           -- Anyone can view tags
    'create', array[]::text[],         -- Anyone can create tags
    'update', array[]::text[],         -- Anyone can update tags
    'delete', array[]::text[]          -- Anyone can delete tags
  )
);

-- Posts entity - blog posts with M2M tags
select dzql.register_entity(
  'posts',
  'title',
  array['title', 'content', 'summary'],
  jsonb_build_object(
    'author', 'users'  -- FK to users
  ),
  true,  -- soft delete (deleted_at)
  '{}',  -- no temporal
  '{}',  -- no notification paths
  jsonb_build_object(
    'view', array[]::text[],           -- Anyone can view posts
    'create', array[]::text[],         -- Anyone can create posts
    'update', array['@author_id'],     -- Only author can update
    'delete', array['@author_id']      -- Only author can delete
  ),
  jsonb_build_object(
    'many_to_many', jsonb_build_object(
      'tags', jsonb_build_object(
        'junction_table', 'post_tags',
        'local_key', 'post_id',
        'foreign_key', 'tag_id',
        'target_entity', 'tags',
        'id_field', 'tag_ids',
        'expand', true  -- Include full tag objects in response
      )
    )
  )  -- graph_rules with M2M
);

-- Comments entity - blog comments
select dzql.register_entity(
  'comments',
  'content',
  array['content'],
  jsonb_build_object(
    'post', 'posts',
    'author', 'users'
  ),
  false, -- hard delete
  '{}',  -- no reverse FK
  jsonb_build_object(
    'post_author', array['@post_id->posts.author_id'],
    'commenters', array['@post_id']
  ),
  jsonb_build_object(
    'view', array[]::text[],           -- Anyone can view comments
    'create', array[]::text[],         -- Anyone can comment
    'update', array['@author_id'],     -- Only author can update
    'delete', array[
      '@author_id',                    -- Author can delete
      '@post_id->posts.author_id'      -- Post author can delete
    ]
  )
);
