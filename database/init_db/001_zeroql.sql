-- ZeroQL Enhanced Implementation
-- Version 2.0.0
-- Provides nested proxy API, temporal relationships, and standard entity operations

-- === Schema & Meta ===
create schema if not exists zeroql;

create table if not exists zeroql.meta (
  installed_at timestamptz default now(),
  version text not null
);
insert into zeroql.meta(version) values ('2.0.0')
on conflict do nothing;

-- === Entity Configuration ===
create table if not exists zeroql.entities (
  table_name text primary key,
  label_field text not null,             -- field to use for lookup labels
  searchable_fields text[] not null,     -- fields to search in search operations
  fk_includes jsonb default '{}',        -- foreign keys to dereference in get operations
  permissions jsonb default '{}',        -- role-based access control
  soft_delete boolean default false,     -- use deleted_at instead of hard delete
  temporal_fields jsonb default '{}'     -- valid_from/valid_to field names for temporal filtering
);

-- === Registry (allowlist of callable functions) ===
create table if not exists zeroql.registry (
  fn_regproc regproc primary key,
  exposed_name text unique not null,
  min_role text default 'user',
  notes text
);

-- === JSON Helpers ===
create or replace function zeroql.jarr(x anyarray)
returns jsonb language sql immutable as $$
  select coalesce(to_jsonb(x), '[]'::jsonb)
$$;

create or replace function zeroql.j(k text, v jsonb)
returns jsonb language sql immutable as $$
  select jsonb_build_object(k, v)
$$;

create or replace function zeroql.merge(variadic parts jsonb[])
returns jsonb language sql immutable as $$
  select coalesce(jsonb_strip_nulls(jsonb_object_agg(k, v)), '{}'::jsonb)
  from (
    select (t.parts).key as k, (t.parts).value as v
    from (select jsonb_each(coalesce(p,'{}'::jsonb)) parts from unnest(parts) p) t
  ) s
$$;

-- === Temporal Filtering Helper ===
create or replace function zeroql.apply_temporal_filter(
  p_table regclass,
  p_base_query text,
  p_on_date timestamptz default null
) returns text
language plpgsql as $$
declare
  l_config record;
  l_temporal_where text := '';
  l_check_time text;
begin
  select temporal_fields into l_config
  from zeroql.entities
  where table_name = p_table::text;

  if l_config.temporal_fields is not null and l_config.temporal_fields != '{}' then
    -- Use on_date if provided, otherwise use now()
    l_check_time := coalesce(quote_literal(p_on_date), 'now()');

    l_temporal_where := format(' and %I <= %s and (%I > %s or %I is null)',
      l_config.temporal_fields->>'valid_from', l_check_time,
      l_config.temporal_fields->>'valid_to', l_check_time,
      l_config.temporal_fields->>'valid_to'
    );
  end if;

  return p_base_query || l_temporal_where;
end $$;

-- === Describe (introspection) ===
create or replace function zeroql.describe()
returns table(
  exposed_name text, schema_name text, function_name text,
  arg_names text[], arg_types text[], returns_set boolean, return_type text, min_role text
)
language sql stable as $$
select r.exposed_name,
       n.nspname::text as schema_name,
       p.proname::text as function_name,
       p.proargnames as arg_names,
       (select array_agg(format_type(t, null)) from unnest(p.proargtypes) t) as arg_types,
       p.proretset as returns_set,
       format_type(p.prorettype, null) as return_type,
       r.min_role
from zeroql.registry r
join pg_proc p on p.oid = r.fn_regproc
join pg_namespace n on n.oid = p.pronamespace
order by r.exposed_name;
$$;

