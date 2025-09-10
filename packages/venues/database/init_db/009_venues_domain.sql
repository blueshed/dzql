-- Simple Domain for ZeroQL Testing
-- Basic venue/site/product entities with organizations

-- Ensure we create tables in public schema
SET search_path = public, zeroql;

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
  org_id int not null references organisations(id) ON DELETE CASCADE,
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
  org_id int not null references organisations(id) ON DELETE CASCADE,
  name text unique not null,
  description text,
  price decimal(10, 2) not null default 0.00
);

-- === Permission & Delegation Tables ===

-- Users act for organizations (temporal relationship)
create table if not exists acts_for (
  user_id int not null references users(id),
  org_id int not null references organisations(id) ON DELETE CASCADE,
  valid_from date not null default current_date,
  valid_to date,
  PRIMARY KEY (user_id, org_id, valid_from)
);

-- Packages: Commercial offerings that can be sold
create table if not exists packages (
  id serial primary key,
  owner_org_id int not null references organisations(id) ON DELETE CASCADE,    -- Who created it
  sponsor_org_id int references organisations(id) ON DELETE SET NULL,           -- Who bought it (null = available)
  name text not null,
  price decimal(10, 2) not null default 0.00,
  status text not null default 'draft'
    check (status in ('draft', 'available', 'sold', 'expired'))
);

-- Allocations: Sites allocated to a package
create table if not exists allocations (
  id serial primary key,
  package_id int not null references packages(id),
  site_id int not null references sites(id),
  from_date date not null,
  to_date date not null
);

-- Contractor rights: Sponsor delegates execution rights
create table if not exists contractor_rights (
  contractor_org_id int not null references organisations(id) ON DELETE CASCADE,
  sponsor_org_id int not null references organisations(id) ON DELETE CASCADE,
  package_id int not null references packages(id) ON DELETE CASCADE,
  valid_from date not null default current_date,
  valid_to date,
  PRIMARY KEY (contractor_org_id, package_id, valid_from)
);

-- === Entity Registration ===
-- Register entities with ZeroQL for automatic CRUD operations

-- Register users
select zeroql.register_entity(
  'users',
  'name',                              -- label field for lookups
  array['name', 'email'],              -- searchable fields
  '{}',                               -- no foreign keys to dereference
  false,                              -- no soft delete
  '{}',                               -- no temporal fields
  '{}',                               -- no notification paths for users
  jsonb_build_object(
    'create', array[]::text[],                -- Anyone can register (public)
    'update', array['@id'],                   -- Only the user themselves
    'delete', array['@id'],                   -- Only the user themselves
    'view', array[]::text[]                   -- Public read access
  )
);

-- Register organisations
select zeroql.register_entity(
  'organisations',
  'name',                              -- label field for lookups
  array['name', 'description'],        -- searchable fields
  '{}',                               -- no foreign keys to dereference
  false,                              -- no soft delete
  '{}',                               -- no temporal fields
  '{}',                               -- no notification paths yet
  jsonb_build_object(
    'create', array[]::text[],                        -- Anyone can create organizations
    'update', array['@id->acts_for[org_id=$]{active}.user_id'],  -- Only org members can update
    'delete', array['@id->acts_for[org_id=$]{active}.user_id'],  -- Only org members can delete
    'view', array[]::text[]                           -- Public read access
  ),
  jsonb_build_object(
    'on_create', jsonb_build_object(
      'establish_ownership', jsonb_build_object(
        'description', 'Creator becomes owner',
        'actions', jsonb_build_array(
          jsonb_build_object(
            'type', 'create',
            'entity', 'acts_for',
            'data', jsonb_build_object(
              'user_id', '@user_id',
              'org_id', '@id',
              'valid_from', '@today'
            )
          )
        )
      )
    )
  )
);

-- Register venues
select zeroql.register_entity(
  'venues',
  'name',
  array['name', 'address', 'description'],
  '{"org": "organisations", "sites": "sites"}', -- dereference org and include sites
  false,
  '{}',
  jsonb_build_object(
    'ownership', array['@org_id->acts_for[org_id=$]{active}.user_id']  -- Venue owner users notified
  ),
  jsonb_build_object(
    'create', array['@org_id->acts_for[org_id=$]{active}.user_id'],
    'update', array['@org_id->acts_for[org_id=$]{active}.user_id'],
    'delete', array['@org_id->acts_for[org_id=$]{active}.user_id'],
    'view', array[]::text[]  -- Public read access
  )
);

-- Register sites
select zeroql.register_entity(
  'sites',
  'name',
  array['name', 'description'],
  '{"venue": "venues"}',              -- dereference venue
  false,
  '{}',
  jsonb_build_object(
    'ownership', array['venue_id.org_id->acts_for[org_id=$]{active}.user_id']  -- Venue owner users notified
  ),
  jsonb_build_object(
    'create', array['venue_id.org_id->acts_for[org_id=$]{active}.user_id'],
    'update', array['venue_id.org_id->acts_for[org_id=$]{active}.user_id'],
    'delete', array['venue_id.org_id->acts_for[org_id=$]{active}.user_id'],
    'view', array[]::text[]  -- Public read access
  )
);

-- Register products
select zeroql.register_entity(
  'products',
  'name',
  array['name', 'description'],
  '{"org": "organisations"}',    -- dereference owner org
  false,
  '{}',
  jsonb_build_object(
    'ownership', array['@org_id->acts_for[org_id=$]{active}.user_id']  -- Product owner users notified
  ),
  jsonb_build_object(
    'create', array['@org_id->acts_for[org_id=$]{active}.user_id'],
    'update', array['@org_id->acts_for[org_id=$]{active}.user_id'],
    'delete', array['@org_id->acts_for[org_id=$]{active}.user_id'],
    'view', array[]::text[]  -- Public read access
  )
);

