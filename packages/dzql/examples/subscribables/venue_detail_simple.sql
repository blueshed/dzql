-- Simplified test subscribable for initial testing
SELECT dzql.register_subscribable(
  'venue_detail',
  '{"subscribe": ["@org_id->acts_for[org_id=$]{active}.user_id"]}'::jsonb,
  '{"venue_id": "int"}'::jsonb,
  'venues',
  '{"org": "organisations", "sites": {"entity": "sites", "filter": "venue_id=$venue_id"}}'::jsonb
);