-- === Legacy Exec Dispatcher (for custom functions) ===
create or replace function zeroql.exec(
  exposed text,
  args jsonb,
  p_user_id int default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  l_r record;
  l_arg_names text[];
  l_arg_types oid[];
  l_call_sql text;
  l_parts text[];
  l_i int;
  l_needs_user boolean := false;
  l_result jsonb;
begin
  select p.oid::regproc as fn_regproc, p.proname, n.nspname, p.proargnames, p.proargtypes::oid[], p.proretset, p.prorettype
    into l_r
  from zeroql.registry reg
  join pg_proc p on p.oid = reg.fn_regproc
  join pg_namespace n on n.oid = p.pronamespace
  where reg.exposed_name = exposed;

  if l_r.fn_regproc is null then
    raise exception 'ZeroQL: unknown function %', exposed using errcode = '42883';
  end if;

  l_arg_names := coalesce(l_r.proargnames, array[]::text[]);
  l_arg_types := l_r.proargtypes;

  l_needs_user := (array_length(l_arg_names,1) >= 1 and l_arg_names[1] = 'p_user_id');

  l_parts := array[]::text[];
  for l_i in 1 .. array_length(l_arg_names,1) loop
    if l_needs_user and l_i = 1 then
      l_parts := l_parts || format('%I => %L', l_arg_names[l_i], p_user_id);
    else
      l_parts := l_parts || format(
        '%I => (%s)::%s',
        l_arg_names[l_i],
        quote_literal(args ->> l_arg_names[l_i]),
        format_type(l_arg_types[l_i], null)
      );
    end if;
  end loop;

  l_call_sql := format('select %I.%I(%s)', l_r.nspname, l_r.proname, array_to_string(l_parts, ', '));

  if l_r.proretset then
    l_call_sql := 'select coalesce(jsonb_agg(x), ''[]''::jsonb) from (' || l_call_sql || ') x';
  else
    if l_r.prorettype = 'record'::regtype then
      l_call_sql := 'select to_jsonb(x) from (' || l_call_sql || ') x';
    else
      l_call_sql := 'select to_jsonb( (' || l_call_sql || ') )';
    end if;
  end if;

  execute l_call_sql into l_result;
  return l_result;
end $$;

-- === Generic Entity Operations ===

-- Generic GET with foreign key dereferencing and temporal filtering
create or replace function zeroql.generic_get(
  p_entity text,
  p_args jsonb,
  p_user_id int
) returns jsonb
language plpgsql
security invoker
as $$
declare
  l_entity_config record;
  l_pk_field text;
  l_pk_value text;
  l_base_query text;
  l_final_query text;
  l_result jsonb;
  l_on_date timestamptz;
begin
  -- Get entity configuration
  select * into l_entity_config from zeroql.entities where table_name = p_entity;

  if l_entity_config is null then
    raise exception 'ZeroQL: entity % not configured', p_entity;
  end if;

  -- Extract primary key (assume 'id' for now, could be enhanced)
  l_pk_field := 'id';
  l_pk_value := p_args ->> ('p_' || p_entity || '_id');
  if l_pk_value is null then
    l_pk_value := p_args ->> 'p_id';
  end if;
  if l_pk_value is null then
    l_pk_value := p_args ->> 'id';
  end if;

  if l_pk_value is null then
    raise exception 'ZeroQL: no primary key provided for entity %', p_entity;
  end if;

  -- Extract on_date for temporal filtering
  l_on_date := (p_args->>'on_date')::timestamptz;

  -- Build base query
  l_base_query := format('select to_jsonb(t.*) from %I t where t.%I = %L',
                       p_entity, l_pk_field, l_pk_value);

  -- Apply temporal filtering if configured
  l_final_query := zeroql.apply_temporal_filter(p_entity::regclass, l_base_query, l_on_date);

  -- Execute query
  execute l_final_query into l_result;

  -- Apply foreign key dereferencing based on fk_includes configuration
  if l_entity_config.fk_includes is not null and jsonb_typeof(l_entity_config.fk_includes) = 'object' then
    l_result := zeroql.dereference_foreign_keys(p_entity, l_result, l_entity_config.fk_includes, l_on_date);
  end if;

  -- TODO: Add permission checking based on permissions configuration

  return coalesce(l_result, '{}'::jsonb);
end $$;

-- Foreign key dereferencing helper function
create or replace function zeroql.dereference_foreign_keys(
  p_entity text,
  p_record jsonb,
  p_fk_includes jsonb,
  p_on_date timestamptz default null
) returns jsonb
language plpgsql
security invoker
as $$
declare
  l_result jsonb := p_record;
  l_fk_key text;
  l_target_table text;
  l_fk_id text;
  l_fk_column text;
  l_label_field text;
  l_label_value text;
  l_related_records jsonb;
  l_query text;
begin
  -- Process each foreign key in the fk_includes configuration
  for l_fk_key, l_target_table in select * from jsonb_each_text(p_fk_includes)
  loop
    if l_fk_key = l_target_table then
      -- One-to-many: include related records (e.g., "sites": "sites")
      -- Find the foreign key column that references this entity
      select kcu.column_name into l_fk_column
      from information_schema.key_column_usage kcu
      join information_schema.table_constraints tc
        on kcu.constraint_name = tc.constraint_name
      join information_schema.constraint_column_usage ccu
        on kcu.constraint_name = ccu.constraint_name
      where tc.constraint_type = 'FOREIGN KEY'
        and kcu.table_name = l_target_table
        and ccu.table_name = p_entity
        and ccu.column_name = 'id'
      limit 1;

      if l_fk_column is null then
        raise exception 'ZeroQL: no foreign key found from % to %', l_target_table, p_entity;
      end if;

      l_query := format(
        'select coalesce(jsonb_agg(to_jsonb(t.*)), ''[]''::jsonb) from %I t where t.%I = %L',
        l_target_table,
        l_fk_column,
        (p_record->>'id')
      );

      execute l_query into l_related_records;
      l_result := l_result || jsonb_build_object(l_fk_key, l_related_records);

    else
      -- One-to-one: dereference to {label, value} format
      l_fk_column := l_fk_key || '_id';
      l_fk_id := p_record->>l_fk_column;

      if l_fk_id is not null then
        -- Get the label field for this target table
        select label_field into l_label_field
        from zeroql.entities
        where table_name = l_target_table;

        if l_label_field is not null then
          l_query := format(
            'select %I from %I where id = %L',
            l_label_field,
            l_target_table,
            l_fk_id
          );

          execute l_query into l_label_value;

          if l_label_value is not null then
            -- Replace the foreign key with {label, value} object
            l_result := l_result || jsonb_build_object(
              l_fk_column,
              jsonb_build_object(
                'label', l_label_value,
                'value', l_fk_id::int
              )
            );
          end if;
        end if;
      end if;
    end if;
  end loop;

  return l_result;
end $$;

-- Generic SAVE with upsert capability
create or replace function zeroql.generic_save(
  p_entity text,
  p_args jsonb,
  p_user_id int
) returns jsonb
language plpgsql
security invoker
as $$
declare
  l_entity_config record;
  l_pk_cols text[];
  l_cols text[];
  l_vals text[];
  l_set_clauses text[];
  l_col_name text;
  l_sql_stmt text;
  l_existing_record jsonb;
  l_merged_data jsonb;
  l_result jsonb;
  l_record_id text;
  l_args_json jsonb;
begin
  -- Ensure p_args is proper JSONB
  l_args_json := p_args::jsonb;

  -- Get entity configuration
  select * into l_entity_config from zeroql.entities where table_name = p_entity;

  if l_entity_config is null then
    raise exception 'ZeroQL: entity % not configured', p_entity;
  end if;

  -- Get primary key columns
  select array_agg(a.attname order by a.attnum)
    into l_pk_cols
  from pg_index i
  join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey)
  where i.indrelid = p_entity::regclass and i.indisprimary;

  if l_pk_cols is null then
    raise exception 'ZeroQL: entity % has no primary key', p_entity;
  end if;

  -- Check if this is an update (has ID) or insert (no ID)
  l_record_id := l_args_json ->> l_pk_cols[1]; -- assume first PK column is the ID

  if l_record_id is not null and l_record_id != '' then
    -- UPDATE: Merge with existing record

    -- Get existing record
    l_sql_stmt := format('SELECT to_jsonb(t.*) FROM %I t WHERE %I = %L',
                      p_entity, l_pk_cols[1], l_record_id);
    execute l_sql_stmt into l_existing_record;

    if l_existing_record is null then
      raise exception 'ZeroQL: record with id % not found in %', l_record_id, p_entity;
    end if;

    -- Merge existing data with new data (new data takes precedence)
    l_merged_data := l_existing_record || l_args_json;

    -- Build SET clauses for UPDATE
    l_set_clauses := array[]::text[];
    for l_col_name in select jsonb_object_keys(l_merged_data)
    loop
      if l_col_name != l_pk_cols[1] then -- don't update the primary key
        l_set_clauses := l_set_clauses || format('%I = %L', l_col_name, l_merged_data ->> l_col_name);
      end if;
    end loop;

    -- Execute UPDATE
    l_sql_stmt := format('UPDATE %I SET %s WHERE %I = %L RETURNING to_jsonb(%I.*)',
                      p_entity,
                      array_to_string(l_set_clauses, ', '),
                      l_pk_cols[1], l_record_id,
                      p_entity);
    execute l_sql_stmt into l_result;

  else
    -- INSERT: Use provided values, let database handle defaults

    l_cols := array[]::text[];
    l_vals := array[]::text[];

    for l_col_name in select jsonb_object_keys(l_args_json)
    loop
      if l_args_json ->> l_col_name is not null and l_args_json ->> l_col_name != '' then
        l_cols := l_cols || quote_ident(l_col_name);
        l_vals := l_vals || quote_literal(l_args_json ->> l_col_name);
      end if;
    end loop;

    if array_length(l_cols, 1) = 0 then
      raise exception 'ZeroQL: no valid columns provided for insert into %', p_entity;
    end if;

    -- Execute INSERT
    l_sql_stmt := format('INSERT INTO %I (%s) VALUES (%s) RETURNING to_jsonb(%I.*)',
                      p_entity,
                      array_to_string(l_cols, ', '),
                      array_to_string(l_vals, ', '),
                      p_entity);
    execute l_sql_stmt into l_result;
  end if;

  -- TODO: Add permission checking
  -- TODO: Add validation logic

  return l_result;
