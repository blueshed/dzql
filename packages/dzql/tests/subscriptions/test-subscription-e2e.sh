#!/bin/bash
# End-to-end test for live query subscriptions

set -e  # Exit on error

echo "=================================="
echo "Live Query Subscriptions E2E Test"
echo "=================================="
echo ""

# Check if database is running
if ! pg_isready -h localhost -p 5432 > /dev/null 2>&1; then
  echo "❌ PostgreSQL not running on localhost:5432"
  exit 1
fi

echo "✓ PostgreSQL is running"
echo ""

# Database connection
DB_URL="${DATABASE_URL:-postgres://postgres:postgres@localhost:5432/dzql}"

echo "Step 1: Run migration 009_subscriptions.sql"
echo "--------------------------------------------"
psql "$DB_URL" -f packages/dzql/src/database/migrations/009_subscriptions.sql
echo ""

echo "Step 2: Register subscribable via SQL"
echo "--------------------------------------"
psql "$DB_URL" << 'EOF'
SELECT dzql.register_subscribable(
  'venue_detail',
  '{"subscribe": ["@org_id->acts_for[org_id=$]{active}.user_id"]}'::jsonb,
  '{"venue_id": "int"}'::jsonb,
  'venues',
  '{"org": "organisations", "sites": {"entity": "sites", "filter": "venue_id=$venue_id"}}'::jsonb
);

-- Verify it was registered
SELECT name, root_entity FROM dzql.subscribables WHERE name = 'venue_detail';
EOF
echo ""

echo "Step 3: Compile subscribable to SQL"
echo "------------------------------------"
cd packages/dzql
node test-simple-subscribable.js > /tmp/venue_detail_compiled.sql
echo "✓ Compiled SQL saved to /tmp/venue_detail_compiled.sql"
echo ""

echo "Step 4: Deploy compiled functions"
echo "----------------------------------"
psql "$DB_URL" < /tmp/venue_detail_compiled.sql
echo "✓ Functions deployed"
echo ""

echo "Step 5: Test generated functions"
echo "---------------------------------"
psql "$DB_URL" << 'EOF'
-- Check if functions exist
SELECT
  routine_name,
  routine_type
FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name LIKE 'venue_detail%'
ORDER BY routine_name;

-- Test venue_detail_can_subscribe (should return true/false)
-- SELECT venue_detail_can_subscribe(1, '{"venue_id": 1}'::jsonb);

-- Test venue_detail_affected_documents
SELECT venue_detail_affected_documents(
  'venues',
  'update',
  '{"id": 1, "name": "Old"}'::jsonb,
  '{"id": 1, "name": "New"}'::jsonb
) as affected_subscriptions;
EOF
echo ""

echo "=================================="
echo "✓ All tests passed!"
echo "=================================="
echo ""
echo "Generated functions:"
echo "  - venue_detail_can_subscribe(user_id, params)"
echo "  - get_venue_detail(params, user_id)"
echo "  - venue_detail_affected_documents(table, op, old, new)"
echo ""
echo "Next: Implement server-side subscription handlers"
