-- === Entity Metadata Function ===
-- Returns complete metadata for all registered entities in the DZQL system
-- Includes entity config, schema information, and relationship graph
-- Used by UI to dynamically configure based on registered entities

create or replace function get_entities_metadata(p_user_id int)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_entities jsonb;
  v_relations jsonb;
  v_junction_tables text[];
  v_entity_names text[];
begin
  -- Get list of registered entity names
  select array_agg(table_name) into v_entity_names
  from dzql.entities;

  -- Build entities object with schema information
  select jsonb_object_agg(
    e.table_name,
    jsonb_build_object(
      'table_name', e.table_name,
      'label_field', e.label_field,
      'searchable_fields', e.searchable_fields,
      'fk_includes', e.fk_includes,
      'soft_delete', e.soft_delete,
      'temporal_fields', e.temporal_fields,
      'notification_paths', e.notification_paths,
      'permission_paths', e.permission_paths,
      'schema', (
        -- Get column schema from information_schema
        select jsonb_agg(
          jsonb_build_object(
            'column_name', c.column_name,
            'data_type', c.data_type,
            'is_nullable', c.is_nullable = 'YES',
            'column_default', c.column_default,
            'character_maximum_length', c.character_maximum_length,
            'numeric_precision', c.numeric_precision,
            'numeric_scale', c.numeric_scale,
            'ordinal_position', c.ordinal_position
          ) order by c.ordinal_position
        )
        from information_schema.columns c
        where c.table_schema = 'public'
          and c.table_name = e.table_name
      )
    )
  ) into v_entities
  from dzql.entities e;

  -- Identify junction tables (2+ foreign keys, minimal searchable fields)
  select array_agg(distinct tc.table_name) into v_junction_tables
  from information_schema.table_constraints tc
  where tc.constraint_type = 'FOREIGN KEY'
    and tc.table_schema = 'public'
    and tc.table_name = any(v_entity_names)
  group by tc.table_name
  having count(*) >= 2
    and (
      select count(*)
      from unnest((
        select searchable_fields
        from dzql.entities
        where table_name = tc.table_name
      )) as sf
      where sf not in (
        select kcu.column_name
        from information_schema.key_column_usage kcu
        where kcu.table_name = tc.table_name
          and kcu.constraint_name in (
            select constraint_name
            from information_schema.table_constraints
            where table_name = tc.table_name
              and constraint_type = 'FOREIGN KEY'
          )
      )
    ) <= 1;

  -- Build relations array
  with fk_relations as (
    -- Get all foreign key relationships
    select
      tc.table_name,
      kcu.column_name,
      ccu.table_name as foreign_table_name,
      ccu.column_name as foreign_column_name
    from information_schema.table_constraints tc
    join information_schema.key_column_usage kcu
      on tc.constraint_name = kcu.constraint_name
      and tc.table_schema = kcu.table_schema
    join information_schema.constraint_column_usage ccu
      on ccu.constraint_name = tc.constraint_name
      and ccu.table_schema = tc.table_schema
    where tc.constraint_type = 'FOREIGN KEY'
      and tc.table_schema = 'public'
      and tc.table_name = any(v_entity_names)
      and ccu.table_name = any(v_entity_names)
  ),
  simple_relations as (
    -- Many-to-one and one-to-many for non-junction tables
    select jsonb_build_object(
      'type', 'many_to_one',
      'from', fk.table_name || '.' || fk.column_name,
      'to', fk.foreign_table_name || '.' || fk.foreign_column_name
    ) as relation
    from fk_relations fk
    where not (fk.table_name = any(v_junction_tables))

    union all

    select jsonb_build_object(
      'type', 'one_to_many',
      'from', fk.foreign_table_name || '.' || fk.foreign_column_name,
      'to', fk.table_name || '.' || fk.column_name
    ) as relation
    from fk_relations fk
    where not (fk.table_name = any(v_junction_tables))
  ),
  junction_relations as (
    -- Many-to-many through junction tables
    select jsonb_build_object(
      'type', 'many_to_many',
      'from', fk1.foreign_table_name || '.' || fk1.foreign_column_name,
      'to', fk2.foreign_table_name || '.' || fk2.foreign_column_name,
      'via', fk1.table_name || '.' || fk1.column_name || '.' || fk2.column_name
    ) as relation
    from fk_relations fk1
    join fk_relations fk2
      on fk1.table_name = fk2.table_name
      and fk1.column_name < fk2.column_name  -- avoid duplicates
    where fk1.table_name = any(v_junction_tables)

    union all

    select jsonb_build_object(
      'type', 'many_to_many',
      'from', fk2.foreign_table_name || '.' || fk2.foreign_column_name,
      'to', fk1.foreign_table_name || '.' || fk1.foreign_column_name,
      'via', fk1.table_name || '.' || fk2.column_name || '.' || fk1.column_name
    ) as relation
    from fk_relations fk1
    join fk_relations fk2
      on fk1.table_name = fk2.table_name
      and fk1.column_name < fk2.column_name
    where fk1.table_name = any(v_junction_tables)
  )
  select jsonb_agg(relation) into v_relations
  from (
    select relation from simple_relations
    union all
    select relation from junction_relations
  ) all_relations;

  -- Return complete metadata structure
  return jsonb_build_object(
    'entities', v_entities,
    'relations', coalesce(v_relations, '[]'::jsonb),
    'operations', jsonb_build_array('get', 'save', 'delete', 'lookup', 'search')
  );
end;
$$;
