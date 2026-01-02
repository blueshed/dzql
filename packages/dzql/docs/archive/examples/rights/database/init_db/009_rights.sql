-- Comprehensive Rights Management Domain for ZeroQL
-- All tables from schema with proper permissions and notifications

-- Ensure we create tables in public schema
SET search_path = public, dzql;

-- ===============================================
-- Core Entities
-- ===============================================

-- Users (already created in auth, skipping creation)
-- CREATE TABLE IF NOT EXISTS users (
--     id serial PRIMARY KEY,
--     email text UNIQUE NOT NULL,
--     name text,
--     password_hash text NOT NULL
-- );

-- Organizations (owners, sponsors, contractors, promoters)
CREATE TABLE IF NOT EXISTS organisations (
    id serial PRIMARY KEY,
    name text UNIQUE NOT NULL,
    description text
);

-- Users act for organizations (temporal relationship)
CREATE TABLE IF NOT EXISTS acts_for (
    user_id int NOT NULL REFERENCES users(id),
    org_id int NOT NULL REFERENCES organisations(id),
    valid_from date NOT NULL DEFAULT current_date,
    valid_to date,
    PRIMARY KEY (user_id, org_id, valid_from)
);

-- Venues (physical locations)
CREATE TABLE IF NOT EXISTS venues (
    id serial PRIMARY KEY,
    org_id int NOT NULL REFERENCES organisations(id),
    name text UNIQUE NOT NULL,
    address text NOT NULL,
    description text,
    lat decimal,
    lng decimal
);

-- Areas within venues (hierarchical)
CREATE TABLE IF NOT EXISTS areas (
    id serial PRIMARY KEY,
    venue_id int NOT NULL REFERENCES venues(id),
    parent_id int REFERENCES areas(id),
    group_id int,
    name text NOT NULL,
    description text
);

-- Sites (locations within venues where products can be placed)
CREATE TABLE IF NOT EXISTS sites (
    id serial PRIMARY KEY,
    venue_id int NOT NULL REFERENCES venues(id),
    area_id int REFERENCES areas(id),
    name text NOT NULL,
    description text,
    lat decimal,
    lng decimal
);

-- Products (advertising products that can be installed)
CREATE TABLE IF NOT EXISTS products (
    id serial PRIMARY KEY,
    owner_org_id int NOT NULL REFERENCES organisations(id),
    name text UNIQUE NOT NULL,
    description text,
    dimensions jsonb
);

-- Junction: Sites can display multiple products
CREATE TABLE IF NOT EXISTS site_products (
    site_id int NOT NULL REFERENCES sites(id),
    product_id int NOT NULL REFERENCES products(id),
    PRIMARY KEY (site_id, product_id)
);

-- ===============================================
-- Inventory Management
-- ===============================================

-- Site information documented by contractors
CREATE TABLE IF NOT EXISTS site_info (
    id serial PRIMARY KEY,
    site_id int NOT NULL REFERENCES sites(id),
    contractor_org_id int NOT NULL REFERENCES organisations(id),
    dimensions text,
    notes text
);

-- Modules owned by contractors
CREATE TABLE IF NOT EXISTS modules (
    id serial PRIMARY KEY,
    contractor_org_id int NOT NULL REFERENCES organisations(id),
    name text NOT NULL,
    dimensions text
);

-- Components that make up modules
CREATE TABLE IF NOT EXISTS components (
    id serial PRIMARY KEY,
    name text NOT NULL,
    type text CHECK (type IN ('structural', 'hardware', 'tool', 'accessory')),
    description text,
    specifications text,
    unit text
);

-- Junction: Modules and their components
CREATE TABLE IF NOT EXISTS module_components (
    module_id int NOT NULL REFERENCES modules(id),
    component_id int NOT NULL REFERENCES components(id),
    quantity int NOT NULL,
    notes text,
    PRIMARY KEY (module_id, component_id)
);

-- Individual module items with barcodes
CREATE TABLE IF NOT EXISTS module_items (
    id serial PRIMARY KEY,
    module_id int NOT NULL REFERENCES modules(id),
    barcode text UNIQUE NOT NULL,
    location text,
    notes text
);

-- Individual product items held by contractors for sponsors
CREATE TABLE IF NOT EXISTS product_items (
    id serial PRIMARY KEY,
    product_id int NOT NULL REFERENCES products(id),
    sponsor_id int NOT NULL REFERENCES organisations(id),
    contractor_org_id int NOT NULL REFERENCES organisations(id),
    barcode text UNIQUE NOT NULL,
    location text,
    notes text
);

-- ===============================================
-- Physical Structure
-- ===============================================

-- Junction: Sites and compatible modules
CREATE TABLE IF NOT EXISTS site_modules (
    site_id int NOT NULL REFERENCES sites(id),
    module_id int NOT NULL REFERENCES modules(id),
    PRIMARY KEY (site_id, module_id)
);

-- Faces (surfaces) on modules
CREATE TABLE IF NOT EXISTS faces (
    id serial PRIMARY KEY,
    module_id int NOT NULL REFERENCES modules(id),
    name text NOT NULL,
    sequence int,
    orientation int CHECK (orientation >= 0 AND orientation < 360),
    dimensions text
);

-- Junction: Faces and compatible products
CREATE TABLE IF NOT EXISTS face_products (
    face_id int NOT NULL REFERENCES faces(id),
    product_id int NOT NULL REFERENCES products(id),
    PRIMARY KEY (face_id, product_id)
);

-- Performance scores for site/face/product combinations
CREATE TABLE IF NOT EXISTS performance (
    site_id int NOT NULL REFERENCES sites(id),
    face_id int NOT NULL REFERENCES faces(id),
    product_id int NOT NULL REFERENCES products(id),
    tv_score int CHECK (tv_score >= 0 AND tv_score <= 3),
    social_score int CHECK (social_score >= 0 AND social_score <= 3),
    footfall_score int CHECK (footfall_score >= 0 AND footfall_score <= 3),
    hospitality_score int CHECK (hospitality_score >= 0 AND hospitality_score <= 3),
    PRIMARY KEY (site_id, face_id, product_id)
);

-- ===============================================
-- Rights Management
-- ===============================================