end $$;

-- Generic DELETE with cascading support
create or replace function zeroql.generic_delete(
  p_entity text,
  p_args jsonb,
  p_user_id int
) returns jsonb
language plpgsql
security invoker
as $$
declare
  l_entity_config record;
  l_pk_field text;
  l_pk_value text;
  l_delete_sql text;
  l_result jsonb;
begin
  -- Get entity configuration
  select * into l_entity_config from zeroql.entities where table_name = p_entity;

  if l_entity_config is null then
    raise exception 'ZeroQL: entity % not configured', p_entity;
  end if;

  -- Extract primary key
  l_pk_field := 'id';
  l_pk_value := p_args ->> ('p_' || p_entity || '_id');
  if l_pk_value is null then
    l_pk_value := p_args ->> 'p_id';
  end if;
  if l_pk_value is null then
    l_pk_value := p_args ->> 'id';
  end if;

  if l_pk_value is null then
    raise exception 'ZeroQL: no primary key provided for entity %', p_entity;
  end if;

  -- TODO: Add permission checking
  -- TODO: Add cascade handling

  if l_entity_config.soft_delete then
    l_delete_sql := format('update %I set deleted_at = now() where %I = %L returning to_jsonb(%I.*)',
                        p_entity, l_pk_field, l_pk_value, p_entity);
  else
    l_delete_sql := format('delete from %I where %I = %L returning to_jsonb(%I.*)',
                        p_entity, l_pk_field, l_pk_value, p_entity);
  end if;

  execute l_delete_sql into l_result;
  return coalesce(l_result, '{}'::jsonb);
