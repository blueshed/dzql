# Testing Guide

This document explains how to run tests locally and in CI.

## Local Testing

### Prerequisites

- Bun runtime installed
- PostgreSQL running locally or via Docker
- Database URL configured

### Setup Database

```bash
# Option 1: Use venues Docker setup
cd packages/venues
bun db:up

# Option 2: Use your own PostgreSQL
export DATABASE_URL="postgresql://user:password@localhost:5432/dzql"
```

### Run Migrations

```bash
# Run all DZQL migrations
bun scripts/run-migrations.js

# Run domain-specific migrations (e.g., venues)
cd packages/venues
for sql_file in database/init_db/*.sql; do
  psql $DATABASE_URL -f "$sql_file"
done
```

### Run Tests

```bash
# All venues tests
cd packages/venues
bun test

# Specific test file
bun test tests/graph_validation.test.js

# With verbose output
bun test --verbose

# Run only matching tests
bun test --test-name-pattern="Validation"
```

### Environment Variables

```bash
# Required
export DATABASE_URL="postgresql://dzql:dzql@localhost:5432/dzql"

# Optional
export NODE_ENV="test"              # Suppresses logs
export LOG_LEVEL="ERROR"            # Only show errors
export LOG_CATEGORIES="*:error"     # Category-specific logging
```

## GitHub Actions CI

Tests run automatically on:
- Pushes to `main` branch
- Pushes to any `claude/**` branch
- Pull requests to `main`

### CI Environment

- **OS**: Ubuntu Latest
- **Runtime**: Bun (latest)
- **PostgreSQL**: Version 16
- **Database**: postgresql://dzql:dzql@localhost:5432/dzql

### Workflow Steps

1. Checkout code
2. Setup Bun runtime
3. Install dependencies
4. Wait for PostgreSQL to be ready
5. Run DZQL core migrations
6. Run domain-specific migrations
7. Run test suites:
   - Domain tests (CRUD operations)
   - Permission tests
   - Graph rules tests
   - **Graph validation tests** (new)

### View CI Results

- Go to the **Actions** tab in GitHub
- Click on the latest workflow run
- Expand test steps to see output
- Failed tests will show detailed error messages

## Test Structure

### Test Files

```
packages/venues/tests/
├── domain.test.js            # Basic CRUD operations
├── permissions.test.js       # Access control
├── graph_rules.test.js       # Relationship management
├── graph_validation.test.js  # Validation & execute actions (NEW)
├── notifications.test.js     # Real-time events
└── search.test.js            # Advanced search
```

### Test Pattern

```javascript
import { test, expect, beforeAll, afterAll } from "bun:test";
import { sql, db } from "dzql";

const PREFIX = `TEST_${Date.now()}`;
let testUserId;

beforeAll(async () => {
  // Setup: Create test user, test data
  const result = await sql`SELECT register_user(...)`;
  testUserId = result[0].user_data.user_id;
});

afterAll(async () => {
  // Cleanup: Delete test data in FK dependency order
  await sql`DELETE FROM children WHERE parent_id IN (...)`;
  await sql`DELETE FROM parents WHERE name LIKE ${PREFIX + '%'}`;
  await sql`DELETE FROM users WHERE id = ${testUserId}`;
});

test("Description of what is being tested", async () => {
  const result = await db.api.save.entities({...}, testUserId);
  expect(result).toBeDefined();
  expect(result.id).toBeGreaterThan(0);
});
```

## Writing New Tests

### For Graph Rules Validation

Test the new `validate` and `execute` action types:

```javascript
test("Validation rejects invalid data", async () => {
  await expect(
    db.api.save.entities({ invalid: "data" }, userId)
  ).rejects.toThrow("Custom error message");
});

test("Condition executes rule only when matched", async () => {
  // Create with status=draft (condition not met)
  const draft = await db.api.save.entities({ status: "draft" }, userId);

  // Update to status=posted (condition met, validation triggers)
  await db.api.save.entities({ id: draft.id, status: "posted" }, userId);

  // Attempt modification (should fail due to condition)
  await expect(
    db.api.save.entities({ id: draft.id, name: "new" }, userId)
  ).rejects.toThrow("Cannot modify posted record");
});
```

### Best Practices

1. **Isolation**: Use unique PREFIX with timestamp
2. **Cleanup**: Delete in FK dependency order (children first)
3. **Assertions**: Test both success and failure cases
4. **Descriptive**: Use clear test names
5. **Fast**: Avoid unnecessary delays, use transactions

## Debugging Failed Tests

### Local Debugging

```bash
# Run with PostgreSQL logs visible
cd packages/venues
docker compose logs -f postgres &
bun test tests/failing_test.js

# Connect to test database
psql postgresql://dzql:dzql@localhost:5432/dzql

# Check test data
SELECT * FROM test_table WHERE name LIKE 'TEST_%';

# Check graph rules execution
SELECT * FROM dzql.entities WHERE table_name = 'test_table';
```

### CI Debugging

1. Check PostgreSQL service health in workflow logs
2. Verify migrations ran successfully
3. Look for SQL errors in test output
4. Check if test cleanup ran (afterAll)
5. Review graph rules JSON for syntax errors

## Common Issues

### "Connection refused"

PostgreSQL not running or DATABASE_URL incorrect.

**Fix:**
```bash
# Check PostgreSQL is running
pg_isready -h localhost -p 5432

# Verify connection string
echo $DATABASE_URL
```

### "relation does not exist"

Migrations not run or ran in wrong order.

**Fix:**
```bash
# Re-run migrations
bun scripts/run-migrations.js
```

### "Foreign key constraint violation"

Test cleanup order is wrong (trying to delete parent before children).

**Fix:**
```javascript
// Delete children BEFORE parents
await sql`DELETE FROM child_table WHERE parent_id = ${parentId}`;
await sql`DELETE FROM parent_table WHERE id = ${parentId}`;
```

### "Unique constraint violation"

Previous test didn't clean up, or PREFIX collision.

**Fix:**
```javascript
// Clean up in beforeAll to handle failed previous runs
beforeAll(async () => {
  await sql`DELETE FROM table WHERE name LIKE ${PREFIX + '%'}`;
});
```

## Performance Tips

- Use transactions for bulk operations
- Minimize database roundtrips
- Clean up test data efficiently
- Run tests in parallel when possible
- Use `NODE_ENV=test` to suppress logs

## Coverage

Currently testing:
- ✅ DZQL core operations (get, save, delete, lookup, search)
- ✅ Permission system
- ✅ Graph rules (create, update, delete actions)
- ✅ **Graph validation (validate, execute actions, conditions)**
- ✅ Real-time notifications
- ✅ Search operators

Not yet covered:
- ⏳ Temporal relationships
- ⏳ FK includes (deeply nested)
- ⏳ Soft delete
- ⏳ Concurrent operations
- ⏳ Connection pool exhaustion
- ⏳ Performance benchmarks
