# Integration Tests

## Prerequisites

The integration tests require a running PostgreSQL instance.

### Starting PostgreSQL

If PostgreSQL is not running, you may need to:

1. **Fix SSL key permissions** (if you encounter SSL errors):
   ```bash
   sudo chown root:ssl-cert /etc/ssl/private/ssl-cert-snakeoil.key
   sudo chmod 640 /etc/ssl/private/ssl-cert-snakeoil.key
   ```

2. **Start PostgreSQL**:
   ```bash
   sudo service postgresql start
   ```

3. **Create test database**:
   ```bash
   sudo -u postgres psql -c "CREATE DATABASE dzql_test;"
   ```

### Running Integration Tests

With PostgreSQL running:

```bash
bun test tests/integration.test.js
```

### Environment Variables

You can customize the database connection:

```bash
export PGHOST=localhost
export PGPORT=5432
export PGDATABASE=dzql_test
export PGUSER=postgres
export PGPASSWORD=postgres

bun test tests/integration.test.js
```

## What the Tests Cover

The integration tests verify:

1. **Permission Functions**
   - Owner-based permissions
   - Graph relationship permissions (acts_for)
   - Permission denial for unauthorized users

2. **LOOKUP Function**
   - Filtering by name
   - Case-insensitive search
   - Limit enforcement

3. **SEARCH Function**
   - Basic text search across multiple fields
   - Pagination
   - Advanced filters (exact match, ilike, in)
   - Multiple filter combinations
   - Sorting

4. **Graph Rules**
   - on_create rules execute correctly
   - Relationships are created
   - Special variables (@user_id, @today, @now) resolve correctly

5. **End-to-End Workflows**
   - Complete create → permission → search workflow
   - Graph rules integration with permissions
   - Lookup functionality

## Skipping Integration Tests

If you don't have PostgreSQL available, you can skip integration tests and run only unit tests:

```bash
bun test tests/compiler.test.js
```

All core compiler functionality is covered by unit tests.