end $$;

-- Generic LOOKUP for typeahead/autocomplete
create or replace function zeroql.generic_lookup(
  p_entity text,
  p_args jsonb,
  p_user_id int
) returns jsonb
language plpgsql
security invoker
as $$
declare
  l_entity_config record;
  l_filter_text text;
  l_lookup_sql text;
  l_result jsonb;
  l_on_date timestamptz;
begin
  -- Get entity configuration
  select * into l_entity_config from zeroql.entities where table_name = p_entity;

  if l_entity_config is null then
    raise exception 'ZeroQL: entity % not configured', p_entity;
  end if;

  l_filter_text := coalesce(p_args->>'p_filter', '');
  l_on_date := (p_args->>'on_date')::timestamptz;

  -- Build lookup query
  l_lookup_sql := format($q$
    select jsonb_agg(jsonb_build_object('label', %I, 'value', id))
    from %I
    where %I ilike $1
  $q$, l_entity_config.label_field, p_entity, l_entity_config.label_field);

  -- Apply temporal filtering
  l_lookup_sql := zeroql.apply_temporal_filter(p_entity::regclass, l_lookup_sql, l_on_date);

  -- Add limit
  l_lookup_sql := l_lookup_sql || ' limit 20';

  -- TODO: Add permission filtering

  execute l_lookup_sql using '%' || l_filter_text || '%' into l_result;
  return coalesce(l_result, '[]'::jsonb);
end $$;

-- Generic SEARCH for filterable tables
create or replace function zeroql.generic_search(
  p_entity text,
  p_args jsonb,
  p_user_id int
) returns jsonb
language plpgsql
security invoker
as $$
declare
  l_entity_config record;
  l_filters jsonb;
  l_search_sql text;
  l_where_clauses text[] := array[]::text[];
  l_result jsonb;
  l_on_date timestamptz;
  l_page_size int := 50;
  l_page_offset int := 0;
