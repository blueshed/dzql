-- Simple Domain for ZeroQL Testing
-- Basic venue/site/product entities with organizations

-- === Domain Tables ===

-- Organizations (owners, sponsors, contractors)
create table if not exists organisations (
  id serial primary key,
  name text unique not null,
  description text
);

-- Venues (physical locations)
create table if not exists venues (
  id serial primary key,
  org_id int not null references organisations(id),
  name text unique not null,
  address text not null,
  description text
);

-- Sites (locations within venues where products can be placed)
create table if not exists sites (
  id serial primary key,
  venue_id int not null references venues(id),
  name text not null,
  description text
);

-- Products (advertising products that can be installed)
create table if not exists products (
  id serial primary key,
  org_id int not null references organisations(id),
  name text unique not null,
  description text,
  price decimal(10, 2) not null default 0.00
);

-- === ZeroQL Entity Registration ===

-- Register organisations
select zeroql.register_entity(
  'organisations',
  'name',                              -- label field for lookups
  array['name', 'description'],        -- searchable fields
  '{}',                               -- no foreign keys to dereference
  '{"read": ["user"], "write": ["admin"]}', -- permissions
  false,                              -- no soft delete
  '{}'                                -- no temporal fields
);

-- Register venues
select zeroql.register_entity(
  'venues',
  'name',
  array['name', 'address', 'description'],
  '{"org": "organisations", "sites": "sites"}', -- dereference org and include sites
  '{"read": ["user"], "write": ["owner"]}',
  false,
  '{}'
);

-- Register sites
select zeroql.register_entity(
  'sites',
  'name',
  array['name', 'description'],
  '{"venue": "venues"}',              -- dereference venue
  '{"read": ["user"], "write": ["owner"]}',
  false,
  '{}'
);

-- Register products
select zeroql.register_entity(
  'products',
  'name',
  array['name', 'description'],
  '{"org": "organisations"}',    -- dereference owner org
  '{"read": ["user"], "write": ["owner"]}',
  false,
  '{}'
);

-- === Sample Data ===

-- Sample organizations
insert into organisations (name, description) values
  ('Event Corp', 'Event management company'),
  ('Sponsor LLC', 'Major sponsor organization'),
  ('Venue Management', 'Venue operations company')
on conflict (name) do nothing;

-- Sample venues
insert into venues (org_id, name, address, description) values
  ((select id from organisations where name = 'Venue Management'),
   'Madison Square Garden', '4 Pennsylvania Plaza, New York, NY', 'Famous arena'),
  ((select id from organisations where name = 'Venue Management'),
   'Barclays Center', '620 Atlantic Ave, Brooklyn, NY', 'Brooklyn sports arena')
on conflict (name) do nothing;

-- Sample sites
insert into sites (venue_id, name, description) values
  ((select id from venues where name = 'Madison Square Garden'),
   'Main Entrance', 'Primary entrance display area'),
  ((select id from venues where name = 'Madison Square Garden'),
   'Concourse Level', 'Mid-level concourse displays'),
  ((select id from venues where name = 'Barclays Center'),
   'Atrium', 'Central atrium display space')
on conflict do nothing;

-- Sample products
insert into products (org_id, name, description, price) values
  ((select id from organisations where name = 'Sponsor LLC'),
   'LED Banner 48x12', 'Large LED advertising banner', 1500.00),
  ((select id from organisations where name = 'Sponsor LLC'),
   'Digital Kiosk', 'Interactive digital advertising kiosk', 2500.50),
  ((select id from organisations where name = 'Event Corp'),
   'Static Poster 24x36', 'Traditional poster advertising', 250.75)
on conflict (name) do nothing;
