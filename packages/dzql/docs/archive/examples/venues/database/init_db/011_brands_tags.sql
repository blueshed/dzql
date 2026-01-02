-- ============================================================================
-- Brands Tags - Many-to-Many Relationship
-- Testing M2M support for brands with tags
-- ============================================================================

-- Tags table - shared across organisations
CREATE TABLE tags (
  id serial PRIMARY KEY,
  name text NOT NULL UNIQUE,
  color text,
  description text
);

-- Junction table for brand ↔ tags relationship
CREATE TABLE brand_tags (
  brand_id integer NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  tag_id integer NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (brand_id, tag_id)
);

-- Index for efficient tag lookups
CREATE INDEX idx_brand_tags_tag_id ON brand_tags(tag_id);

-- Register tags entity with DZQL
SELECT dzql.register_entity(
  'tags',
  'name',
  ARRAY['name', 'description'],
  '{}',
  false,
  '{}',
  '{}',
  '{
    "view": [],
    "create": [],
    "update": [],
    "delete": []
  }',
  '{}'
);

-- Update brands entity to include M2M tags
-- NOTE: This modifies the existing brands registration from 010_brands_artwork.sql
SELECT dzql.register_entity(
  'brands',
  'name',
  ARRAY['name', 'description'],
  '{
    "org": "organisations",
    "artwork": "artwork"
  }',
  false,
  '{}',
  '{
    "create": ["@org_id->acts_for[org_id=$]{active}.user_id"],
    "update": ["@org_id->acts_for[org_id=$]{active}.user_id"],
    "delete": ["@org_id->acts_for[org_id=$]{active}.user_id"]
  }',
  '{
    "view": [],
    "create": ["@org_id->acts_for[org_id=$]{active}.user_id"],
    "update": ["@org_id->acts_for[org_id=$]{active}.user_id"],
    "delete": ["@org_id->acts_for[org_id=$]{active}.user_id"]
  }',
  '{
    "many_to_many": {
      "tags": {
        "junction_table": "brand_tags",
        "local_key": "brand_id",
        "foreign_key": "tag_id",
        "target_entity": "tags",
        "id_field": "tag_ids",
        "expand": false
      }
    }
  }'
);

-- Insert some sample tags
INSERT INTO tags (name, color, description) VALUES
  ('Premium', '#FFD700', 'Premium quality products'),
  ('Eco-Friendly', '#22C55E', 'Environmentally conscious'),
  ('Limited Edition', '#EF4444', 'Limited availability'),
  ('Popular', '#3B82F6', 'Best selling items'),
  ('New', '#8B5CF6', 'Recently added')
ON CONFLICT (name) DO NOTHING;
