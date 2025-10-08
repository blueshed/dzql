
-- =====================================================================
-- DZQL Bootstrap Skeleton for Venue Logistics with Emergent Complexity
-- =====================================================================
-- This file is designed to be adapted to your local DZQL build.
-- It sets up:
--   • Relational core entities
--   • JSONB-based flexible attributes (params, geom, BOM, tasks)
--   • Temporal relationships (valid_from/valid_to)
--   • Scenario overlays (what-if)
--   • Batch instantiation (50 flags, etc.)
--   • Registration stubs for DZQL (adjust to your exact DSL)
--
-- Conventions:
--   • Application schema: app
--   • DZQL schema assumed present as: dzql
--   • Replace any "<<<...>>>" placeholders with your values.
-- =====================================================================

create schema if not exists app;

-- ----------
-- IDENTITIES
-- ----------

create table if not exists app.organisations (
  id           bigserial primary key,
  name         text not null,
  slug         text unique,
  meta         jsonb not null default '{}'
);

create table if not exists app.people (
  id           bigserial primary key,
  display_name text not null,
  email        text unique,
  meta         jsonb not null default '{}'
);

-- People act for organisations (temporal membership/role)
create table if not exists app.acts_for (
  id               bigserial primary key,
  person_id        bigint not null references app.people(id),
  organisation_id  bigint not null references app.organisations(id),
  role             text,
  valid_from       timestamptz not null default now(),
  valid_to         timestamptz,
  meta             jsonb not null default '{}'
);
create index if not exists acts_for_org_time_idx on app.acts_for(organisation_id, valid_from, valid_to);
create index if not exists acts_for_person_time_idx on app.acts_for(person_id, valid_from, valid_to);

-- ------
-- VENUES
-- ------

create table if not exists app.venues (
  id               bigserial primary key,
  organisation_id  bigint references app.organisations(id),
  name             text not null,
  location         jsonb,           -- {lat, lng, address, ...}
  meta             jsonb not null default '{}'
);

-- Area tree under a venue (e.g., Entrance, Concourse, North Stand)
-- If you prefer ltree, enable extension and add path; here we keep it simple.
create table if not exists app.areas (
  id         bigserial primary key,
  venue_id   bigint not null references app.venues(id) on delete cascade,
  parent_id  bigint references app.areas(id),
  name       text not null,
  meta       jsonb not null default '{}'
);
create index if not exists areas_venue_idx on app.areas(venue_id);
create index if not exists areas_parent_idx on app.areas(parent_id);

-- Sites live within Areas
create table if not exists app.sites (
  id        bigserial primary key,
  area_id   bigint not null references app.areas(id) on delete cascade,
  name      text not null,
  geom      jsonb,          -- anchor points / location geometry
  capacity  jsonb,          -- dimensions, faces_count, wind_rating, etc.
  meta      jsonb not null default '{}'
);
create index if not exists sites_area_idx on app.sites(area_id);

-- -------------------
-- MODULES & TEMPLATES
-- -------------------

-- Canonical recipes re-used across instances (e.g., arch, flagpole)
create table if not exists app.module_templates (
  id             bigserial primary key,
  key            text unique not null,  -- 'arch', 'flagpole'
  label          text not null,
  params_schema  jsonb,                 -- JSON Schema for 'params'
  faces_schema   jsonb,                 -- JSON Schema for 'faces'
  bom            jsonb,                 -- Bill of Materials (abstract)
  task_recipe    jsonb,                 -- [{name, role, minutes, depends_on?}, ...]
  meta           jsonb not null default '{}'
);

-- Concrete placement of a template at a site (temporal)
create table if not exists app.module_instances (
  id             bigserial primary key,
  site_id        bigint not null references app.sites(id) on delete cascade,
  template_id    bigint not null references app.module_templates(id),
  params         jsonb not null default '{}',  -- concrete parameterization
  faces          jsonb,                         -- resolved faces for this instance
  state          text not null default 'planned', -- planned/installed/removed
  valid_from     timestamptz not null default now(),
  valid_to       timestamptz,
  meta           jsonb not null default '{}'
);
create index if not exists module_instances_site_idx on app.module_instances(site_id);
create index if not exists module_instances_template_idx on app.module_instances(template_id);

