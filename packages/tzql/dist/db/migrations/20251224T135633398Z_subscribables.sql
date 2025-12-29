-- ============================================================================
-- Subscribable: venue_detail
-- Root Entity: venues
-- Scope Tables: venues, organisations, sites, allocations
-- Generated: 2025-12-24T13:56:33.396Z
-- ============================================================================

CREATE OR REPLACE FUNCTION dzql_v2.venue_detail_can_subscribe(
  p_user_id INT,
  p_params JSONB
) RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = dzql_v2, public
AS $$
DECLARE
  v_venue_id int;
  v_root RECORD;
BEGIN
  -- Extract parameters
  v_venue_id := (p_params->>'venue_id')::int;

  -- Fetch root entity
  SELECT * INTO v_root
  FROM venues
  WHERE id = v_venue_id;

  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  -- Check permissions
  RETURN (
    p_user_id IS NOT NULL -- Fallback: multi-level paths not yet supported
  );
END;
$$;

CREATE OR REPLACE FUNCTION dzql_v2.get_venue_detail(
  p_params JSONB,
  p_user_id INT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = dzql_v2, public
AS $$
DECLARE
  v_venue_id int;
  v_data JSONB;
BEGIN
  -- Extract parameters
  v_venue_id := (p_params->>'venue_id')::int;

  -- Check access control
  IF NOT dzql_v2.venue_detail_can_subscribe(p_user_id, p_params) THEN
    RAISE EXCEPTION 'permission_denied';
  END IF;

  -- Build document with root and all relations
  SELECT jsonb_build_object(
    'venues', row_to_json(root.*),
    'org', (
      SELECT row_to_json(rel.*)
      FROM organisations rel
      WHERE rel.id = root.org_id
    ),
    'sites', COALESCE((
      SELECT jsonb_agg(
        to_jsonb(rel.*) || jsonb_build_object(
          'allocations', COALESCE((
            SELECT jsonb_agg(row_to_json(nested.*))
            FROM allocations nested
            WHERE nested.site_id = rel.id
          ), '[]'::jsonb))
      )
      FROM sites rel
      WHERE rel.venue_id = root.id
    ), '[]'::jsonb)
  )
  INTO v_data
  FROM venues root
  WHERE root.id = v_venue_id;

  -- Return data with embedded schema for atomic updates
  RETURN jsonb_build_object(
    'data', v_data,
    'schema', '{"root":"venues","paths":{"venues":".","organisations":"org","sites":"sites","allocations":"sites.allocations"},"scopeTables":["venues","organisations","sites","allocations"]}'::jsonb
  );
END;
$$;

CREATE OR REPLACE FUNCTION dzql_v2.venue_detail_affected_keys(
  p_table TEXT,
  p_op TEXT,
  p_data JSONB
) RETURNS TEXT[]
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_keys TEXT[];
BEGIN
  CASE p_table
    WHEN 'venues' THEN
      RETURN ARRAY['venue_detail:' || (p_data->>'id')];
    WHEN 'organisations' THEN
      RETURN ARRAY['venue_detail:' || (p_data->>'venue_id')];
    WHEN 'sites' THEN
      RETURN ARRAY['venue_detail:' || (p_data->>'venue_id')];
    WHEN 'allocations' THEN
      -- Nested: traverse via sites
      SELECT ARRAY_AGG('venue_detail:' || parent.venue_id)
      INTO v_keys
      FROM sites parent
      WHERE parent.id = (p_data->>'site_id')::int;
      RETURN COALESCE(v_keys, ARRAY[]::text[]);
    ELSE
      RETURN ARRAY[]::text[];
  END CASE;
END;
$$;

-- ============================================================================
-- Subscribable: org_dashboard
-- Root Entity: organisations
-- Scope Tables: organisations, venues, sites, products, packages, brands, artwork
-- Generated: 2025-12-24T13:56:33.397Z
-- ============================================================================

CREATE OR REPLACE FUNCTION dzql_v2.org_dashboard_can_subscribe(
  p_user_id INT,
  p_params JSONB
) RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = dzql_v2, public
AS $$
DECLARE
  v_org_id int;
  v_root RECORD;
BEGIN
  -- Extract parameters
  v_org_id := (p_params->>'org_id')::int;

  -- Fetch root entity
  SELECT * INTO v_root
  FROM organisations
  WHERE id = v_org_id;

  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  -- Check permissions
  RETURN (
    EXISTS (SELECT 1 FROM acts_for WHERE acts_for.org_id = v_root.id AND acts_for.user_id = p_user_id AND acts_for.active)
  );
END;
$$;

CREATE OR REPLACE FUNCTION dzql_v2.get_org_dashboard(
  p_params JSONB,
  p_user_id INT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = dzql_v2, public
AS $$
DECLARE
  v_org_id int;
  v_data JSONB;
BEGIN
  -- Extract parameters
  v_org_id := (p_params->>'org_id')::int;

  -- Check access control
  IF NOT dzql_v2.org_dashboard_can_subscribe(p_user_id, p_params) THEN
    RAISE EXCEPTION 'permission_denied';
  END IF;

  -- Build document with root and all relations
  SELECT jsonb_build_object(
    'organisations', row_to_json(root.*),
    'venues', COALESCE((
      SELECT jsonb_agg(
        to_jsonb(rel.*) || jsonb_build_object(
          'sites', COALESCE((
            SELECT jsonb_agg(row_to_json(nested.*))
            FROM sites nested
            WHERE nested.venue_id = rel.id
          ), '[]'::jsonb))
      )
      FROM venues rel
      WHERE rel.org_id = v_org_id
    ), '[]'::jsonb),
    'products', COALESCE((
      SELECT jsonb_agg(row_to_json(rel.*))
      FROM products rel
      WHERE rel.org_id = v_org_id
    ), '[]'::jsonb),
    'packages', COALESCE((
      SELECT jsonb_agg(row_to_json(rel.*))
      FROM packages rel
      WHERE rel.owner_org_id = v_org_id
    ), '[]'::jsonb),
    'brands', COALESCE((
      SELECT jsonb_agg(
        to_jsonb(rel.*) || jsonb_build_object(
          'artwork', COALESCE((
            SELECT jsonb_agg(row_to_json(nested.*))
            FROM artwork nested
            WHERE nested.brand_id = rel.id
          ), '[]'::jsonb))
      )
      FROM brands rel
      WHERE rel.org_id = v_org_id
    ), '[]'::jsonb)
  )
  INTO v_data
  FROM organisations root
  WHERE root.id = v_org_id;

  -- Return data with embedded schema for atomic updates
  RETURN jsonb_build_object(
    'data', v_data,
    'schema', '{"root":"organisations","paths":{"organisations":".","venues":"venues","sites":"venues.sites","products":"products","packages":"packages","brands":"brands","artwork":"brands.artwork"},"scopeTables":["organisations","venues","sites","products","packages","brands","artwork"]}'::jsonb
  );
END;
$$;

CREATE OR REPLACE FUNCTION dzql_v2.org_dashboard_affected_keys(
  p_table TEXT,
  p_op TEXT,
  p_data JSONB
) RETURNS TEXT[]
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_keys TEXT[];
BEGIN
  CASE p_table
    WHEN 'organisations' THEN
      RETURN ARRAY['org_dashboard:' || (p_data->>'id')];
    WHEN 'venues' THEN
      RETURN ARRAY['org_dashboard:' || (p_data->>'org_id')];
    WHEN 'sites' THEN
      -- Nested: traverse via venues
      SELECT ARRAY_AGG('org_dashboard:' || parent.organisation_id)
      INTO v_keys
      FROM venues parent
      WHERE parent.id = (p_data->>'venue_id')::int;
      RETURN COALESCE(v_keys, ARRAY[]::text[]);
    WHEN 'products' THEN
      RETURN ARRAY['org_dashboard:' || (p_data->>'org_id')];
    WHEN 'packages' THEN
      RETURN ARRAY['org_dashboard:' || (p_data->>'owner_org_id')];
    WHEN 'brands' THEN
      RETURN ARRAY['org_dashboard:' || (p_data->>'org_id')];
    WHEN 'artwork' THEN
      -- Nested: traverse via brands
      SELECT ARRAY_AGG('org_dashboard:' || parent.organisation_id)
      INTO v_keys
      FROM brands parent
      WHERE parent.id = (p_data->>'brand_id')::int;
      RETURN COALESCE(v_keys, ARRAY[]::text[]);
    ELSE
      RETURN ARRAY[]::text[];
  END CASE;
END;
$$;

-- ============================================================================
-- Subscribable: my_profile
-- Root Entity: users
-- Scope Tables: users, acts_for, organisations
-- Generated: 2025-12-24T13:56:33.397Z
-- ============================================================================

CREATE OR REPLACE FUNCTION dzql_v2.my_profile_can_subscribe(
  p_user_id INT,
  p_params JSONB
) RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = dzql_v2, public
AS $$
BEGIN
  RETURN TRUE; -- Public access
END;
$$;

CREATE OR REPLACE FUNCTION dzql_v2.get_my_profile(
  p_params JSONB,
  p_user_id INT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = dzql_v2, public
AS $$
DECLARE

  v_data JSONB;
BEGIN
  -- Extract parameters


  -- Check access control
  IF NOT dzql_v2.my_profile_can_subscribe(p_user_id, p_params) THEN
    RAISE EXCEPTION 'permission_denied';
  END IF;

  -- Build document with root and all relations
  SELECT jsonb_build_object(
    'users', jsonb_build_object('id', root.id, 'name', root.name, 'email', root.email, 'created_at', root.created_at),
    'memberships', COALESCE((
      SELECT jsonb_agg(
        to_jsonb(rel.*) || jsonb_build_object(
          'org', (
            SELECT row_to_json(nested.*)
            FROM organisations nested
            WHERE nested.id = rel.org_id
          ))
      )
      FROM acts_for rel
      WHERE rel.user_id = p_user_id
    ), '[]'::jsonb)
  )
  INTO v_data
  FROM users root
  WHERE root.id = p_user_id;

  -- Return data with embedded schema for atomic updates
  RETURN jsonb_build_object(
    'data', v_data,
    'schema', '{"root":"users","paths":{"users":".","acts_for":"memberships","organisations":"memberships.org"},"scopeTables":["users","acts_for","organisations"]}'::jsonb
  );
END;
$$;

CREATE OR REPLACE FUNCTION dzql_v2.my_profile_affected_keys(
  p_table TEXT,
  p_op TEXT,
  p_data JSONB
) RETURNS TEXT[]
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_keys TEXT[];
BEGIN
  CASE p_table
    WHEN 'users' THEN
      RETURN ARRAY['my_profile:' || (p_data->>'id')];
    WHEN 'acts_for' THEN
      RETURN ARRAY['my_profile:' || (p_data->>'user_id')];
    WHEN 'organisations' THEN
      -- Nested: traverse via acts_for
      SELECT ARRAY_AGG('my_profile:' || parent.user_id)
      INTO v_keys
      FROM acts_for parent
      WHERE parent.id = (p_data->>'acts_for_id')::int;
      RETURN COALESCE(v_keys, ARRAY[]::text[]);
    ELSE
      RETURN ARRAY[]::text[];
  END CASE;
END;
$$;