begin
  -- Get entity configuration
  select * into l_entity_config from zeroql.entities where table_name = p_entity;

  if l_entity_config is null then
    raise exception 'ZeroQL: entity % not configured', p_entity;
  end if;

  l_filters := coalesce(p_args->'p_filters', '{}'::jsonb);
  l_on_date := (p_args->>'on_date')::timestamptz;

  -- Extract pagination
  if l_filters ? 'page' then
    l_page_offset := ((l_filters->>'page')::int - 1) * l_page_size;
  end if;

  -- Build base search query
  l_search_sql := format($q$
    select jsonb_build_object(
      'data', jsonb_agg(to_jsonb(t.*) order by t.id),
      'total', count(*) over(),
      'page', $1
    )
    from %I t
    where true
  $q$, p_entity);

  -- Apply temporal filtering
  l_search_sql := zeroql.apply_temporal_filter(p_entity::regclass, l_search_sql, l_on_date);

  -- TODO: Add dynamic filter processing based on filters jsonb
  -- TODO: Add permission filtering

  -- Add pagination
  l_search_sql := l_search_sql || format(' offset %s limit %s', l_page_offset, l_page_size);

  execute l_search_sql using coalesce((l_filters->>'page')::int, 1) into l_result;
  return coalesce(l_result, '{"data":[],"total":0,"page":1}'::jsonb);
end $$;