-- Batch (e.g., "50 flags" in one go). Expansion is automated by a helper fn.
create table if not exists app.module_batches (
  id             bigserial primary key,
  site_id        bigint not null references app.sites(id) on delete cascade,
  template_id    bigint not null references app.module_templates(id),
  count          int not null check (count > 0),
  params         jsonb not null default '{}',
  meta           jsonb not null default '{}'
);

-- ----------
-- INVENTORY
-- ----------

create table if not exists app.products (
  id       bigserial primary key,
  sku      text unique,
  label    text not null,
  dims     jsonb,         -- {w, h, d, weight, ...}
  vendor   jsonb,         -- {name, url, part_no, ...}
  meta     jsonb not null default '{}'
);

create table if not exists app.stock_items (
  id          bigserial primary key,
  product_id  bigint not null references app.products(id),
  org_id      bigint references app.organisations(id),
  serial      text,
  status      text not null default 'in_stock', -- in_stock / reserved / in_use / maintenance
  meta        jsonb not null default '{}'
);
create index if not exists stock_product_idx on app.stock_items(product_id);
create index if not exists stock_org_idx on app.stock_items(org_id);

-- ---------
-- OCCASIONS
-- ---------

create table if not exists app.occasions (
  id         bigserial primary key,
  venue_id   bigint not null references app.venues(id),
  name       text not null,
  starts_at  timestamptz,
  ends_at    timestamptz,
  meta       jsonb not null default '{}'
);
create index if not exists occasions_venue_idx on app.occasions(venue_id);

create table if not exists app.sponsors (
  id               bigserial primary key,
  organisation_id  bigint references app.organisations(id),
  name             text not null,
  meta             jsonb not null default '{}'
);

-- Allocation of a site (and optionally module instance) to a sponsor for an occasion
create table if not exists app.allocations (
  id                  bigserial primary key,
  occasion_id         bigint not null references app.occasions(id) on delete cascade,
  site_id             bigint not null references app.sites(id),
  sponsor_id          bigint not null references app.sponsors(id),
  module_instance_id  bigint references app.module_instances(id),
  valid_from          timestamptz not null default now(),
  valid_to            timestamptz,
  meta                jsonb not null default '{}'
);
create index if not exists allocations_occ_idx on app.allocations(occasion_id);
create index if not exists allocations_site_idx on app.allocations(site_id);
create index if not exists allocations_sponsor_idx on app.allocations(sponsor_id);

-- -------------
-- WORK ORDERS / TASKS
-- -------------

create table if not exists app.work_orders (
  id                 bigserial primary key,
  occasion_id        bigint references app.occasions(id),
  module_instance_id bigint references app.module_instances(id),
  contractor_org_id  bigint references app.organisations(id),
  status             text not null default 'planned', -- planned/assigned/in_progress/done
  meta               jsonb not null default '{}'
);

create table if not exists app.tasks (
  id               bigserial primary key,
  work_order_id    bigint not null references app.work_orders(id) on delete cascade,
  name             text not null,
  role             text,             -- e.g., rigger, electrician
  estimated_minutes int,
  depends_on       bigint[] not null default '{}',
  scheduled_start  timestamptz,
  scheduled_end    timestamptz,
  state            text not null default 'todo', -- todo/doing/done/blocked
  meta             jsonb not null default '{}'
);
create index if not exists tasks_wo_idx on app.tasks(work_order_id);

-- -----------------------------
-- SCENARIOS (WHAT-IF OVERLAYS)
-- -----------------------------

create table if not exists app.scenarios (
  id           bigserial primary key,
  occasion_id  bigint references app.occasions(id),
  sponsor_id   bigint references app.sponsors(id),
  label        text not null,
  is_default   boolean not null default false,
  meta         jsonb not null default '{}'
);

-- Target is a string "entity:id" (e.g., "module_instance:123", "site:456")
-- patch is a JSON Merge Patch (RFC 7396) or your preferred diff format.
create table if not exists app.scenario_overrides (
  id           bigserial primary key,
  scenario_id  bigint not null references app.scenarios(id) on delete cascade,
  target       text not null,
  patch        jsonb not null
);
create index if not exists scenario_overrides_scen_idx on app.scenario_overrides(scenario_id);

-- ---------------------------------------------------
-- Helper: shallow jsonb merge (replace with your deep)
-- ---------------------------------------------------
create or replace function dzql.jsonb_merge(a jsonb, b jsonb)
returns jsonb language sql immutable as $$
  select coalesce(a, '{}'::jsonb) || coalesce(b, '{}'::jsonb);