-- Register acts_for with temporal support
select zeroql.register_entity(
  'acts_for',
  'org_id',  -- Will need custom label function
  array['org_id', 'user_id'],
  '{"user": "users", "org": "organisations"}',
  false,
  '{"valid_from": "valid_from", "valid_to": "valid_to"}',  -- Temporal fields
  '{}',  -- No special notifications for this junction table
  '{}'   -- No permission paths (unrestricted for now)
);

-- Register packages with notification paths
select zeroql.register_entity(
  'packages',
  'name',
  array['name'],
  '{"owner_org": "organisations", "sponsor_org": "organisations"}',
  false,
  '{}',
  jsonb_build_object(
    'ownership', array['@owner_org_id->acts_for[org_id=$]{active}.user_id'],
    'commercial', array['@sponsor_org_id->acts_for[org_id=$]{active}.user_id']
  ),
  jsonb_build_object(
    'create', array[
      '@owner_org_id->acts_for[org_id=$]{active}.user_id',
      '@sponsor_org_id->acts_for[org_id=$]{active}.user_id'
    ],
    'update', array[
      '@owner_org_id->acts_for[org_id=$]{active}.user_id',
      '@sponsor_org_id->acts_for[org_id=$]{active}.user_id'
    ],
    'delete', array['@owner_org_id->acts_for[org_id=$]{active}.user_id'],
    'view', array[
      '@owner_org_id->acts_for[org_id=$]{active}.user_id',
      '@sponsor_org_id->acts_for[org_id=$]{active}.user_id'
    ]
  )
);

-- Register allocations with complex notification paths
select zeroql.register_entity(
  'allocations',
  'id',  -- No good label field, use id
  array['site_id'],
  '{"package": "packages", "site": "sites"}',
  false,
  '{}',
  jsonb_build_object(
    'ownership', array['site_id.venue_id.org_id->acts_for[org_id=$]{active}.user_id'],  -- Venue owner users via site->venue
    'commercial', array[
      'package_id.owner_org_id->acts_for[org_id=$]{active}.user_id',     -- Package creator users
      'package_id.sponsor_org_id->acts_for[org_id=$]{active}.user_id'    -- Package buyer users
    ],
    'delegated', array[
      'contractor_rights[package_id=@package_id]{active}.contractor_org_id->acts_for[org_id=$]{active}.user_id'
    ]
  ),
  jsonb_build_object(
    'create', array['@site_id->sites.venue_id.org_id->acts_for[org_id=$]{active}.user_id'],
    'update', array[
      'site_id.venue_id.org_id->acts_for[org_id=$]{active}.user_id',
      'package_id.owner_org_id->acts_for[org_id=$]{active}.user_id'
    ],
    'delete', array['site_id.venue_id.org_id->acts_for[org_id=$]{active}.user_id'],
    'view',   array[
      'site_id.venue_id.org_id->acts_for[org_id=$]{active}.user_id',
      'package_id.owner_org_id->acts_for[org_id=$]{active}.user_id',
      'package_id.sponsor_org_id->acts_for[org_id=$]{active}.user_id',
      'contractor_rights[package_id=@package_id]{active}.contractor_org_id->acts_for[org_id=$]{active}.user_id'
    ]
  )
);

-- Register contractor_rights with temporal support
select zeroql.register_entity(
  'contractor_rights',
  'contractor_org_id',
  array['contractor_org_id', 'sponsor_org_id'],
  '{"contractor_org": "organisations", "sponsor_org": "organisations", "package": "packages"}',
  false,
  '{"valid_from": "valid_from", "valid_to": "valid_to"}',
  jsonb_build_object(
    'parties', array[
      '@contractor_org_id->acts_for[org_id=$]{active}.user_id',
      '@sponsor_org_id->acts_for[org_id=$]{active}.user_id'
    ]
  ),
  jsonb_build_object(
    'create', array['@sponsor_org_id->acts_for[org_id=$]{active}.user_id'],
    'update', array['@sponsor_org_id->acts_for[org_id=$]{active}.user_id'],
    'delete', array['@sponsor_org_id->acts_for[org_id=$]{active}.user_id'],
    'view', array[]::text[]  -- Public read access
  )
);

-- === Sample Data ===

-- Sample organizations
insert into organisations (name, description) values
  ('Event Corp', 'Event management company'),
  ('Sponsor LLC', 'Major sponsor organization'),
  ('Venue Management', 'Venue operations company'),
  ('Contractor Co', 'Logistics and installation contractor')
on conflict (name) do nothing;

-- Note: acts_for records need to be created after users exist
-- Users are created in 010_auth.sql, so we'll skip sample data here

-- Sample venues (must be created before sites)
insert into venues (org_id, name, address, description) values
  ((select id from organisations where name = 'Venue Management'),
   'Madison Square Garden', '4 Pennsylvania Plaza, New York, NY', 'Famous arena'),
  ((select id from organisations where name = 'Venue Management'),
   'Barclays Center', '620 Atlantic Ave, Brooklyn, NY', 'Brooklyn sports arena')
on conflict (name) do nothing;

-- Sample sites (must be created before allocations)
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

-- Sample package (created after organizations)
insert into packages (owner_org_id, name, price, status) values
  ((select id from organisations where name = 'Event Corp'),
   'Summer Festival Package', 25000.00, 'available')
on conflict do nothing;

-- Sample allocation (created after packages and sites)
insert into allocations (package_id, site_id, from_date, to_date) values
  ((select id from packages where name = 'Summer Festival Package'),
   (select id from sites where name = 'Main Entrance'),
   '2024-07-01', '2024-08-31')
on conflict do nothing;