-- === Generic Dispatcher for Standard Operations ===
create or replace function zeroql.generic_exec(
  p_operation text,
  p_entity text,
  p_args jsonb,
  p_user_id int
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  case p_operation
    when 'get' then
      return zeroql.generic_get(p_entity, p_args, p_user_id);
    when 'save' then
      return zeroql.generic_save(p_entity, p_args, p_user_id);
    when 'delete' then
      return zeroql.generic_delete(p_entity, p_args, p_user_id);
    when 'lookup' then
      return zeroql.generic_lookup(p_entity, p_args, p_user_id);
    when 'search' then
      return zeroql.generic_search(p_entity, p_args, p_user_id);
    else
      raise exception 'ZeroQL: unknown operation %', p_operation;
  end case;
end $$;

-- === Events & Realtime (also serves as ActionLog) ===
create table if not exists zeroql.events (
  event_id bigserial primary key,
  context_id text,  -- generic context (venue_id, user_id, etc.)
  table_name text not null,
  op text not null check (op in ('insert','update','delete')),
  pk jsonb not null,
  before jsonb,
  after jsonb,
  user_id int,  -- who performed the action (for audit trail)
  notify_users int[],  -- specific users to notify (null = notify all)
  txid bigint not null default txid_current(),
  at timestamptz not null default now()
);
create index if not exists zeroql_events_context_event_idx on zeroql.events (context_id, event_id);
create index if not exists zeroql_events_table_pk_idx on zeroql.events (table_name, (pk->>'id'), at);
create index if not exists zeroql_events_user_idx on zeroql.events (user_id, at);

create or replace function zeroql.emit_row_change()
returns trigger language plpgsql as $$
declare
  l_context_id text;
  l_row_after jsonb;
  l_row_before jsonb;
  l_pk_value text;
  l_current_user_id int;
  l_notify_users int[];
begin
  if TG_OP = 'INSERT' then
    l_row_after := to_jsonb(NEW);
  elsif TG_OP = 'UPDATE' then
    l_row_after := to_jsonb(NEW);
    l_row_before := to_jsonb(OLD);
  else
    l_row_before := to_jsonb(OLD);
  end if;

  -- Extract primary key value
  l_pk_value := coalesce(
    to_jsonb(coalesce(NEW, OLD))->>TG_ARGV[0],
    to_jsonb(coalesce(NEW, OLD))->>'id'
  );

  -- Try to determine context for notifications (venue_id, user_id, etc.)
  l_context_id := coalesce(
    to_jsonb(coalesce(NEW, OLD))->>'venue_id',
    to_jsonb(coalesce(NEW, OLD))->>'user_id',
    to_jsonb(coalesce(NEW, OLD))->>'org_id',
    'global'
  );

  -- Try to get current user (could be set by application)
  l_current_user_id := coalesce(
    current_setting('app.current_user_id', true)::int,
    null
  );

  -- Set notify users (null = notify everyone for now)
  l_notify_users := null;

  -- Insert into events table (notification handled by events table trigger)
  insert into zeroql.events(context_id, table_name, op, pk, before, after, user_id, notify_users)
  values (
    l_context_id,
    TG_TABLE_NAME,
    lower(TG_OP),
    jsonb_build_object(TG_ARGV[0], l_pk_value),
    l_row_before,
    l_row_after,
    l_current_user_id,
    l_notify_users
  );

  return null;
end $$;

-- Event notification trigger - handles all real-time notifications
create or replace function zeroql.notify_event()
returns trigger language plpgsql as $$
begin
  -- Send real-time notification to single channel
  perform pg_notify('zeroql', jsonb_build_object(
    'event_id', NEW.event_id,
    'table', NEW.table_name,
    'op', NEW.op,
    'data', NEW.after,
    'notify_users', NEW.notify_users
  )::text);

  return null;
end $$;

-- Create trigger on events table to handle notifications
create or replace trigger zeroql_events_notify
  after insert on zeroql.events
  for each row execute function zeroql.notify_event();

create or replace function zeroql.catchup(p_context_id text, p_since_event_id bigint)
returns jsonb language sql stable as $$
  select coalesce(jsonb_agg(to_jsonb(e) order by e.event_id), '[]'::jsonb)
  from zeroql.events e
  where e.context_id = p_context_id
    and e.event_id > p_since_event_id
$$;

create or replace function zeroql.get_event(p_event_id bigint)
returns jsonb language sql stable as $$
  select to_jsonb(e) from zeroql.events e where e.event_id = p_event_id
$$;

-- === Event/Audit Query Functions ===

-- Get event history for a specific record (audit trail)
create or replace function zeroql.get_record_history(
  p_table_name text,
  p_record_id text,
  p_limit int default 50
) returns jsonb
language sql stable as $$
  select coalesce(jsonb_agg(to_jsonb(e) order by e.at desc), '[]'::jsonb)
  from zeroql.events e
  where e.table_name = p_table_name
    and e.pk->>'id' = p_record_id
  limit p_limit;
$$;

-- Get recent actions by user
create or replace function zeroql.get_user_actions(
  p_user_id int,
  p_limit int default 100
) returns jsonb
language sql stable as $$
  select coalesce(jsonb_agg(to_jsonb(e) order by e.at desc), '[]'::jsonb)
  from zeroql.events e
  where e.user_id = p_user_id
  limit p_limit;
$$;

-- Get recent events on a table
create or replace function zeroql.get_table_events(
  p_table_name text,
  p_limit int default 100
) returns jsonb
language sql stable as $$
  select coalesce(jsonb_agg(to_jsonb(e) order by e.at desc), '[]'::jsonb)
  from zeroql.events e
  where e.table_name = p_table_name
  limit p_limit;
$$;

-- === Helper Functions ===

-- Set current user for audit logging
create or replace function zeroql.set_current_user(p_user_id int)
returns void
language sql as $$
  select set_config('app.current_user_id', p_user_id::text, false);
$$;

-- Utility to register standard entity operations
create or replace function zeroql.register_entity(
  p_table_name text,
  p_label_field text,
  p_searchable_fields text[],
  p_fk_includes jsonb default '{}',
  p_permissions jsonb default '{}',
  p_soft_delete boolean default false,
  p_temporal_fields jsonb default '{}'
) returns void
language plpgsql as $$
begin
  -- Insert/update entity configuration
  insert into zeroql.entities
    (table_name, label_field, searchable_fields, fk_includes, permissions, soft_delete, temporal_fields)
  values
    (p_table_name, p_label_field, p_searchable_fields, p_fk_includes, p_permissions, p_soft_delete, p_temporal_fields)
  on conflict (table_name) do update set
    label_field = excluded.label_field,
    searchable_fields = excluded.searchable_fields,
    fk_includes = excluded.fk_includes,
    permissions = excluded.permissions,
    soft_delete = excluded.soft_delete,
    temporal_fields = excluded.temporal_fields;

  -- Automatically add event trigger
  execute format('
    DROP TRIGGER IF EXISTS %I_zeroql_events ON %I;
    CREATE TRIGGER %I_zeroql_events
      AFTER INSERT OR UPDATE OR DELETE ON %I
      FOR EACH ROW EXECUTE FUNCTION zeroql.emit_row_change(%L)',
    p_table_name, p_table_name, p_table_name, p_table_name, 'id'
  );
end $$;
