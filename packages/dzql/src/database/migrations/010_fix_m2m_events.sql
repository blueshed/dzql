-- ============================================================================
-- Migration 010: Fix M2M in Event "before" Field
-- ============================================================================
--
-- Issue: UPDATE events don't include M2M data in the "before" field
-- Root cause: l_existing_record in generic_save doesn't expand M2M relationships
-- Fix: Create a helper function to expand M2M, then update generic_save to use it
--
-- This ensures UPDATE events have complete before/after state including M2M data
-- ============================================================================

DO $$ BEGIN
  RAISE NOTICE 'Migration 010: Fixing M2M in event before field...';
END $$;

-- Create helper function to expand M2M relationships for a record
CREATE OR REPLACE FUNCTION dzql.expand_m2m_for_record(
  p_entity text,
  p_record jsonb,
  p_entity_config record,
  p_pk_cols text[]
) RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  l_result jsonb := p_record;
  l_m2m_key text;
  l_m2m_config jsonb;
  l_id_field text;
  l_junction_table text;
  l_local_key text;
  l_foreign_key text;
  l_target_entity text;
  l_expand boolean;
  l_record_id text;
  l_id_array jsonb;
  l_expanded_objects jsonb;
BEGIN
  -- Only expand if entity has M2M configuration
  IF p_entity_config.many_to_many IS NULL OR p_entity_config.many_to_many = '{}'::jsonb THEN
    RETURN l_result;
  END IF;

  -- Get the primary key value from the record
  l_record_id := l_result->>p_pk_cols[1];  -- Assume single PK for now

  IF l_record_id IS NULL THEN
    RETURN l_result;
  END IF;

  -- Loop through all M2M relationships
  FOR l_m2m_key IN SELECT jsonb_object_keys(p_entity_config.many_to_many)
  LOOP
    l_m2m_config := p_entity_config.many_to_many->l_m2m_key;
    l_id_field := l_m2m_config->>'id_field';
    l_junction_table := l_m2m_config->>'junction_table';
    l_local_key := l_m2m_config->>'local_key';
    l_foreign_key := l_m2m_config->>'foreign_key';
    l_target_entity := l_m2m_config->>'target_entity';
    l_expand := COALESCE((l_m2m_config->>'expand')::boolean, false);

    -- Always include array of IDs
    EXECUTE format('
      SELECT COALESCE(jsonb_agg(%I ORDER BY %I), ''[]''::jsonb)
      FROM %I
      WHERE %I = $1::int
    ', l_foreign_key, l_foreign_key, l_junction_table, l_local_key)
    INTO l_id_array
    USING l_record_id;

    l_result := l_result || jsonb_build_object(l_id_field, l_id_array);

    -- Conditionally include expanded objects if expand: true
    IF l_expand THEN
      EXECUTE format('
        SELECT COALESCE(jsonb_agg(to_jsonb(t.*) ORDER BY t.id), ''[]''::jsonb)
        FROM %I jt
        JOIN %I t ON t.id = jt.%I
        WHERE jt.%I = $1::int
      ', l_junction_table, l_target_entity, l_foreign_key, l_local_key)
      INTO l_expanded_objects
      USING l_record_id;

      l_result := l_result || jsonb_build_object(l_m2m_key, l_expanded_objects);
    END IF;
  END LOOP;

  RETURN l_result;
END $$;

DO $$ BEGIN
  RAISE NOTICE 'Migration 010: M2M expansion helper function created';
  RAISE NOTICE 'Note: generic_save still needs updating to use this helper - will be done in next migration';
END $$;
