#!/bin/bash
# Phase 2: Database Schema Test

set -e

echo "==================================="
echo "Phase 2: Database Schema Test"
echo "==================================="
echo ""

DB_URL="${DATABASE_URL:-postgres://postgres:postgres@localhost:5432/dzql}"

# Check if we can connect
if ! psql "$DB_URL" -c "SELECT 1" > /dev/null 2>&1; then
  echo "❌ Cannot connect to database"
  echo "   Set DATABASE_URL or ensure postgres://postgres:postgres@localhost:5432/dzql is accessible"
  exit 1
fi

echo "✓ Database connection successful"
echo ""

echo "Step 1: Run migration 009_subscriptions.sql"
echo "--------------------------------------------"
psql "$DB_URL" -f packages/dzql/src/database/migrations/009_subscriptions.sql
echo ""

echo "Step 2: Verify tables and functions"
echo "------------------------------------"
psql "$DB_URL" << 'EOF'
-- Check table exists
\d dzql.subscribables

-- Check functions exist
\df dzql.register_subscribable
\df dzql.get_subscribables
EOF
echo ""

echo "Step 3: Register test subscribable"
echo "-----------------------------------"
psql "$DB_URL" << 'EOF'
SELECT dzql.register_subscribable(
  'venue_detail',
  '{"subscribe": ["@org_id->acts_for[org_id=$]{active}.user_id"]}'::jsonb,
  '{"venue_id": "int"}'::jsonb,
  'venues',
  '{"org": "organisations", "sites": {"entity": "sites", "filter": "venue_id=$venue_id"}}'::jsonb
);
EOF
echo ""

echo "Step 4: Query registered subscribable"
echo "--------------------------------------"
psql "$DB_URL" << 'EOF'
SELECT
  name,
  root_entity,
  jsonb_pretty(param_schema) as params,
  created_at
FROM dzql.subscribables
WHERE name = 'venue_detail';
EOF
echo ""

echo "Step 5: Compile and deploy subscribable functions"
echo "--------------------------------------------------"
node packages/dzql/compile-subscribable.js packages/dzql/examples/subscribables/venue_detail_simple.sql | psql "$DB_URL"
echo "✓ Functions deployed"
echo ""

echo "Step 6: Test generated functions"
echo "---------------------------------"
psql "$DB_URL" << 'EOF'
-- List generated functions
SELECT routine_name
FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name LIKE '%venue_detail%'
ORDER BY routine_name;

-- Test affected_documents function
SELECT venue_detail_affected_documents(
  'venues',
  'update',
  '{"id": 1, "name": "Old"}'::jsonb,
  '{"id": 1, "name": "New"}'::jsonb
) as affected;
EOF
echo ""

echo "==================================="
echo "✓ Phase 2 Complete!"
echo "==================================="
echo ""
echo "Database schema ready:"
echo "  ✓ dzql.subscribables table"
echo "  ✓ register_subscribable() function"
echo "  ✓ Helper query functions"
echo "  ✓ Compiled subscribable functions deployed"
echo ""
echo "Next: Phase 3 - Server Integration"
