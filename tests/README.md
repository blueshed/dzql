# DZQL Centralized Test Suite

This directory contains a comprehensive, centralized test suite for DZQL that uses a real PostgreSQL database for all tests.

## Overview

The test suite is organized into three main categories:

1. **Core Tests** (`tests/core/`) - Compiler, parser, and subscription tests
2. **Integration Tests** (`tests/integration/`) - Authentication, CRUD operations (interpreted and compiled modes)
3. **Migration Tests** (`tests/migrations/`) - Database migration and schema tests

## Prerequisites

- PostgreSQL 16+ running locally on port 5432
- Bun runtime installed
- PostgreSQL configured with `trust` authentication for localhost (see setup below)

## PostgreSQL Setup

### For Claude Code Sandbox Environment

```bash
# Fix permissions
chmod 600 /etc/ssl/private/ssl-cert-snakeoil.key
chown postgres:postgres /var/lib/postgresql/16/main /var/log/postgresql/postgresql-16-main.log /var/run/postgresql/
chown -R postgres:postgres /var/lib/postgresql/16/main
chmod 700 /var/lib/postgresql/16/main

# Configure for trust authentication
# Edit /etc/postgresql/16/main/postgresql.conf: set ssl = off
# Edit /etc/postgresql/16/main/pg_hba.conf: change 127.0.0.1/32 line to "trust"

# Start PostgreSQL
pg_ctlcluster 16 main start

# Verify it's running
pg_isready -h localhost -p 5432
```

### For Local Development

Ensure PostgreSQL is running and accessible on localhost:5432 with a `postgres` superuser that can create databases.

## Running Tests

### First Time Setup

Initialize the test database (creates `dzql_test` database and runs migrations):

```bash
bun run test:init
```

### Run All Tests

```bash
bun test
```

This will run all tests across:
- Core compiler and parser tests
- Integration tests for interpreted mode (register_entity)
- Integration tests for compiled mode (db.api)
- Authentication tests
- Migration tests

### Run Specific Test Suites

```bash
# Core compiler tests only
bun test tests/core/

# Integration tests only
bun test tests/integration/

# Migration tests only
bun test tests/migrations/

# Specific test file
bun test tests/integration/auth.test.js
```

## Test Database

- **Database Name**: `dzql_test`
- **User**: `postgres`
- **Port**: `5432`
- **Host**: `localhost`
- **Authentication**: trust (no password)

The test database is automatically created and initialized by the `test:init` script, which:

1. Drops and recreates the `dzql_test` database
2. Runs all migrations from `packages/dzql/src/database/migrations/`
3. Sets up the DZQL schema and core functions

## Test Structure

```
tests/
├── setup/              # Test utilities and database setup
│   ├── db-setup.js     # Database connection and migration utilities
│   ├── test-helpers.js # Helper functions for tests
│   └── init-db.js      # Database initialization script
├── core/               # Core functionality tests
│   ├── compiler.test.js
│   └── ...
├── integration/        # Integration tests
│   ├── auth.test.js               # Authentication functions
│   ├── interpreted-crud.test.js   # CRUD with register_entity
│   └── compiled-crud.test.js      # CRUD with compiled db.api
├── migrations/         # Migration tests
│   └── migrations.test.js
└── docker-compose.yml  # Optional Docker setup (not used in Claude sandbox)
```

## Writing New Tests

Use the test helpers for consistent test setup:

```javascript
import { describe, test, expect, beforeAll } from 'bun:test';
import { setupTests, createTestUser, testEmail, testName } from '../setup/test-helpers.js';

const { sql } = setupTests();

describe('My Test Suite', () => {
  let testUserId;

  beforeAll(async () => {
    // Create test user
    const user = await createTestUser(sql);
    testUserId = user.user_id;
  });

  test('my test', async () => {
    // Use testEmail() and testName() for unique test data
    const email = testEmail('test');
    const name = testName('Test');

    // Run your test
    const result = await sql`SELECT 1 as value`;
    expect(result[0].value).toBe(1);
  });
});
```

## Helper Functions

### Database Helpers

- `createTestConnection(dbName)` - Create a postgres connection
- `runMigrations(sql)` - Run all DZQL migrations
- `resetDatabase(sql)` - Drop and recreate schemas
- `setupTestDatabase()` - Complete database setup
- `cleanTestData(sql)` - Clean test data between tests

### Test Data Helpers

- `testEmail(prefix)` - Generate unique test email
- `testName(prefix)` - Generate unique test name
- `createTestUser(sql, email?, password?)` - Create and register a test user
- `assertThrows(fn, expectedCode?)` - Assert that a function throws an error

## CI/CD Integration

The centralized test suite is designed to work in CI environments:

```yaml
# Example GitHub Actions workflow
- name: Start PostgreSQL
  run: |
    sudo systemctl start postgresql
    sudo -u postgres psql -c "ALTER USER postgres PASSWORD 'postgres';"

- name: Initialize test database
  run: bun run test:init

- name: Run tests
  run: bun test
```

## Troubleshooting

### Database Connection Errors

If you get connection errors, verify:
1. PostgreSQL is running: `pg_isready -h localhost -p 5432`
2. Database exists: `psql -h localhost -U postgres -l | grep dzql_test`
3. Can connect: `psql -h localhost -U postgres -d dzql_test`

### Permission Errors

If you get permission errors, the PostgreSQL data directory may have incorrect ownership:

```bash
sudo chown -R postgres:postgres /var/lib/postgresql/16/main
sudo chmod 700 /var/lib/postgresql/16/main
```

### Migrations Not Running

Re-initialize the database:

```bash
bun run test:init
```

This will drop and recreate the test database with fresh migrations.
