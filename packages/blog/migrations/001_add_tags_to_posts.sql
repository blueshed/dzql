-- ============================================================================
-- Migration 001: Add Tags to Posts (M2M)
-- Generated: 2025-11-20
--
-- This migration adds tag support to posts with many-to-many relationships
-- using the DZQL compiler's M2M support.
-- ============================================================================

BEGIN;

-- Part 1: Create new tables
CREATE TABLE IF NOT EXISTS tags (
  id SERIAL PRIMARY KEY,
  name VARCHAR(50) UNIQUE NOT NULL,
  color VARCHAR(7) DEFAULT '#3788d8'
);

CREATE TABLE IF NOT EXISTS post_tags (
  post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (post_id, tag_id)
);

CREATE INDEX IF NOT EXISTS idx_post_tags_post_id ON post_tags(post_id);
CREATE INDEX IF NOT EXISTS idx_post_tags_tag_id ON post_tags(tag_id);

-- Part 2: Insert sample tags
INSERT INTO tags (name, color) VALUES
  ('Tech', '#3B82F6'),
  ('Tutorial', '#10B981'),
  ('News', '#EF4444'),
  ('Opinion', '#8B5CF6')
ON CONFLICT (name) DO NOTHING;

-- Part 3: Drop old posts functions
DROP FUNCTION IF EXISTS can_view_posts(INT, JSONB);
DROP FUNCTION IF EXISTS can_create_posts(INT, JSONB);
DROP FUNCTION IF EXISTS can_update_posts(INT, JSONB);
DROP FUNCTION IF EXISTS can_delete_posts(INT, JSONB);
DROP FUNCTION IF EXISTS get_posts(INT, INT, TIMESTAMPTZ);
DROP FUNCTION IF EXISTS save_posts(INT, JSONB);
DROP FUNCTION IF EXISTS delete_posts(INT, INT);
DROP FUNCTION IF EXISTS lookup_posts(INT, TEXT, INT);
DROP FUNCTION IF EXISTS search_posts(INT, JSONB, TEXT, JSONB, INT, INT);

-- Part 4: Install updated posts functions with M2M support
-- (Compiled from entities/blog.sql with M2M configuration)
--
-- To generate this section:
-- 1. Update entities/blog.sql to add M2M config to posts
-- 2. Run: bun run compile
-- 3. Copy the content from init_db/posts.sql
-- 4. Paste below (excluding permission functions if they haven't changed)
--
-- For this example, see: init_db/posts.sql

-- Part 5: Install tags entity functions
-- (Copy from init_db/tags.sql)

COMMIT;

-- ============================================================================
-- Migration Applied Successfully
-- ============================================================================
-- The posts entity now supports M2M tags:
--
-- Usage:
--   await api.save_posts({
--     data: {
--       title: "My Post",
--       content: "Content",
--       tag_ids: [1, 2, 3]  // Tags synced atomically!
--     }
--   })
--
-- Response includes:
--   { id: 1, title: "My Post", tag_ids: [1, 2, 3], tags: [...] }
-- ============================================================================
