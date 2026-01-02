-- Brands and Artwork Entities
-- Brands belong to organisations and have associated artwork

SET search_path = public, dzql;

-- === Domain Tables ===

-- Brands (marketing identities owned by organisations)
CREATE TABLE IF NOT EXISTS brands (
  id serial PRIMARY KEY,
  org_id integer NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  UNIQUE(org_id, name)  -- Brand names must be unique within an organisation
);

-- Artwork (visual assets for brands)
CREATE TABLE IF NOT EXISTS artwork (
  id serial PRIMARY KEY,
  brand_id integer NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  url text NOT NULL,
  ratio decimal(10, 4) NOT NULL,  -- e.g., 16:9 = 1.7778, 4:3 = 1.3333
  CONSTRAINT valid_ratio CHECK (ratio > 0)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_brands_org_id ON brands(org_id);
CREATE INDEX IF NOT EXISTS idx_artwork_brand_id ON artwork(brand_id);

-- === DZQL Entity Registration ===

-- Register brands
SELECT dzql.register_entity(
  'brands',                                   -- table name
  'name',                                     -- label field
  array['name', 'description'],               -- searchable fields
  '{"org": "organisations", "artwork": "artwork"}',  -- FK includes: dereference org + include artwork array
  false,                                      -- soft delete disabled
  '{}',                                       -- no temporal fields
  jsonb_build_object(
    'org_members', array['@org_id->acts_for[org_id=$]{active}.user_id']
  ),                                          -- notify org members when brand changes
  jsonb_build_object(
    'view', array[]::text[],                  -- public read access
    'create', array['@org_id->acts_for[org_id=$]{active}.user_id'],  -- only org members can create
    'update', array['@org_id->acts_for[org_id=$]{active}.user_id'],  -- only org members can update
    'delete', array['@org_id->acts_for[org_id=$]{active}.user_id']   -- only org members can delete
  ),
  '{}'::jsonb                                 -- graph rules: cascade delete handled by FK CASCADE
);

-- Register artwork
SELECT dzql.register_entity(
  'artwork',                                  -- table name
  'url',                                      -- label field (best we have)
  array['url'],                               -- searchable fields
  '{"brand": "brands"}',                      -- FK includes (dereference brand in get operations)
  false,                                      -- soft delete disabled
  '{}',                                       -- no temporal fields
  jsonb_build_object(
    'brand_org_members', array['@brand_id->brands.org_id->acts_for[org_id=$]{active}.user_id']
  ),                                          -- notify brand's org members when artwork changes
  jsonb_build_object(
    'view', array[]::text[],                  -- public read access
    'create', array['@brand_id->brands.org_id->acts_for[org_id=$]{active}.user_id'],  -- only brand's org members can create
    'update', array['@brand_id->brands.org_id->acts_for[org_id=$]{active}.user_id'],  -- only brand's org members can update
    'delete', array['@brand_id->brands.org_id->acts_for[org_id=$]{active}.user_id']   -- only brand's org members can delete
  ),
  '{}'                                        -- no graph rules
);

-- === Sample Data (optional) ===

-- Insert a sample brand (assuming organisation id=1 exists)
-- INSERT INTO brands (org_id, name, description)
-- VALUES (1, 'Sample Brand', 'A sample brand for testing')
-- ON CONFLICT (org_id, name) DO NOTHING;

-- Insert sample artwork for the brand
-- INSERT INTO artwork (brand_id, url, ratio)
-- SELECT id, 'https://example.com/logo.png', 1.7778
-- FROM brands WHERE name = 'Sample Brand'
-- ON CONFLICT DO NOTHING;

DO $$
BEGIN
  RAISE NOTICE 'DZQL: Brands and Artwork entities registered successfully';
END $$;