-- Contractor rights (from owner or sponsor)
CREATE TABLE IF NOT EXISTS contractor_rights (
    contractor_org_id int NOT NULL REFERENCES organisations(id),
    granted_by_type text CHECK (granted_by_type IN ('owner', 'sponsor')),
    granted_by_id int NOT NULL REFERENCES organisations(id),
    venue_id int NOT NULL REFERENCES venues(id),
    valid_from date NOT NULL DEFAULT current_date,
    valid_to date,
    PRIMARY KEY (contractor_org_id, venue_id, valid_from)
);

-- ===============================================
-- Events & Timing
-- ===============================================

-- Occasions (events at venues)
CREATE TABLE IF NOT EXISTS occasions (
    id serial PRIMARY KEY,
    venue_id int NOT NULL REFERENCES venues(id),
    name text NOT NULL,
    from_date date NOT NULL,
    to_date date NOT NULL
);

-- Events within occasions
CREATE TABLE IF NOT EXISTS events (
    id serial PRIMARY KEY,
    occasion_id int NOT NULL REFERENCES occasions(id),
    name text NOT NULL,
    from_datetime timestamp NOT NULL,
    to_datetime timestamp NOT NULL
);

-- Moments within occasions
CREATE TABLE IF NOT EXISTS moments (
    id serial PRIMARY KEY,
    occasion_id int NOT NULL REFERENCES occasions(id),
    name text NOT NULL,
    at_datetime timestamp NOT NULL
);

-- Promotion rights (venue owner delegates to promoter)
CREATE TABLE IF NOT EXISTS promotion_rights (
    owner_id int NOT NULL REFERENCES organisations(id),
    promoter_id int NOT NULL REFERENCES organisations(id),
    occasion_id int NOT NULL REFERENCES occasions(id),
    valid_from date NOT NULL DEFAULT current_date,
    valid_to date,
    PRIMARY KEY (owner_id, promoter_id, occasion_id, valid_from)
);

-- ===============================================
-- Commercial Operations
-- ===============================================

-- Packages (commercial offerings)
CREATE TABLE IF NOT EXISTS packages (
    id serial PRIMARY KEY,
    occasion_id int REFERENCES occasions(id),
    owner_id int NOT NULL REFERENCES organisations(id),
    promoter_id int REFERENCES organisations(id),
    sponsor_id int REFERENCES organisations(id),
    name text NOT NULL,
    is_public boolean NOT NULL DEFAULT false
);

-- Campaigns group packages for sponsors
CREATE TABLE IF NOT EXISTS campaigns (
    id serial PRIMARY KEY,
    sponsor_id int NOT NULL REFERENCES organisations(id),
    name text NOT NULL,
    description text
);

-- Junction: Campaigns and their packages
CREATE TABLE IF NOT EXISTS campaign_packages (
    campaign_id int NOT NULL REFERENCES campaigns(id),
    package_id int NOT NULL REFERENCES packages(id),
    PRIMARY KEY (campaign_id, package_id)
);

-- Package proposals to potential sponsors
CREATE TABLE IF NOT EXISTS package_proposals (
    id serial PRIMARY KEY,
    package_id int NOT NULL REFERENCES packages(id),
    proposed_by_id int NOT NULL REFERENCES organisations(id),
    proposed_to_id int NOT NULL REFERENCES organisations(id),
    status text CHECK (status IN ('pending', 'accepted', 'rejected')) DEFAULT 'pending',
    notes text
);

-- Site allocations to packages
CREATE TABLE IF NOT EXISTS allocations (
    id serial PRIMARY KEY,
    package_id int NOT NULL REFERENCES packages(id),
    site_id int NOT NULL REFERENCES sites(id),
    from_datetime timestamp NOT NULL,
    to_datetime timestamp NOT NULL
);

-- Sponsor performance briefs
CREATE TABLE IF NOT EXISTS sponsor_briefs (
    sponsor_id int NOT NULL REFERENCES organisations(id),
    occasion_id int NOT NULL REFERENCES occasions(id),
    contractor_org_id int NOT NULL REFERENCES organisations(id),
    tv_priority int CHECK (tv_priority >= 0 AND tv_priority <= 3),
    social_priority int CHECK (social_priority >= 0 AND social_priority <= 3),
    footfall_priority int CHECK (footfall_priority >= 0 AND footfall_priority <= 3),
    hospitality_priority int CHECK (hospitality_priority >= 0 AND hospitality_priority <= 3),
    notes text,
    plan_assessment_tv_score int CHECK (plan_assessment_tv_score >= 0 AND plan_assessment_tv_score <= 3),
    plan_assessment_social_score int CHECK (plan_assessment_social_score >= 0 AND plan_assessment_social_score <= 3),
    plan_assessment_footfall_score int CHECK (plan_assessment_footfall_score >= 0 AND plan_assessment_footfall_score <= 3),
    plan_assessment_hospitality_score int CHECK (plan_assessment_hospitality_score >= 0 AND plan_assessment_hospitality_score <= 3),
    plan_assessment_notes text,
    execution_assessment_tv_score int CHECK (execution_assessment_tv_score >= 0 AND execution_assessment_tv_score <= 3),
    execution_assessment_social_score int CHECK (execution_assessment_social_score >= 0 AND execution_assessment_social_score <= 3),
    execution_assessment_footfall_score int CHECK (execution_assessment_footfall_score >= 0 AND execution_assessment_footfall_score <= 3),
    execution_assessment_hospitality_score int CHECK (execution_assessment_hospitality_score >= 0 AND execution_assessment_hospitality_score <= 3),
    execution_assessment_notes text,
    PRIMARY KEY (sponsor_id, occasion_id, contractor_org_id)
);

-- Contractor options for allocations
CREATE TABLE IF NOT EXISTS allocation_options (
    id serial PRIMARY KEY,
    allocation_id int NOT NULL REFERENCES allocations(id),
    module_id int NOT NULL REFERENCES modules(id),
    face_id int NOT NULL REFERENCES faces(id),
    product_id int NOT NULL REFERENCES products(id),
    contractor_notes text
);

-- Sponsor selections from options
CREATE TABLE IF NOT EXISTS sponsor_selections (
    allocation_id int NOT NULL REFERENCES allocations(id),
    option_id int NOT NULL REFERENCES allocation_options(id),
    procurement text CHECK (procurement IN ('buy_new', 'use_stock')),
    sponsor_notes text,
    PRIMARY KEY (allocation_id)
);

