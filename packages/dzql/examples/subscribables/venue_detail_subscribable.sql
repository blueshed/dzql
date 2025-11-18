-- Example: Venue Detail Subscribable
-- This subscribable builds a denormalized document containing:
-- - The venue record
-- - The organization (FK expanded)
-- - All sites belonging to the venue
-- - All packages with their allocations

SELECT dzql.register_subscribable(
  'venue_detail',

  -- Permission: who can subscribe?
  -- Users who act_for the venue's organization (active roles only)
  jsonb_build_object(
    'subscribe', ARRAY['@org_id->acts_for[org_id=$]{active}.user_id']
  ),

  -- Parameters: subscription key
  jsonb_build_object(
    'venue_id', 'int'
  ),

  -- Root entity
  'venues',

  -- Relations to include in document
  jsonb_build_object(
    -- FK expansion: organisation
    'org', 'organisations',

    -- Child collection: sites
    'sites', jsonb_build_object(
      'entity', 'sites',
      'filter', 'venue_id=$venue_id'
    ),

    -- Child collection: packages with nested allocations
    'packages', jsonb_build_object(
      'entity', 'packages',
      'filter', 'venue_id=$venue_id',
      'include', jsonb_build_object(
        'allocations', 'allocations'
      )
    )
  )
);
