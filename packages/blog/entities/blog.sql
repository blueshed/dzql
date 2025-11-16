-- ============================================================================
-- Blog Application Entity Definitions
-- Tables and DZQL entity registrations
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

-- Seed data will be added after auth functions are loaded
-- See init_db/003_seed.sql for user registration

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

-- Posts entity - blog posts
select dzql.register_entity(
  'posts',
  'title',
  array['title', 'content', 'summary'],
  jsonb_build_object(
    'author', 'users'  -- FK to users
  ),
  true,  -- soft delete (deleted_at)
  '{}',  -- no reverse FK
  '{}',  -- no notification paths (removed follows reference)
  jsonb_build_object(
    'view', array[]::text[],           -- Anyone can view posts
    'create', array[]::text[],         -- Anyone can create posts
    'update', array['@author_id'],     -- Only author can update
    'delete', array['@author_id']      -- Only author can delete
  )
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
