-- === Entity Metadata Function ===
-- Returns complete metadata for all registered entities in the ZeroQL system
-- Used by UI to dynamically configure based on registered entities

create or replace function get_entities_metadata(p_user_id int)
returns jsonb
language sql
security definer
as $$
  select jsonb_object_agg(
    table_name,
    jsonb_build_object(
      'table_name', table_name,
      'label_field', label_field,
      'searchable_fields', searchable_fields,
      'fk_includes', fk_includes,
      'soft_delete', soft_delete,
      'temporal_fields', temporal_fields,
      'notification_paths', notification_paths,
      'permission_paths', permission_paths
    )
  )
  from dzql.entities;
$$;

-- === Create Test User ===
-- Create a test user for development/testing purposes
do $$
begin
  -- Only create if user doesn't exist
  if not exists (select 1 from users where email = 'test@example.com') then
    perform register_user(
      p_email := 'test@example.com',
      p_password := 'password123'
    );
    raise notice 'Test user created: test@example.com';
  else
    raise notice 'Test user already exists: test@example.com';
  end if;
end $$;