-- Inventory allocations of specific items
CREATE TABLE IF NOT EXISTS inventory_allocations (
    id serial PRIMARY KEY,
    sponsor_selection_id int NOT NULL REFERENCES sponsor_selections(allocation_id),
    module_item_id int REFERENCES module_items(id),
    product_item_id int REFERENCES product_items(id),
    allocated_at timestamp NOT NULL DEFAULT now(),
    returned_at timestamp,
    return_condition text CHECK (return_condition IN ('good', 'damaged', 'lost')),
    condition_notes text
);

-- ===============================================
-- Task Management
-- ===============================================

-- Teams for occasions
CREATE TABLE IF NOT EXISTS teams (
    id serial PRIMARY KEY,
    contractor_org_id int NOT NULL REFERENCES organisations(id),
    occasion_id int NOT NULL REFERENCES occasions(id),
    name text NOT NULL
);

-- Team members
CREATE TABLE IF NOT EXISTS team_members (
    team_id int NOT NULL REFERENCES teams(id),
    user_id int NOT NULL REFERENCES users(id),
    PRIMARY KEY (team_id, user_id)
);

-- Work windows for tasks
CREATE TABLE IF NOT EXISTS work_windows (
    id serial PRIMARY KEY,
    occasion_id int NOT NULL REFERENCES occasions(id),
    name text NOT NULL,
    from_datetime timestamp NOT NULL,
    to_datetime timestamp NOT NULL
);

-- Tasks for operational workflows
CREATE TABLE IF NOT EXISTS tasks (
    id serial PRIMARY KEY,
    name text NOT NULL,
    description text,
    duration interval,
    assigned_to int REFERENCES users(id),
    team_id int REFERENCES teams(id),
    work_window_id int REFERENCES work_windows(id),
    completed_by int REFERENCES users(id),
    started timestamp,
    completed timestamp
);

-- Task dependencies
CREATE TABLE IF NOT EXISTS task_dependencies (
    task_id int NOT NULL REFERENCES tasks(id),
    depends_on_id int NOT NULL REFERENCES tasks(id),
    PRIMARY KEY (task_id, depends_on_id)
);

-- Task resources (inventory items needed)
CREATE TABLE IF NOT EXISTS task_resources (
    task_id int NOT NULL REFERENCES tasks(id),
    inventory_allocation_id int NOT NULL REFERENCES inventory_allocations(id),
    PRIMARY KEY (task_id, inventory_allocation_id)
);

-- ===============================================
-- Task Templates
-- ===============================================

-- Module task templates
CREATE TABLE IF NOT EXISTS module_task_templates (
    id serial PRIMARY KEY,
    module_id int NOT NULL REFERENCES modules(id),
    name text NOT NULL,
    description text,
    sequence int,
    duration interval,
    skill_level text CHECK (skill_level IN ('basic', 'intermediate', 'advanced')),
    required_tools text,
    safety_notes text,
    task_type text CHECK (task_type IN ('setup', 'installation', 'maintenance', 'deinstallation', 'teardown'))
);

-- Task template dependencies
CREATE TABLE IF NOT EXISTS task_template_dependencies (
    template_id int NOT NULL REFERENCES module_task_templates(id),
    depends_on_id int NOT NULL REFERENCES module_task_templates(id),
    PRIMARY KEY (template_id, depends_on_id)
);

-- Task template components
CREATE TABLE IF NOT EXISTS task_template_components (
    template_id int NOT NULL REFERENCES module_task_templates(id),
    component_id int NOT NULL REFERENCES components(id),
    quantity_needed int NOT NULL,
    PRIMARY KEY (template_id, component_id)
);

-- ===============================================
-- ZEROQL ENTITY REGISTRATIONS
-- ===============================================

-- Register users
SELECT dzql.register_entity(
    'users',
    'name',
    array['name', 'email'],
    '{}',
    false,
    '{}',
    '{}',
    jsonb_build_object(
        'create', array[]::text[],
        'update', array['@id'],
        'delete', array['@id'],
        'view', array[]::text[]
    )
);

