# Quick Start Guide - Centralized Testing

## What's Been Created

A comprehensive, centralized test suite that uses a real PostgreSQL database for all DZQL functionality testing.

## Directory Structure

```
tests/
├── README.md                      # Complete documentation
├── QUICKSTART.md                  # This file
├── docker-compose.yml             # Optional Docker setup
├── setup/                         # Test infrastructure
│   ├── db-setup.js               # Database utilities
│   ├── test-helpers.js           # Test helper functions
│   └── init-db.js                # Database initialization script
├── core/                         # Core functionality tests
│   ├── compiler.test.js          # Compiler tests
│   ├── subscribables.test.js     # Subscription tests
│   ├── integration.test.js       # Core integration tests
│   └── ... (all compiler tests)
├── integration/                  # Integration tests
│   ├── auth.test.js              # Authentication (register_user, login_user)
│   ├── interpreted-crud.test.js  # CRUD with register_entity (venues style)
│   └── compiled-crud.test.js     # CRUD with compiled db.api (blog style)
└── migrations/                   # Migration tests
    └── migrations.test.js        # Tests all migrations run correctly
```

## Before Running Tests

### 1. Start PostgreSQL

Follow these steps from your initial setup instructions:

```bash
# Fix permissions
chmod 600 /etc/ssl/private/ssl-cert-snakeoil.key
chown postgres:postgres /var/lib/postgresql/16/main
chown postgres:postgres /var/log/postgresql/postgresql-16-main.log
chown postgres:postgres /var/run/postgresql/
chown -R postgres:postgres /var/lib/postgresql/16/main
chmod 700 /var/lib/postgresql/16/main

# Start PostgreSQL
pg_ctlcluster 16 main start

# Verify
pg_isready -h localhost -p 5432
```

The test suite expects:
- PostgreSQL running on localhost:5432
- User: `postgres`
- Authentication: `trust` (no password needed)

### 2. Initialize Test Database

This creates the `dzql_test` database and runs all migrations:

```bash
bun run test:init
```

## Running Tests

### All Tests
```bash
bun test
```

### By Category
```bash
bun run test:core          # Compiler, parser, subscriptions
bun run test:integration   # Auth, CRUD (interpreted & compiled)
bun run test:migrations    # Migration validation
```

### Individual Test File
```bash
bun test tests/integration/auth.test.js
bun test tests/migrations/migrations.test.js
```

## What's Tested

### ✅ Migrations (`tests/migrations/`)
- All migration files run successfully
- DZQL schema and tables created
- Core functions available (register_entity, call, etc.)
- Authentication functions (register_user, login_user, _profile)
- Subscription management functions
- Proper indexes created

### ✅ Core Functionality (`tests/core/`)
- **Compiler**: Entity compilation, permission paths, FK expansion
- **Parser**: Entity parser, path parser, SQL parsing
- **Subscriptions**: Subscription management
- **Field Defaults**: Auto-population of default values
- **Many-to-Many**: M2M relationship handling

### ✅ Authentication (`tests/integration/auth.test.js`)
- User registration with password hashing
- User login with correct credentials
- Rejection of invalid credentials
- Profile retrieval
- Password hash never exposed in results

### ✅ Interpreted Mode (`tests/integration/interpreted-crud.test.js`)
- Tests `register_entity()` + generated functions
- `get_*` - Retrieve single entity
- `save_*` - Create and update entities
- `search_*` - Paginated search with filters
- `lookup_*` - Value/label pairs for dropdowns
- `delete_*` - Soft delete
- FK expansion (related entities included in results)

### ✅ Compiled Mode (`tests/integration/compiled-crud.test.js`)
- Tests compiled `db.api.*` functions
- Full CRUD operations via compiled functions
- Posts, comments, users, tags
- Authentication integration
- Permission checking

## Test Helpers

The test suite includes helpful utilities in `tests/setup/test-helpers.js`:

```javascript
import { setupTests, createTestUser, testEmail, testName } from '../setup/test-helpers.js';

const { sql } = setupTests();

// Generate unique test data
const email = testEmail('user');        // user-<timestamp>-<random>@test.com
const name = testName('Item');          // Item-<timestamp>-<random>

// Create test user
const user = await createTestUser(sql);  // Returns {user_id, email, name, ...}

// Assert errors
await assertThrows(
  async () => await someFunction(),
  '23505'  // Optional: expected error code
);
```

## Re-initializing the Database

If tests get into a bad state:

```bash
bun run test:init  # Drops and recreates dzql_test with fresh migrations
```

## Next Steps

1. **Start PostgreSQL** following the setup above
2. **Initialize the test database**: `bun run test:init`
3. **Run the tests**: `bun test`

All tests should pass! 🎉

## Troubleshooting

### Connection Errors
```bash
# Verify PostgreSQL is running
pg_isready -h localhost -p 5432

# Try connecting
psql -h localhost -U postgres -d postgres
```

### Permission Errors
```bash
# Verify trust authentication is configured
grep "127.0.0.1" /etc/postgresql/16/main/pg_hba.conf
# Should show: host    all    all    127.0.0.1/32    trust
```

### Tests Fail
```bash
# Re-initialize the database
bun run test:init

# Run tests again
bun test
```

## Benefits of Centralized Testing

✅ **Single PostgreSQL Instance** - All tests use the same database configuration
✅ **Real Database Testing** - Tests against actual PostgreSQL, not mocks
✅ **Migration Validation** - Ensures migrations work correctly
✅ **Comprehensive Coverage** - Core, interpreted, compiled, and migration testing
✅ **Easy to Run** - Simple commands: `bun run test:init` then `bun test`
✅ **Consistent Helpers** - Reusable test utilities for all test files
✅ **Fast Setup** - Database initialization in seconds