$$;

-- ----------------------------------------------------------
-- View: Effective module_instance params under a scenario
-- (Replace with deep-merge if your DZQL provides one.)
-- ----------------------------------------------------------
create or replace view app.v_effective_module_params as
select
  mi.id                       as module_instance_id,
  s.id                        as scenario_id,
  dzql.jsonb_merge(mi.params,
     coalesce(so.patch, '{}'::jsonb)
  )                           as effective_params
from app.module_instances mi
left join app.scenarios s
  on s.occasion_id in (
       select o.id
       from app.occasions o
       where o.venue_id = (
         select a.venue_id from app.areas a
         join app.sites si on si.area_id = a.id
         where si.id = mi.site_id limit 1
       )
     )
left join app.scenario_overrides so
  on so.scenario_id = s.id
 and so.target = ('module_instance:' || mi.id);

-- ------------------------------------------------------
-- Function: expand a batch into N module_instances
-- ------------------------------------------------------
create or replace function app.instantiate_batch(batch_id bigint)
returns void language plpgsql as $$
declare
  b app.module_batches%rowtype;
  i int;
begin
  select * into b from app.module_batches where id = batch_id;
  if not found then
    raise exception 'module_batches % not found', batch_id;
  end if;

  for i in 1..b.count loop
    insert into app.module_instances(site_id, template_id, params)
    values (b.site_id, b.template_id, coalesce(b.params, '{}'::jsonb));
  end loop;
end
$$;

-- ================================================
-- DZQL REGISTRATION STUBS (adjust to your DSL)
-- ================================================
-- You may register entities using either a function or by inserting into a
-- registry table. Below are **two** illustrative approaches. Delete the one
-- you don't use and adapt names/columns to your build.

-- A) Functional style (example)
-- NOTE: Replace dzql.register_entity, dzql.add_graph_rule, etc. with your actual names.

-- Organisations
-- select dzql.register_entity(
--   'organisations',
--   jsonb_build_object(
--     'schema', 'app',
--     'table',  'organisations',
--     'pk',     'id',
--     'operations', array['get','save','delete','lookup','search'],
--     'search', jsonb_build_object('text', array['name','slug']),
--     'temporal', false,
--     'notify_path', $$ select $new.id $$,
--     'permission_path', $$
--       select p.id as person_id
--       from app.acts_for af
--       join app.people p on p.id = af.person_id
--       where af.organisation_id = $row.id
--         and tstzrange(af.valid_from, coalesce(af.valid_to, 'infinity')) @> now()
--     $$
--   )
-- );

-- Venues (containment under organisations)
-- select dzql.register_entity(
--   'venues',
--   jsonb_build_object(
--     'schema','app','table','venues','pk','id','operations',array['get','save','delete','lookup','search'],
--     'fks', jsonb_build_object('organisation_id', 'organisations.id'),
--     'temporal', false
--   )
-- );
-- select dzql.add_graph_rule('venues','organisation_id','organisations','id','containment');

-- Areas (tree under venues)
-- select dzql.register_entity('areas', jsonb_build_object('schema','app','table','areas','pk','id','operations',array['get','save','delete','lookup','search'],'temporal',false));
-- select dzql.add_graph_rule('areas','venue_id','venues','id','containment');
-- select dzql.add_graph_rule('areas','parent_id','areas','id','hierarchy');

-- Sites under areas
-- select dzql.register_entity('sites', jsonb_build_object('schema','app','table','sites','pk','id','operations',array['get','save','delete','lookup','search'],'temporal',false));
-- select dzql.add_graph_rule('sites','area_id','areas','id','containment');

-- Module templates and instances
-- select dzql.register_entity('module_templates', jsonb_build_object('schema','app','table','module_templates','pk','id','operations',array['get','save','delete','lookup','search']));
-- select dzql.register_entity('module_instances', jsonb_build_object('schema','app','table','module_instances','pk','id','operations',array['get','save','delete','lookup','search'],'temporal',true));
-- select dzql.add_graph_rule('module_instances','site_id','sites','id','containment');
-- select dzql.add_graph_rule('module_instances','template_id','module_templates','id','association');

-- Products & Stock
-- select dzql.register_entity('products', jsonb_build_object('schema','app','table','products','pk','id','operations',array['get','save','delete','lookup','search']));
-- select dzql.register_entity('stock_items', jsonb_build_object('schema','app','table','stock_items','pk','id','operations',array['get','save','delete','lookup','search']));

