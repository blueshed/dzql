-- Hello World Function for Testing ZeroQL's Function Proxy

-- Create a simple hello world function
-- First parameter must be p_user_id for ZeroQL compatibility
create or replace function hello(p_user_id int, p_name text default 'World')
returns jsonb
language plpgsql
security definer
as $$
begin
  return jsonb_build_object(
    'message', 'Hello, ' || coalesce(p_name, 'World') || '!',
    'timestamp', now(),
    'from', 'PostgreSQL',
    'user_id', p_user_id
  );
end;
$$;