-- Register organisations
SELECT dzql.register_entity(
    'organisations',
    'name',
    array['name', 'description'],
    '{}',
    false,
    '{}',
    jsonb_build_object(
        'ownership', array['@id->acts_for[org_id=$]{active}.user_id']
    ),
    jsonb_build_object(
        'create', array[]::text[],
        'update', array['@id->acts_for[org_id=$]{active}.user_id'],
        'delete', array['@id->acts_for[org_id=$]{active}.user_id'],
        'view', array[]::text[]
    ),
    jsonb_build_object(
        'on_create', jsonb_build_object(
            'establish_ownership', jsonb_build_object(
                'description', 'Creator becomes member of organisation',
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

-- Register acts_for (temporal)
SELECT dzql.register_entity(
    'acts_for',
    'org_id',
    array['org_id', 'user_id'],
    '{"user": "users", "org": "organisations"}',
    false,
    '{"valid_from": "valid_from", "valid_to": "valid_to"}',
    '{}',
    jsonb_build_object(
        'create', array['@org_id->acts_for[org_id=$]{active}.user_id'],
        'update', array['@org_id->acts_for[org_id=$]{active}.user_id'],
        'delete', array['@org_id->acts_for[org_id=$]{active}.user_id'],
        'view', array[]::text[]
    )
);

-- Register venues
SELECT dzql.register_entity(
    'venues',
    'name',
    array['name', 'address', 'description'],
    '{
        "org": "organisations",
        "areas": "areas.venue_id",
        "sites": "sites.venue_id",
        "sites.product_ids": "site_products.product_id"
    }',
    false,
    '{}',
    jsonb_build_object(
        'ownership', array['@org_id->acts_for[org_id=$]{active}.user_id']
    ),
    jsonb_build_object(
        'create', array['@org_id->acts_for[org_id=$]{active}.user_id'],
        'update', array['@org_id->acts_for[org_id=$]{active}.user_id'],
        'delete', array['@org_id->acts_for[org_id=$]{active}.user_id'],
        'view', array[]::text[]
    )
);

-- Register areas
SELECT dzql.register_entity(
    'areas',
    'name',
    array['name', 'description'],
    '{"venue": "venues", "parent": "areas"}',
    false,
    '{}',
    jsonb_build_object(
        'ownership', array['@venue_id->venues.org_id->acts_for[org_id=$]{active}.user_id']
    ),
    jsonb_build_object(
        'create', array['@venue_id->venues.org_id->acts_for[org_id=$]{active}.user_id'],
        'update', array['@venue_id->venues.org_id->acts_for[org_id=$]{active}.user_id'],
        'delete', array['@venue_id->venues.org_id->acts_for[org_id=$]{active}.user_id'],
        'view', array[]::text[]
    )
);

-- Register sites
SELECT dzql.register_entity(
    'sites',
    'name',
    array['name', 'description'],
    '{"venue": "venues", "area": "areas"}',
    false,
    '{}',
    jsonb_build_object(
        'ownership', array['@venue_id->venues.org_id->acts_for[org_id=$]{active}.user_id']
    ),
    jsonb_build_object(
        'create', array['@venue_id->venues.org_id->acts_for[org_id=$]{active}.user_id'],
        'update', array['@venue_id->venues.org_id->acts_for[org_id=$]{active}.user_id'],
        'delete', array['@venue_id->venues.org_id->acts_for[org_id=$]{active}.user_id'],
        'view', array[]::text[]
    )
);

-- Register products
SELECT dzql.register_entity(
    'products',
    'name',
    array['name', 'description'],
    '{"owner_org": "organisations"}',
    false,
    '{}',
    jsonb_build_object(
        'ownership', array['@owner_org_id->acts_for[org_id=$]{active}.user_id']
    ),
    jsonb_build_object(
        'create', array['@owner_org_id->acts_for[org_id=$]{active}.user_id'],
        'update', array['@owner_org_id->acts_for[org_id=$]{active}.user_id'],
        'delete', array['@owner_org_id->acts_for[org_id=$]{active}.user_id'],
        'view', array[]::text[]
    )
);

-- Register modules
SELECT dzql.register_entity(
    'modules',
    'name',
    array['name', 'dimensions'],
    '{"contractor_org": "organisations"}',
    false,
    '{}',
    jsonb_build_object(
        'ownership', array['@contractor_org_id->acts_for[org_id=$]{active}.user_id']
    ),
    jsonb_build_object(
        'create', array['@contractor_org_id->acts_for[org_id=$]{active}.user_id'],
        'update', array['@contractor_org_id->acts_for[org_id=$]{active}.user_id'],
        'delete', array['@contractor_org_id->acts_for[org_id=$]{active}.user_id'],
        'view', array[]::text[]
    )
);

-- Register occasions
SELECT dzql.register_entity(
    'occasions',
    'name',
    array['name'],
    '{"venue": "venues"}',
    false,
    '{}',
    jsonb_build_object(
        'ownership', array['@venue_id->venues.org_id->acts_for[org_id=$]{active}.user_id'],
        'promotion', array['@id->promotion_rights[occasion_id=$]{active}.promoter_id->acts_for[org_id=$]{active}.user_id']
    ),
    jsonb_build_object(
        'create', array['@venue_id->venues.org_id->acts_for[org_id=$]{active}.user_id'],
        'update', array[
            '@venue_id->venues.org_id->acts_for[org_id=$]{active}.user_id',
            '@id->promotion_rights[occasion_id=$]{active}.promoter_id->acts_for[org_id=$]{active}.user_id'
        ],
        'delete', array['@venue_id->venues.org_id->acts_for[org_id=$]{active}.user_id'],
        'view', array[]::text[]
    )
);

-- Register packages
SELECT dzql.register_entity(
    'packages',
    'name',
    array['name'],
    '{"occasion": "occasions", "owner": "organisations", "promoter": "organisations", "sponsor": "organisations"}',
    false,
    '{}',
    jsonb_build_object(
        'ownership', array['@owner_id->acts_for[org_id=$]{active}.user_id'],
        'promotion', array['@promoter_id->acts_for[org_id=$]{active}.user_id'],
        'sponsorship', array['@sponsor_id->acts_for[org_id=$]{active}.user_id']
    ),
    jsonb_build_object(
        'create', array[
            '@owner_id->acts_for[org_id=$]{active}.user_id',
            '@promoter_id->acts_for[org_id=$]{active}.user_id'
        ],
        'update', array[
            '@owner_id->acts_for[org_id=$]{active}.user_id',
            '@promoter_id->acts_for[org_id=$]{active}.user_id',
            '@sponsor_id->acts_for[org_id=$]{active}.user_id'
        ],
        'delete', array['@owner_id->acts_for[org_id=$]{active}.user_id'],
        'view', array[
            '@owner_id->acts_for[org_id=$]{active}.user_id',
            '@promoter_id->acts_for[org_id=$]{active}.user_id',
            '@sponsor_id->acts_for[org_id=$]{active}.user_id',
            '@id->package_proposals[package_id=$].proposed_to_id->acts_for[org_id=$]{active}.user_id'
        ]
    )
);

-- Register allocations
SELECT dzql.register_entity(
    'allocations',
    'id',
    array['site_id'],
    '{"package": "packages", "site": "sites"}',
    false,
    '{}',
    jsonb_build_object(
        'ownership', array['@site_id->sites.venue_id->venues.org_id->acts_for[org_id=$]{active}.user_id'],
        'package', array[
            '@package_id->packages.owner_id->acts_for[org_id=$]{active}.user_id',
            '@package_id->packages.promoter_id->acts_for[org_id=$]{active}.user_id',
            '@package_id->packages.sponsor_id->acts_for[org_id=$]{active}.user_id'
        ],
        'contractor', array[
            '@site_id->sites.venue_id->contractor_rights[venue_id=$]{active}.contractor_org_id->acts_for[org_id=$]{active}.user_id'
        ]
    ),
    jsonb_build_object(
        'create', array[
            '@package_id->packages.owner_id->acts_for[org_id=$]{active}.user_id',
            '@package_id->packages.promoter_id->acts_for[org_id=$]{active}.user_id'
        ],
        'update', array[
            '@package_id->packages.owner_id->acts_for[org_id=$]{active}.user_id',
            '@package_id->packages.promoter_id->acts_for[org_id=$]{active}.user_id',
            '@package_id->packages.sponsor_id->acts_for[org_id=$]{active}.user_id'
        ],
        'delete', array[
            '@package_id->packages.owner_id->acts_for[org_id=$]{active}.user_id',
            '@package_id->packages.promoter_id->acts_for[org_id=$]{active}.user_id'
        ],
        'view', array[]::text[]
    )
);

-- Register contractor_rights (temporal)
SELECT dzql.register_entity(
    'contractor_rights',
    'contractor_org_id',
    array['contractor_org_id', 'venue_id', 'valid_from'],
    '{"contractor_org": "organisations", "granted_by": "organisations", "venue": "venues"}',
    false,
    '{"valid_from": "valid_from", "valid_to": "valid_to"}',
    jsonb_build_object(
        'contractor', array['@contractor_org_id->acts_for[org_id=$]{active}.user_id'],
        'grantor', array['@granted_by_id->acts_for[org_id=$]{active}.user_id']
    ),
    jsonb_build_object(
        'create', array['@granted_by_id->acts_for[org_id=$]{active}.user_id'],
        'update', array['@granted_by_id->acts_for[org_id=$]{active}.user_id'],
        'delete', array['@granted_by_id->acts_for[org_id=$]{active}.user_id'],
        'view', array['@contractor_org_id->acts_for[org_id=$]{active}.user_id', '@granted_by_id->acts_for[org_id=$]{active}.user_id']
    )
);

-- Register promotion_rights (temporal)
SELECT dzql.register_entity(
    'promotion_rights',
    'promoter_id',
    array['owner_id', 'promoter_id'],
    '{"owner": "organisations", "promoter": "organisations", "occasion": "occasions"}',
    false,
    '{"valid_from": "valid_from", "valid_to": "valid_to"}',
    jsonb_build_object(
        'owner', array['@owner_id->acts_for[org_id=$]{active}.user_id'],
        'promoter', array['@promoter_id->acts_for[org_id=$]{active}.user_id']
    ),
    jsonb_build_object(
        'create', array['@owner_id->acts_for[org_id=$]{active}.user_id'],
        'update', array['@owner_id->acts_for[org_id=$]{active}.user_id'],
        'delete', array['@owner_id->acts_for[org_id=$]{active}.user_id'],
        'view', array[]::text[]
    )
);

-- Register campaigns
SELECT dzql.register_entity(
    'campaigns',
    'name',
    array['name', 'description'],
    '{"sponsor": "organisations"}',
    false,
    '{}',
    jsonb_build_object(
        'sponsorship', array['@sponsor_id->acts_for[org_id=$]{active}.user_id']
    ),
    jsonb_build_object(
        'create', array['@sponsor_id->acts_for[org_id=$]{active}.user_id'],
        'update', array['@sponsor_id->acts_for[org_id=$]{active}.user_id'],
        'delete', array['@sponsor_id->acts_for[org_id=$]{active}.user_id'],
        'view', array['@sponsor_id->acts_for[org_id=$]{active}.user_id']
    )
);

-- Register allocation_options
SELECT dzql.register_entity(
    'allocation_options',
    'id',
    array['contractor_notes'],
    '{"allocation": "allocations", "module": "modules", "face": "faces", "product": "products"}',
    false,
    '{}',
    jsonb_build_object(
        'contractor', array['@module_id->modules.contractor_org_id->acts_for[org_id=$]{active}.user_id'],
        'sponsor', array['@allocation_id->allocations.package_id->packages.sponsor_id->acts_for[org_id=$]{active}.user_id']
    ),
    jsonb_build_object(
        'create', array['@module_id->modules.contractor_org_id->acts_for[org_id=$]{active}.user_id'],
        'update', array['@module_id->modules.contractor_org_id->acts_for[org_id=$]{active}.user_id'],
        'delete', array['@module_id->modules.contractor_org_id->acts_for[org_id=$]{active}.user_id'],
        'view', array[
            '@module_id->modules.contractor_org_id->acts_for[org_id=$]{active}.user_id',
            '@allocation_id->allocations.package_id->packages.sponsor_id->acts_for[org_id=$]{active}.user_id'
        ]
    )
);

-- Register sponsor_selections
SELECT dzql.register_entity(
    'sponsor_selections',
    'allocation_id',
    array['sponsor_notes'],
    '{"allocation": "allocations", "option": "allocation_options"}',
    false,
    '{}',
    jsonb_build_object(
        'sponsor', array['@allocation_id->allocations.package_id->packages.sponsor_id->acts_for[org_id=$]{active}.user_id'],
        'contractor', array['@option_id->allocation_options.module_id->modules.contractor_org_id->acts_for[org_id=$]{active}.user_id']
    ),
    jsonb_build_object(
        'create', array['@allocation_id->allocations.package_id->packages.sponsor_id->acts_for[org_id=$]{active}.user_id'],
        'update', array['@allocation_id->allocations.package_id->packages.sponsor_id->acts_for[org_id=$]{active}.user_id'],
        'delete', array['@allocation_id->allocations.package_id->packages.sponsor_id->acts_for[org_id=$]{active}.user_id'],
        'view', array[
            '@allocation_id->allocations.package_id->packages.sponsor_id->acts_for[org_id=$]{active}.user_id',
            '@option_id->allocation_options.module_id->modules.contractor_org_id->acts_for[org_id=$]{active}.user_id'
        ]
    )
);

-- Register inventory_allocations
SELECT dzql.register_entity(
    'inventory_allocations',
    'id',
    array['condition_notes'],
    '{"sponsor_selection": "sponsor_selections", "module_item": "module_items", "product_item": "product_items"}',
    false,
    '{}',
    jsonb_build_object(
        'sponsor', array['@sponsor_selection_id->sponsor_selections.allocation_id->allocations.package_id->packages.sponsor_id->acts_for[org_id=$]{active}.user_id'],
        'contractor', array[
            '@module_item_id->module_items.module_id->modules.contractor_org_id->acts_for[org_id=$]{active}.user_id',
            '@product_item_id->product_items.contractor_org_id->acts_for[org_id=$]{active}.user_id'
        ]
    ),
    jsonb_build_object(
        'create', array[
            '@sponsor_selection_id->sponsor_selections.allocation_id->allocations.package_id->packages.sponsor_id->acts_for[org_id=$]{active}.user_id',
            '@module_item_id->module_items.module_id->modules.contractor_org_id->acts_for[org_id=$]{active}.user_id'
        ],
        'update', array[
            '@sponsor_selection_id->sponsor_selections.allocation_id->allocations.package_id->packages.sponsor_id->acts_for[org_id=$]{active}.user_id',
            '@module_item_id->module_items.module_id->modules.contractor_org_id->acts_for[org_id=$]{active}.user_id'
        ],
        'delete', array[
            '@sponsor_selection_id->sponsor_selections.allocation_id->allocations.package_id->packages.sponsor_id->acts_for[org_id=$]{active}.user_id',
            '@module_item_id->module_items.module_id->modules.contractor_org_id->acts_for[org_id=$]{active}.user_id'
        ],
        'view', array[]::text[]
    )
);

-- Register tasks
SELECT dzql.register_entity(
    'tasks',
    'name',
    array['name', 'description'],
    '{"assigned_to": "users", "team": "teams", "work_window": "work_windows", "completed_by": "users"}',
    false,
    '{}',
    jsonb_build_object(
        'assigned', array['@assigned_to'],
        'team', array['@team_id->team_members[team_id=$].user_id']
    ),
    jsonb_build_object(
        'create', array['@team_id->teams.contractor_org_id->acts_for[org_id=$]{active}.user_id'],
        'update', array[
            '@team_id->teams.contractor_org_id->acts_for[org_id=$]{active}.user_id',
            '@assigned_to'
        ],
        'delete', array['@team_id->teams.contractor_org_id->acts_for[org_id=$]{active}.user_id'],
        'view', array[]::text[]
    )
);

-- Register teams
SELECT dzql.register_entity(
    'teams',
    'name',
    array['name'],
    '{"contractor_org": "organisations", "occasion": "occasions"}',
    false,
    '{}',
    jsonb_build_object(
        'contractor', array['@contractor_org_id->acts_for[org_id=$]{active}.user_id'],
        'members', array['@id->team_members[team_id=$].user_id']
    ),
    jsonb_build_object(
        'create', array['@contractor_org_id->acts_for[org_id=$]{active}.user_id'],
        'update', array['@contractor_org_id->acts_for[org_id=$]{active}.user_id'],
        'delete', array['@contractor_org_id->acts_for[org_id=$]{active}.user_id'],
        'view', array[
            '@contractor_org_id->acts_for[org_id=$]{active}.user_id',
            '@id->team_members[team_id=$].user_id'
        ]
    )
);

-- Register sponsor_briefs
SELECT dzql.register_entity(
    'sponsor_briefs',
    'sponsor_id',
    array['notes', 'plan_assessment_notes', 'execution_assessment_notes'],
    '{"sponsor": "organisations", "occasion": "occasions", "contractor_org": "organisations"}',
    false,
    '{}',
    jsonb_build_object(
        'sponsor', array['@sponsor_id->acts_for[org_id=$]{active}.user_id'],
        'contractor', array['@contractor_org_id->acts_for[org_id=$]{active}.user_id']
    ),
    jsonb_build_object(
        'create', array['@sponsor_id->acts_for[org_id=$]{active}.user_id'],
        'update', array[
            '@sponsor_id->acts_for[org_id=$]{active}.user_id',
            '@contractor_org_id->acts_for[org_id=$]{active}.user_id'
        ],
        'delete', array['@sponsor_id->acts_for[org_id=$]{active}.user_id'],
        'view', array[
            '@sponsor_id->acts_for[org_id=$]{active}.user_id',
            '@contractor_org_id->acts_for[org_id=$]{active}.user_id'
        ]
    )
);

-- Register module_items
SELECT dzql.register_entity(
    'module_items',
    'barcode',
    array['barcode', 'location', 'notes'],
    '{"module": "modules"}',
    false,
    '{}',
    jsonb_build_object(
        'contractor', array['@module_id->modules.contractor_org_id->acts_for[org_id=$]{active}.user_id']
    ),
    jsonb_build_object(
        'create', array['@module_id->modules.contractor_org_id->acts_for[org_id=$]{active}.user_id'],
        'update', array['@module_id->modules.contractor_org_id->acts_for[org_id=$]{active}.user_id'],
        'delete', array['@module_id->modules.contractor_org_id->acts_for[org_id=$]{active}.user_id'],
        'view', array[]::text[]
    )
);

-- Register product_items
SELECT dzql.register_entity(
    'product_items',
    'barcode',
    array['barcode', 'location', 'notes'],
    '{"product": "products", "sponsor": "organisations", "contractor_org": "organisations"}',
    false,
    '{}',
    jsonb_build_object(
        'sponsor', array['@sponsor_id->acts_for[org_id=$]{active}.user_id'],
        'contractor', array['@contractor_org_id->acts_for[org_id=$]{active}.user_id']
    ),
    jsonb_build_object(
        'create', array['@contractor_org_id->acts_for[org_id=$]{active}.user_id'],
        'update', array[
            '@sponsor_id->acts_for[org_id=$]{active}.user_id',
            '@contractor_org_id->acts_for[org_id=$]{active}.user_id'
        ],
        'delete', array['@contractor_org_id->acts_for[org_id=$]{active}.user_id'],
        'view', array[
            '@sponsor_id->acts_for[org_id=$]{active}.user_id',
            '@contractor_org_id->acts_for[org_id=$]{active}.user_id'
        ]
    )
);

-- Register site_info
SELECT dzql.register_entity(
    'site_info',
    'site_id',
    array['dimensions', 'notes'],
    '{"site": "sites", "contractor_org": "organisations"}',
    false,
    '{}',
    jsonb_build_object(
        'contractor', array['@contractor_org_id->acts_for[org_id=$]{active}.user_id'],
        'venue_owner', array['@site_id->sites.venue_id->venues.org_id->acts_for[org_id=$]{active}.user_id']
    ),
    jsonb_build_object(
        'create', array['@contractor_org_id->acts_for[org_id=$]{active}.user_id'],
        'update', array['@contractor_org_id->acts_for[org_id=$]{active}.user_id'],
        'delete', array['@contractor_org_id->acts_for[org_id=$]{active}.user_id'],
        'view', array[]::text[]
    )
);

-- Register faces
SELECT dzql.register_entity(
    'faces',
    'name',
    array['name'],
    '{"module": "modules"}',
    false,
    '{}',
    jsonb_build_object(
        'contractor', array['@module_id->modules.contractor_org_id->acts_for[org_id=$]{active}.user_id']
    ),
    jsonb_build_object(
        'create', array['@module_id->modules.contractor_org_id->acts_for[org_id=$]{active}.user_id'],
        'update', array['@module_id->modules.contractor_org_id->acts_for[org_id=$]{active}.user_id'],
        'delete', array['@module_id->modules.contractor_org_id->acts_for[org_id=$]{active}.user_id'],
        'view', array[]::text[]
    )
);

-- Register performance
SELECT dzql.register_entity(
    'performance',
    'site_id',
    array[]::text[],
    '{"site": "sites", "face": "faces", "product": "products"}',
    false,
    '{}',
    jsonb_build_object(
        'contractor', array['@face_id->faces.module_id->modules.contractor_org_id->acts_for[org_id=$]{active}.user_id']
    ),
    jsonb_build_object(
        'create', array['@face_id->faces.module_id->modules.contractor_org_id->acts_for[org_id=$]{active}.user_id'],
        'update', array['@face_id->faces.module_id->modules.contractor_org_id->acts_for[org_id=$]{active}.user_id'],
        'delete', array['@face_id->faces.module_id->modules.contractor_org_id->acts_for[org_id=$]{active}.user_id'],
        'view', array[]::text[]
    )
);

-- Register package_proposals
SELECT dzql.register_entity(
    'package_proposals',
    'package_id',
    array['notes'],
    '{"package": "packages", "proposed_by": "organisations", "proposed_to": "organisations"}',
    false,
    '{}',
    jsonb_build_object(
        'proposer', array['@proposed_by_id->acts_for[org_id=$]{active}.user_id'],
        'recipient', array['@proposed_to_id->acts_for[org_id=$]{active}.user_id']
    ),
    jsonb_build_object(
        'create', array['@proposed_by_id->acts_for[org_id=$]{active}.user_id'],
        'update', array[
            '@proposed_by_id->acts_for[org_id=$]{active}.user_id',
            '@proposed_to_id->acts_for[org_id=$]{active}.user_id'
        ],
        'delete', array['@proposed_by_id->acts_for[org_id=$]{active}.user_id'],
        'view', array[
            '@proposed_by_id->acts_for[org_id=$]{active}.user_id',
            '@proposed_to_id->acts_for[org_id=$]{active}.user_id'
        ]
    )
);

-- Register work_windows
SELECT dzql.register_entity(
    'work_windows',
    'name',
    array['name'],
    '{"occasion": "occasions"}',
    false,
    '{}',
    jsonb_build_object(
        'venue_owner', array['@occasion_id->occasions.venue_id->venues.org_id->acts_for[org_id=$]{active}.user_id']
    ),
    jsonb_build_object(
        'create', array['@occasion_id->occasions.venue_id->venues.org_id->acts_for[org_id=$]{active}.user_id'],
        'update', array['@occasion_id->occasions.venue_id->venues.org_id->acts_for[org_id=$]{active}.user_id'],
        'delete', array['@occasion_id->occasions.venue_id->venues.org_id->acts_for[org_id=$]{active}.user_id'],
        'view', array[]::text[]
    )
);

-- Register events
SELECT dzql.register_entity(
    'events',
    'name',
    array['name'],
    '{"occasion": "occasions"}',
    false,
    '{}',
    jsonb_build_object(
        'venue_owner', array['@occasion_id->occasions.venue_id->venues.org_id->acts_for[org_id=$]{active}.user_id']
    ),
    jsonb_build_object(
        'create', array['@occasion_id->occasions.venue_id->venues.org_id->acts_for[org_id=$]{active}.user_id'],
        'update', array['@occasion_id->occasions.venue_id->venues.org_id->acts_for[org_id=$]{active}.user_id'],
        'delete', array['@occasion_id->occasions.venue_id->venues.org_id->acts_for[org_id=$]{active}.user_id'],
        'view', array[]::text[]
    )
);

-- Register moments
SELECT dzql.register_entity(
    'moments',
    'name',
    array['name'],
    '{"occasion": "occasions"}',
    false,
    '{}',
    jsonb_build_object(
        'venue_owner', array['@occasion_id->occasions.venue_id->venues.org_id->acts_for[org_id=$]{active}.user_id']
    ),
    jsonb_build_object(
        'create', array['@occasion_id->occasions.venue_id->venues.org_id->acts_for[org_id=$]{active}.user_id'],
        'update', array['@occasion_id->occasions.venue_id->venues.org_id->acts_for[org_id=$]{active}.user_id'],
        'delete', array['@occasion_id->occasions.venue_id->venues.org_id->acts_for[org_id=$]{active}.user_id'],
        'view', array[]::text[]
    )
);

-- Register components
SELECT dzql.register_entity(
    'components',
    'name',
    array['name', 'description', 'specifications'],
    '{}',
    false,
    '{}',
    '{}',
    jsonb_build_object(
        'create', array[]::text[],
        'update', array[]::text[],
        'delete', array[]::text[],
        'view', array[]::text[]
    )
);

-- Register module_task_templates
SELECT dzql.register_entity(
    'module_task_templates',
    'name',
    array['name', 'description', 'required_tools', 'safety_notes'],
    '{"module": "modules"}',
    false,
    '{}',
    jsonb_build_object(
        'contractor', array['@module_id->modules.contractor_org_id->acts_for[org_id=$]{active}.user_id']
    ),
    jsonb_build_object(
        'create', array['@module_id->modules.contractor_org_id->acts_for[org_id=$]{active}.user_id'],
        'update', array['@module_id->modules.contractor_org_id->acts_for[org_id=$]{active}.user_id'],
        'delete', array['@module_id->modules.contractor_org_id->acts_for[org_id=$]{active}.user_id'],
        'view', array[]::text[]
    )
);

-- ===============================================
-- JUNCTION TABLE REGISTRATIONS
-- ===============================================

-- Register site_products
SELECT dzql.register_entity(
    'site_products',
    'site_id',
    array[]::text[],
    '{"site": "sites", "product": "products"}',
    false,
    '{}',
    jsonb_build_object(
        'venue_owner', array['@site_id->sites.venue_id->venues.org_id->acts_for[org_id=$]{active}.user_id'],
        'product_owner', array['@product_id->products.owner_org_id->acts_for[org_id=$]{active}.user_id']
    ),
    jsonb_build_object(
        'create', array['@site_id->sites.venue_id->venues.org_id->acts_for[org_id=$]{active}.user_id'],
        'update', array['@site_id->sites.venue_id->venues.org_id->acts_for[org_id=$]{active}.user_id'],
        'delete', array['@site_id->sites.venue_id->venues.org_id->acts_for[org_id=$]{active}.user_id'],
        'view', array[]::text[]
    )
);

-- Register site_modules
SELECT dzql.register_entity(
    'site_modules',
    'site_id',
    array[]::text[],
    '{"site": "sites", "module": "modules"}',
    false,
    '{}',
    jsonb_build_object(
        'contractor', array['@module_id->modules.contractor_org_id->acts_for[org_id=$]{active}.user_id']
    ),
    jsonb_build_object(
        'create', array['@module_id->modules.contractor_org_id->acts_for[org_id=$]{active}.user_id'],
        'update', array['@module_id->modules.contractor_org_id->acts_for[org_id=$]{active}.user_id'],
        'delete', array['@module_id->modules.contractor_org_id->acts_for[org_id=$]{active}.user_id'],
        'view', array[]::text[]
    )
);

-- Register face_products
SELECT dzql.register_entity(
    'face_products',
    'face_id',
    array[]::text[],
    '{"face": "faces", "product": "products"}',
    false,
    '{}',
    jsonb_build_object(
        'contractor', array['@face_id->faces.module_id->modules.contractor_org_id->acts_for[org_id=$]{active}.user_id']
    ),
    jsonb_build_object(
        'create', array['@face_id->faces.module_id->modules.contractor_org_id->acts_for[org_id=$]{active}.user_id'],
        'update', array['@face_id->faces.module_id->modules.contractor_org_id->acts_for[org_id=$]{active}.user_id'],
        'delete', array['@face_id->faces.module_id->modules.contractor_org_id->acts_for[org_id=$]{active}.user_id'],
        'view', array[]::text[]
    )
);

-- Register module_components
SELECT dzql.register_entity(
    'module_components',
    'module_id',
    array['notes'],
    '{"module": "modules", "component": "components"}',
    false,
    '{}',
    jsonb_build_object(
        'contractor', array['@module_id->modules.contractor_org_id->acts_for[org_id=$]{active}.user_id']
    ),
    jsonb_build_object(
        'create', array['@module_id->modules.contractor_org_id->acts_for[org_id=$]{active}.user_id'],
        'update', array['@module_id->modules.contractor_org_id->acts_for[org_id=$]{active}.user_id'],
        'delete', array['@module_id->modules.contractor_org_id->acts_for[org_id=$]{active}.user_id'],
        'view', array[]::text[]
    )
);

-- Register campaign_packages
SELECT dzql.register_entity(
    'campaign_packages',
    'campaign_id',
    array[]::text[],
    '{"campaign": "campaigns", "package": "packages"}',
    false,
    '{}',
    jsonb_build_object(
        'sponsor', array['@campaign_id->campaigns.sponsor_id->acts_for[org_id=$]{active}.user_id']
    ),
    jsonb_build_object(
        'create', array['@campaign_id->campaigns.sponsor_id->acts_for[org_id=$]{active}.user_id'],
        'update', array['@campaign_id->campaigns.sponsor_id->acts_for[org_id=$]{active}.user_id'],
        'delete', array['@campaign_id->campaigns.sponsor_id->acts_for[org_id=$]{active}.user_id'],
        'view', array['@campaign_id->campaigns.sponsor_id->acts_for[org_id=$]{active}.user_id']
    )
);

-- Register team_members
SELECT dzql.register_entity(
    'team_members',
    'team_id',
    array[]::text[],
    '{"team": "teams", "user": "users"}',
    false,
    '{}',
    jsonb_build_object(
        'contractor', array['@team_id->teams.contractor_org_id->acts_for[org_id=$]{active}.user_id'],
        'member', array['@user_id']
    ),
    jsonb_build_object(
        'create', array['@team_id->teams.contractor_org_id->acts_for[org_id=$]{active}.user_id'],
        'update', array['@team_id->teams.contractor_org_id->acts_for[org_id=$]{active}.user_id'],
        'delete', array['@team_id->teams.contractor_org_id->acts_for[org_id=$]{active}.user_id'],
        'view', array[
            '@team_id->teams.contractor_org_id->acts_for[org_id=$]{active}.user_id',
            '@user_id'
        ]
    )
);

-- Register task_dependencies
SELECT dzql.register_entity(
    'task_dependencies',
    'task_id',
    array[]::text[],
    '{"task": "tasks", "depends_on": "tasks"}',
    false,
    '{}',
    '{}',
    jsonb_build_object(
        'create', array['@task_id->tasks.team_id->teams.contractor_org_id->acts_for[org_id=$]{active}.user_id'],
        'update', array['@task_id->tasks.team_id->teams.contractor_org_id->acts_for[org_id=$]{active}.user_id'],
        'delete', array['@task_id->tasks.team_id->teams.contractor_org_id->acts_for[org_id=$]{active}.user_id'],
        'view', array[]::text[]
    )
);

-- Register task_resources
SELECT dzql.register_entity(
    'task_resources',
    'task_id',
    array[]::text[],
    '{"task": "tasks", "inventory_allocation": "inventory_allocations"}',
    false,
    '{}',
    '{}',
    jsonb_build_object(
        'create', array['@task_id->tasks.team_id->teams.contractor_org_id->acts_for[org_id=$]{active}.user_id'],
        'update', array['@task_id->tasks.team_id->teams.contractor_org_id->acts_for[org_id=$]{active}.user_id'],
        'delete', array['@task_id->tasks.team_id->teams.contractor_org_id->acts_for[org_id=$]{active}.user_id'],
        'view', array[]::text[]
    )
);

-- Register task_template_dependencies
SELECT dzql.register_entity(
    'task_template_dependencies',
    'template_id',
    array[]::text[],
    '{"template": "module_task_templates", "depends_on": "module_task_templates"}',
    false,
    '{}',
    '{}',
    jsonb_build_object(
        'create', array['@template_id->module_task_templates.module_id->modules.contractor_org_id->acts_for[org_id=$]{active}.user_id'],
        'update', array['@template_id->module_task_templates.module_id->modules.contractor_org_id->acts_for[org_id=$]{active}.user_id'],
        'delete', array['@template_id->module_task_templates.module_id->modules.contractor_org_id->acts_for[org_id=$]{active}.user_id'],
        'view', array[]::text[]
    )
);

-- Register task_template_components
SELECT dzql.register_entity(
    'task_template_components',
    'template_id',
    array[]::text[],
    '{"template": "module_task_templates", "component": "components"}',
    false,
    '{}',
    '{}',
    jsonb_build_object(
        'create', array['@template_id->module_task_templates.module_id->modules.contractor_org_id->acts_for[org_id=$]{active}.user_id'],
        'update', array['@template_id->module_task_templates.module_id->modules.contractor_org_id->acts_for[org_id=$]{active}.user_id'],
        'delete', array['@template_id->module_task_templates.module_id->modules.contractor_org_id->acts_for[org_id=$]{active}.user_id'],
        'view', array[]::text[]
    )
);


-- === Test User Creation Removed ===
-- Tests now create their own users dynamically
-- This keeps the database clean for testing