-- Occasions, Sponsors, Allocations
-- select dzql.register_entity('occasions', jsonb_build_object('schema','app','table','occasions','pk','id','operations',array['get','save','delete','lookup','search']));
-- select dzql.register_entity('sponsors', jsonb_build_object('schema','app','table','sponsors','pk','id','operations',array['get','save','delete','lookup','search']));
-- select dzql.register_entity('allocations', jsonb_build_object('schema','app','table','allocations','pk','id','operations',array['get','save','delete','lookup','search'],'temporal',true));
-- select dzql.add_graph_rule('allocations','occasion_id','occasions','id','association');
-- select dzql.add_graph_rule('allocations','site_id','sites','id','association');
-- select dzql.add_graph_rule('allocations','sponsor_id','sponsors','id','association');
-- select dzql.add_graph_rule('allocations','module_instance_id','module_instances','id','association');

-- Work orders & tasks
-- select dzql.register_entity('work_orders', jsonb_build_object('schema','app','table','work_orders','pk','id','operations',array['get','save','delete','lookup','search']));
-- select dzql.register_entity('tasks', jsonb_build_object('schema','app','table','tasks','pk','id','operations',array['get','save','delete','lookup','search']));

-- Permissions/notifications (illustrative)
-- select dzql.add_permission_path('module_instances', $$
--   -- People who act for the venue's org can see/update
--   with chain as (
--     select v.organisation_id
--     from app.module_instances mi
--     join app.sites s  on s.id = mi.site_id
--     join app.areas a  on a.id = s.area_id
--     join app.venues v on v.id = a.venue_id
--     where mi.id = $row.id
--   )
--   select p.id as person_id
--   from chain c
--   join app.acts_for af on af.organisation_id = c.organisation_id
--   join app.people p on p.id = af.person_id
--   where tstzrange(af.valid_from, coalesce(af.valid_to, 'infinity')) @> now()
-- $$);

-- B) Declarative registry table style (example)
-- insert into dzql.entities(entity, schema_name, table_name, pk_name, temporal, search_cols)
-- values
-- ('organisations','app','organisations','id',false, '{name,slug}'),
-- ('venues','app','venues','id',false,'{name}'),
-- ('areas','app','areas','id',false,'{name}'),
-- ('sites','app','sites','id',false,'{name}'),
-- ('module_templates','app','module_templates','id',false,'{label,key}'),
-- ('module_instances','app','module_instances','id',true,'{}'),
-- ('products','app','products','id',false,'{label,sku}'),
-- ('stock_items','app','stock_items','id',false,'{serial}'),
-- ('occasions','app','occasions','id',false,'{name}'),
-- ('sponsors','app','sponsors','id',false,'{name}'),
-- ('allocations','app','allocations','id',true,'{}'),
-- ('work_orders','app','work_orders','id',false,'{}'),
-- ('tasks','app','tasks','id',false,'{name}');

-- insert into dzql.graph_rules(child_entity, child_fk, parent_entity, parent_pk, rule_type)
-- values
-- ('venues','organisation_id','organisations','id','containment'),
-- ('areas','venue_id','venues','id','containment'),
-- ('areas','parent_id','areas','id','hierarchy'),
-- ('sites','area_id','areas','id','containment'),
-- ('module_instances','site_id','sites','id','containment'),
-- ('module_instances','template_id','module_templates','id','association'),
-- ('allocations','occasion_id','occasions','id','association'),
-- ('allocations','site_id','sites','id','association'),
-- ('allocations','sponsor_id','sponsors','id','association'),
-- ('allocations','module_instance_id','module_instances','id','association');

-- ================================================
-- Completeness scoring (progressive disclosure aid)
-- ================================================
create or replace view app.v_completeness as
with venue_bits as (
  select
    v.id,
    (case when v.name is not null then 1 else 0 end) +
    (select (count(*) > 0)::int from app.areas a where a.venue_id = v.id) +
    (select (count(*) > 0)::int from app.sites s
       join app.areas a on a.id = s.area_id
      where a.venue_id = v.id) as score,
    3 as possible
  from app.venues v
)
select 'venue'::text as entity, id, round(100.0 * score / possible) as completeness_pct
from venue_bits;

-- =====================================================================
-- END
-- =====================================================================
